import { createContext, useContext, useRef, useState, useCallback } from 'react'
import type { ReactNode } from 'react'

// Holds arbitrary UI state (filters, search text, open/closed toggles,
// selected tabs, scroll position, etc.) keyed by a string, in a ref
// that survives route changes — React Router unmounts route
// components on every navigation, so a plain useState inside a page
// resets whenever you leave and come back. This context lives above
// the router's <Outlet/>, so it never unmounts during normal
// navigation, only on a full page reload.
const PageStateContext = createContext<{
  get: <T>(key: string, fallback: T) => T
  set: <T>(key: string, value: T) => void
} | null>(null)

// Module-scoped singleton (PageStateProvider is only ever mounted once, at
// the app root) so it can be cleared from outside React on sign-out —
// otherwise a shared browser/terminal would leak one user's filters/search
// state into the next login.
const pageStateStore = new Map<string, unknown>()

export function clearPageState() {
  pageStateStore.clear()
}

export function PageStateProvider({ children }: { children: ReactNode }) {
  const store = useRef(pageStateStore)

  const get = useCallback(<T,>(key: string, fallback: T): T => {
    if (!store.current.has(key)) store.current.set(key, fallback)
    return store.current.get(key) as T
  }, [])

  const set = useCallback(<T,>(key: string, value: T) => {
    store.current.set(key, value)
  }, [])

  return (
    <PageStateContext.Provider value={{ get, set }}>
      {children}
    </PageStateContext.Provider>
  )
}

/**
 * Drop-in replacement for useState that survives navigating away from
 * and back to a page. `key` must be unique per piece of state across
 * the whole app — prefix with the page name, e.g. 'payables.query'.
 */
export function usePageState<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const ctx = useContext(PageStateContext)
  if (!ctx) throw new Error('usePageState must be used within PageStateProvider')

  const [value, setValue] = useState<T>(() => ctx.get(key, initialValue))

  const setPersisted = useCallback((next: T | ((prev: T) => T)) => {
    setValue(prev => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next
      ctx.set(key, resolved)
      return resolved
    })
  }, [ctx, key])

  return [value, setPersisted]
}