/**
 * Minimal Supabase PostgREST pagination and `.in()` chunking helpers.
 * Prevents HTTP 414 URI Too Long on large UUID arrays and silent 1,000-row truncation.
 */

export function chunkIds<T>(items: T[], size: number = 150): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function fetchAllRows<T = any>(
  buildQuery: () => any,
  pageSize: number = 1000,
  maxRows: number = 10000
): Promise<T[]> {
  const results: T[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const query = buildQuery();
    const hasRange = typeof query?.range === 'function';
    const { data, error } = await (hasRange
      ? query.range(offset, offset + pageSize - 1)
      : query);
    if (error) throw error;
    const batch = (data || []) as T[];
    results.push(...batch);
    if (batch.length < pageSize || !hasRange) {
      break;
    }
  }
  return results;
}
