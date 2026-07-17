import { useState, useMemo } from 'react'

export type SortDir = 'asc' | 'desc'

// Generic client-side sort — works on whatever rows a page already loaded,
// no server round-trip. Nulls always sort last regardless of direction, so
// "no date yet" doesn't jump to the top on a descending sort.
export function useSort<T, K extends string>(rows: T[], getValue: (row: T, key: K) => string | number | null | undefined, initialKey: K, initialDir: SortDir = 'asc') {
  const [sortKey, setSortKey] = useState<K>(initialKey)
  const [sortDir, setSortDir] = useState<SortDir>(initialDir)

  function toggleSort(key: K) {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    const withValue = rows.map(row => ({ row, value: getValue(row, sortKey) }))
    withValue.sort((a, b) => {
      if (a.value == null && b.value == null) return 0
      if (a.value == null) return 1
      if (b.value == null) return -1
      let cmp: number
      if (typeof a.value === 'number' && typeof b.value === 'number') cmp = a.value - b.value
      else cmp = String(a.value).toLowerCase().localeCompare(String(b.value).toLowerCase())
      return sortDir === 'asc' ? cmp : -cmp
    })
    return withValue.map(w => w.row)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir])

  return { sorted, sortKey, sortDir, toggleSort }
}
