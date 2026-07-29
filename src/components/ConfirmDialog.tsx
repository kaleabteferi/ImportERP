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
      className="fixed inset-0 bg-black/40 z-[100] flex items-center
                 justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-card w-full max-w-sm shadow-xl p-5">
        <div className="flex items-start gap-3 mb-4">
          {danger && (
            <div className="w-9 h-9 rounded-full bg-red-100 flex items-center
                            justify-center shrink-0">
              <AlertTriangle size={18} className="text-red-600" />
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-sm font-medium text-gray-900">{title}</h3>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{message}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose() }}>
            {danger ? 'Yes, delete' : 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  )
}
