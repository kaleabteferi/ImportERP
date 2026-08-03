import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Loader2, Package, Users, Building2, Receipt, Ship, UserCog, FileText, Container, ArrowRightLeft, Warehouse } from 'lucide-react'
import { searchGlobal, GLOBAL_SEARCH_TYPE_LABEL, type GlobalSearchResult, type GlobalSearchResultType } from '../lib/globalSearch'

const TYPE_ICON: Record<GlobalSearchResultType, typeof Package> = {
  product: Package, customer: Users, supplier: Building2, order: Receipt, shipment: Ship, employee: UserCog,
  document: FileText, container: Container, transfer: ArrowRightLeft, warehouse: Warehouse,
}

export function GlobalSearchBar({ placeholder, autoFocus }: { placeholder?: string; autoFocus?: boolean }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GlobalSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (query.trim().length < 2) return
    let active = true
    const timer = setTimeout(() => {
      setLoading(true)
      searchGlobal(query).then(r => { if (active) { setResults(r); setLoading(false) } }).catch(() => { if (active) setLoading(false) })
    }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [query])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function pick(r: GlobalSearchResult) {
    navigate(r.to)
    setOpen(false)
    setQuery('')
  }

  const showDropdown = open && query.trim().length >= 2

  return (
    <div ref={rootRef} className="global-search relative w-full max-w-md">
      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        value={query}
        autoFocus={autoFocus}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? 'Search products, customers, suppliers, orders, shipments…'}
        className="w-full min-h-11 pl-9 pr-3 py-2 text-sm border border-[var(--color-border-tertiary)] rounded-xl bg-[var(--color-background-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-accent"
      />
      {showDropdown && (
        <div className="global-search-results absolute z-40 mt-2 w-full max-h-96 overflow-y-auto bg-[var(--color-background-primary)] border border-[var(--color-border-tertiary)] rounded-2xl shadow-xl py-1.5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-gray-400">
              <Loader2 size={13} className="animate-spin" /> Searching…
            </div>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-400">No matches for "{query}".</p>
          ) : (
            results.map(r => {
              const Icon = TYPE_ICON[r.type]
              return (
                <button
                  key={`${r.type}-${r.id}`}
                  onClick={() => pick(r)}
                  className="w-full min-h-12 flex items-center gap-2.5 text-left px-3 py-2 hover:bg-[var(--color-background-secondary)]"
                >
                  <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <Icon size={13} className="text-gray-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{r.title}</p>
                    <p className="text-[11px] text-gray-400 truncate">{r.subtitle}</p>
                  </div>
                  <span className="text-[10px] text-gray-300 shrink-0">{GLOBAL_SEARCH_TYPE_LABEL[r.type]}</span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
