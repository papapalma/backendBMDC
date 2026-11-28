import { chunkIds, fetchAllRows } from '@/lib/supabasePagination';

describe('supabasePagination', () => {
  it('chunks arrays cleanly and handles empty arrays', () => {
    expect(chunkIds([], 150)).toEqual([]);
    expect(chunkIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('paginates across multiple PostgREST pages until a partial page is returned', async () => {
    const pages = [
      [{ id: '1' }, { id: '2' }],
      [{ id: '3' }, { id: '4' }],
      [{ id: '5' }],
    ];
    let callCount = 0;

    const rows = await fetchAllRows<{ id: string }>(
      () => ({
        range: async (from: number, to: number) => {
          const idx = callCount++;
          expect(to - from + 1).toBe(2);
          return { data: pages[idx] ?? [], error: null };
        },
      }),
      2,
      10
    );

    expect(rows.map((r) => r.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(callCount).toBe(3);
  });

  it('falls back cleanly when a mocked query builder has no .range()', async () => {
    const rows = await fetchAllRows<{ id: string }>(() =>
      Promise.resolve({ data: [{ id: 'a' }], error: null })
    );
    expect(rows).toEqual([{ id: 'a' }]);
  });
});
