/**
 * Best-effort reverse geocoding via OpenStreetMap Nominatim.
 *
 * - Caches resolved addresses by ~110m rounded coordinates (3 decimals) for 24h
 *   so co-located trainees at the same training center reuse a single lookup.
 * - Enforces a strict 2.5s timeout and catches all failures so attendance
 *   check-in is never blocked or rejected if Nominatim is slow or unreachable.
 * - Clamps output to <= 240 chars so it always satisfies JSONB_SIZE_LIMITS.gps_address (500 B).
 *
 * shortcut: in-memory cache per Node process, move to Redis if running multi-instance backend
 */

interface CacheEntry {
  address: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_MAX_ENTRIES = 500;
const REQUEST_TIMEOUT_MS = 2500;
const MAX_ADDRESS_LENGTH = 240;

const geocodeCache = new Map<string, CacheEntry>();

function buildCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

function formatNominatimAddress(payload: Record<string, unknown>): string | undefined {
  const addr = payload.address as Record<string, string | undefined> | undefined;
  const parts: string[] = [];

  if (addr && typeof addr === 'object') {
    const landmark = addr.amenity || addr.building || addr.office || addr.school;
    const street = [addr.house_number, addr.road].filter(Boolean).join(' ').trim();
    const locality = addr.neighbourhood || addr.quarter || addr.suburb || addr.village || addr.hamlet;
    const municipality = addr.town || addr.city || addr.municipality || addr.county;
    const province = addr.state || addr.province || addr.region;

    for (const part of [landmark, street, locality, municipality, province]) {
      if (part && !parts.some((existing) => existing.toLowerCase() === part.toLowerCase())) {
        parts.push(part);
      }
    }
  }

  const raw =
    parts.length > 0
      ? parts.join(', ')
      : typeof payload.display_name === 'string'
        ? payload.display_name.trim()
        : '';

  if (!raw) return undefined;
  return raw.length > MAX_ADDRESS_LENGTH ? `${raw.slice(0, MAX_ADDRESS_LENGTH - 1).trimEnd()}…` : raw;
}

export function clearReverseGeocodeCache(): void {
  geocodeCache.clear();
}

export async function reverseGeocode(
  lat: number,
  lng: number,
  options?: { forceFetch?: boolean; timeoutMs?: number }
): Promise<string | undefined> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return undefined;
  }

  // Skip external network calls during automated Jest runs unless explicitly enabled
  if (process.env.NODE_ENV === 'test' && !options?.forceFetch) {
    return undefined;
  }

  const cacheKey = buildCacheKey(lat, lng);
  const now = Date.now();
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.address;
  }

  if (typeof fetch !== 'function') {
    return undefined;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? REQUEST_TIMEOUT_MS);

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
      lat.toFixed(6)
    )}&lon=${encodeURIComponent(lng.toFixed(6))}&zoom=18&addressdetails=1`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en',
        'User-Agent': 'BMDC-Attendance/1.0 (https://bmdc.site)',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      return undefined;
    }

    const payload = (await res.json()) as Record<string, unknown>;
    const formatted = formatNominatimAddress(payload);

    if (formatted) {
      if (geocodeCache.size >= CACHE_MAX_ENTRIES) {
        const oldestKey = geocodeCache.keys().next().value;
        if (oldestKey !== undefined) geocodeCache.delete(oldestKey);
      }
      geocodeCache.set(cacheKey, { address: formatted, expiresAt: now + CACHE_TTL_MS });
    }

    return formatted;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
