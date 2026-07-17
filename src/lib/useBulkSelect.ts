import { useState, useMemo, useEffect } from 'react'

export function useBulkSelect<T extends { id: string }>(rows: T[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Drop any selected id that's no longer in the current row set (filtered
  // out, deleted, reloaded) so the count/bar never lies about what's real.
  useEffect(() => {
    setSelected(prev => {
      const validIds = new Set(rows.map(r => r.id))
      const next = new Set([...prev].filter(id => validIds.has(id)))
      return next.size === prev.size ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(prev => (prev.size === rows.length ? new Set() : new Set(rows.map(r => r.id))))
  }

  function clear() { setSelected(new Set()) }

  const allSelected = useMemo(() => rows.length > 0 && selected.size === rows.length, [rows, selected])

  return { selected, toggle, toggleAll, clear, allSelected, count: selected.size }
}
