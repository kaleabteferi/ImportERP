import { AlertTriangle, X } from 'lucide-react'
import { Button } from './ui/Button'

interface Props {
  open: boolean
  title: string
  message: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({ open, title, message, danger, onConfirm, onClose }: Props) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 bg-black/50 z-[200] flex items-center
                 justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="rounded-card w-full max-w-sm border border-[var(--color-border-tertiary)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-xl p-5">
        <div className="flex items-start gap-3 mb-4">
          {danger && (
            <div className="w-9 h-9 rounded-full bg-red-100 flex items-center
                            justify-center shrink-0">
              <AlertTriangle size={18} className="text-red-600" />
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1 leading-relaxed">{message}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close confirmation" className="w-11 h-11 -mr-2 -mt-2 grid place-items-center rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-text-primary)]">
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose() }}>
            {danger ? 'Yes, delete' : 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  )
}
