// src/components/ui/Modal.tsx
//
// One canonical overlay+panel shell for every add/edit dialog in the app.
// Replaces each page's own hand-rolled `fixed inset-0 bg-black/40 z-50 ...`
// block (previously duplicated near-identically in Products.tsx,
// Suppliers.tsx, etc.) and fixes the z-50 vs ConfirmDialog's z-[100]
// mismatch by standardizing on z-[100] everywhere.
import type { ReactNode } from 'react'
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
  if (!open) return null
  return (
    <div
      className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className={`bg-white rounded-card w-full ${maxWidth} max-h-[90vh] overflow-auto shadow-[var(--shadow-card-xl)]`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
