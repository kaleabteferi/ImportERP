import { AlertTriangle, X } from 'lucide-react'

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
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-5">
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
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs border border-gray-200 rounded-lg
                       hover:bg-gray-50 transition-colors text-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={() => { onConfirm(); onClose() }}
            className={`px-4 py-2 text-xs text-white rounded-lg
                        transition-colors
              ${danger
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {danger ? 'Yes, delete' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}