import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, ChevronDown, X } from 'lucide-react'

export interface SearchableOption {
  id: string
  label: string
  sublabel?: string
  disabled?: boolean
  disabledReason?: string
}

export function SearchableSelect({ options, value, onChange, placeholder, disabled, className }: {
  options: SearchableOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.id === value) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q))
  }, [options, query])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => { setHighlight(0) }, [query, open])

  function openDropdown() {
    if (disabled) return
    setOpen(true)
    setQuery('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function pick(o: SearchableOption) {
    if (o.disabled) return
    onChange(o.id)
    setOpen(false)
    setQuery('')
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[highlight]; if (o) pick(o) }
    else if (e.key === 'Escape') { setOpen(false); setQuery('') }
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      {open ? (
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={selected?.label ?? placeholder ?? 'Search…'}
            className="w-full pl-7 pr-7 py-1.5 text-xs border border-blue-400 rounded-lg bg-white focus:outline-none"
          />
          <button type="button" onClick={() => { setOpen(false); setQuery('') }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={openDropdown}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white text-left disabled:opacity-50 disabled:cursor-not-allowed hover:border-gray-300"
        >
          <span className={`flex-1 truncate ${selected ? '' : 'text-gray-400'}`}>
            {selected ? <>{selected.label}{selected.sublabel && <span className="text-gray-400"> · {selected.sublabel}</span>}</> : (placeholder ?? 'Select…')}
          </span>
          <ChevronDown size={12} className="text-gray-400 shrink-0" />
        </button>
      )}

      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">No matches.</p>
          ) : (
            filtered.map((o, i) => (
              <button
                key={o.id}
                type="button"
                disabled={o.disabled}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(o)}
                title={o.disabled ? o.disabledReason : undefined}
                className={`w-full flex items-center justify-between gap-2 text-left px-3 py-1.5 text-xs
                  ${o.disabled ? 'opacity-40 cursor-not-allowed' : i === highlight ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}
                  ${o.id === value ? 'font-medium' : ''}`}
              >
                <span className="truncate">{o.label}</span>
                {o.sublabel && <span className="text-gray-400 shrink-0">{o.sublabel}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
