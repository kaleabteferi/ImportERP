// src/components/ui/Modal.tsx
//
// One canonical overlay+panel shell for every add/edit dialog in the app.
// Replaces each page's own hand-rolled `fixed inset-0 bg-black/40 z-50 ...`
// block (previously duplicated near-identically in Products.tsx,
// Suppliers.tsx, etc.) and fixes the z-50 vs ConfirmDialog's z-[100]
// mismatch by standardizing on z-[100] everywhere.
import { useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  title: ReactNode
  maxWidth?: string
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ open, onClose, title, maxWidth = 'max-w-md', children, footer }: Props) {
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  if (!open) return null
  return createPortal(
    <div
      className="app-modal fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div className={`app-modal__panel bg-white rounded-card w-full ${maxWidth} max-h-[min(90vh,900px)] overflow-auto shadow-[var(--shadow-card-xl)]`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="app-modal__header sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-white">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="app-modal__close text-gray-500 hover:text-gray-700 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">{children}</div>
        {footer && (
          <div className="app-modal__footer sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-800 bg-white">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
