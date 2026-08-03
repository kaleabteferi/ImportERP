import { useCallback, useId, useMemo, useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'

export interface SelectMenuOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

interface MenuPosition {
  left: number
  top?: number
  bottom?: number
  width: number
  maxHeight: number
}

interface SelectMenuProps {
  options: SelectMenuOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  searchable?: boolean
  className?: string
  size?: 'sm' | 'md'
}

function lastEnabledIndex(options: SelectMenuOption[]) {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index].disabled) return index
  }
  return -1
}

export function SelectMenu({
  options,
  value,
  onChange,
  placeholder = 'Select an option',
  ariaLabel,
  disabled = false,
  searchable,
  className = '',
  size = 'md',
}: SelectMenuProps) {
  const instanceId = useId().replaceAll(':', '')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<MenuPosition | null>(null)

  const selected = options.find(option => option.value === value) ?? null
  const hasSearch = searchable ?? options.length > 8
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return options
    return options.filter(option =>
      option.label.toLowerCase().includes(normalized)
      || option.description?.toLowerCase().includes(normalized),
    )
  }, [options, query])

  const calculatePosition = useCallback(() => {
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const edge = 8
    const gap = 7
    const preferredWidth = Math.max(rect.width, Math.min(280, viewportWidth - edge * 2))
    const width = Math.min(preferredWidth, viewportWidth - edge * 2)
    const left = Math.max(edge, Math.min(rect.left, viewportWidth - width - edge))
    const spaceBelow = viewportHeight - rect.bottom - edge
    const spaceAbove = rect.top - edge
    const openAbove = spaceBelow < 230 && spaceAbove > spaceBelow
    const maxHeight = Math.max(148, Math.min(310, (openAbove ? spaceAbove : spaceBelow) - gap))
    setPosition(openAbove
      ? { left, bottom: viewportHeight - rect.top + gap, width, maxHeight }
      : { left, top: rect.bottom + gap, width, maxHeight })
  }, [])

  function openMenu(initialDirection: 'first' | 'last' | 'selected' = 'selected') {
    if (disabled) return
    calculatePosition()
    setQuery('')
    const selectedIndex = options.findIndex(option => option.value === value && !option.disabled)
    const firstEnabled = options.findIndex(option => !option.disabled)
    const lastEnabled = lastEnabledIndex(options)
    setActiveIndex(
      initialDirection === 'first' ? Math.max(0, firstEnabled)
        : initialDirection === 'last' ? Math.max(0, lastEnabled)
          : selectedIndex >= 0 ? selectedIndex : Math.max(0, firstEnabled),
    )
    setOpen(true)
    requestAnimationFrame(() => {
      if (hasSearch) searchRef.current?.focus()
      else listboxRef.current?.focus()
    })
  }

  function closeMenu(returnFocus = false) {
    setOpen(false)
    setQuery('')
    if (returnFocus) requestAnimationFrame(() => buttonRef.current?.focus())
  }

  function choose(option: SelectMenuOption) {
    if (option.disabled) return
    onChange(option.value)
    closeMenu(true)
  }

  function moveActive(direction: 1 | -1) {
    if (!filtered.length) return
    let next = activeIndex
    for (let attempts = 0; attempts < filtered.length; attempts += 1) {
      next = (next + direction + filtered.length) % filtered.length
      if (!filtered[next]?.disabled) break
    }
    setActiveIndex(next)
    const optionId = `${instanceId}-option-${next}`
    requestAnimationFrame(() => document.getElementById(optionId)?.scrollIntoView({ block: 'nearest' }))
  }

  function handleMenuKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1) }
    else if (event.key === 'Home') { event.preventDefault(); setActiveIndex(Math.max(0, filtered.findIndex(option => !option.disabled))) }
    else if (event.key === 'End') {
      event.preventDefault()
      setActiveIndex(Math.max(0, lastEnabledIndex(filtered)))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = filtered[activeIndex]
      if (option) choose(option)
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault()
      closeMenu(event.key === 'Escape')
    }
  }

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
        setQuery('')
      }
    }
    const handleViewportChange = () => calculatePosition()
    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [calculatePosition, open])

  return (
    <div className={`app-select ${size === 'sm' ? 'is-sm' : ''} ${open ? 'is-open' : ''} ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        className="app-select__trigger"
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${instanceId}-listbox` : undefined}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); openMenu('first') }
          else if (event.key === 'ArrowUp') { event.preventDefault(); openMenu('last') }
          else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (open) closeMenu()
            else openMenu()
          }
        }}
      >
        <span className={selected ? '' : 'is-placeholder'}>
          <strong>{selected?.label ?? placeholder}</strong>
          {selected?.description && <small>{selected.description}</small>}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && position && createPortal(
        <div
          ref={menuRef}
          className={`app-select__menu ${position.bottom != null ? 'opens-up' : ''}`}
          style={{
            left: position.left,
            top: position.top,
            bottom: position.bottom,
            width: position.width,
            maxHeight: position.maxHeight,
          }}
          onKeyDown={handleMenuKeyDown}
        >
          {hasSearch && (
            <div className="app-select__search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchRef}
                value={query}
                onChange={event => {
                  const nextQuery = event.target.value
                  setQuery(nextQuery)
                  const normalized = nextQuery.trim().toLowerCase()
                  const nextOptions = normalized
                    ? options.filter(option => option.label.toLowerCase().includes(normalized) || option.description?.toLowerCase().includes(normalized))
                    : options
                  setActiveIndex(Math.max(0, nextOptions.findIndex(option => !option.disabled)))
                }}
                placeholder="Search options…"
                aria-label={`Search ${ariaLabel ?? 'options'}`}
                role="combobox"
                aria-expanded="true"
                aria-controls={`${instanceId}-listbox`}
                aria-activedescendant={filtered[activeIndex] ? `${instanceId}-option-${activeIndex}` : undefined}
              />
              <kbd>{filtered.length}</kbd>
            </div>
          )}
          <div
            ref={listboxRef}
            id={`${instanceId}-listbox`}
            className="app-select__options"
            role="listbox"
            tabIndex={-1}
            aria-label={ariaLabel ?? placeholder}
            aria-activedescendant={filtered[activeIndex] ? `${instanceId}-option-${activeIndex}` : undefined}
          >
            {filtered.length === 0 ? (
              <div className="app-select__empty">No matching options</div>
            ) : filtered.map((option, index) => {
              const isSelected = option.value === value
              const isActive = index === activeIndex
              return (
                <button
                  key={option.value}
                  id={`${instanceId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  className={`${isSelected ? 'is-selected' : ''} ${isActive ? 'is-active' : ''}`}
                  onPointerEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option)}
                >
                  <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
                  {isSelected && <Check size={14} aria-hidden="true" />}
                </button>
              )
            })}
          </div>
          <div className="app-select__footer"><span>↑↓ Navigate</span><span>Enter Select</span><span>Esc Close</span></div>
        </div>,
        document.body,
      )}
    </div>
  )
}
