import { reverseGeocode, clearReverseGeocodeCache } from '@/lib/reverseGeocode';

describe('reverseGeocode', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearReverseGeocodeCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('formats a concise Nominatim address and caches ~110m rounded coordinates', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        address: {
          road: 'Rizal Street',
          village: 'Poblacion',
          municipality: 'Bongabong',
          state: 'Oriental Mindoro',
        },
        display_name: 'Rizal Street, Poblacion, Bongabong, Oriental Mindoro, Mimaropa, Philippines',
      }),
    });
    global.fetch = fetchMock as any;

    const first = await reverseGeocode(12.74812, 121.48684, { forceFetch: true });
    expect(first).toBe('Rizal Street, Poblacion, Bongabong, Oriental Mindoro');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Same rounded coordinate (12.748, 121.487) hits cache without another HTTP call
    const second = await reverseGeocode(12.74819, 121.48689, { forceFetch: true });
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns undefined cleanly when Nominatim fails or rejects (never blocks check-in)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network timeout')) as any;

    const result = await reverseGeocode(12.7513, 121.4854, { forceFetch: true });
    expect(result).toBeUndefined();
  });

  it('clamps overly long display_name values safely under the 500-byte gps_address limit', async () => {
    const longDisplay = 'Very Long Address Segment, '.repeat(30);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: longDisplay }),
    }) as any;

    const result = await reverseGeocode(12.76, 121.49, { forceFetch: true });
    expect(result).toBeDefined();
    expect(result!.length).toBeLessThanOrEqual(240);
  });
});
