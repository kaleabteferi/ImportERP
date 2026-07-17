import { useState } from 'react'
import { Trash2, X, Loader2, AlertTriangle } from 'lucide-react'

export function BulkActionBar({ count, itemLabel, onClear, onDelete }: {
  count: number
  itemLabel: string
  onClear: () => void
  onDelete: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (count === 0) return null

  async function handleDelete() {
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 mb-3 bg-blue-50 border border-blue-200 rounded-xl text-xs">
      <span className="font-medium text-blue-800">{count} {itemLabel}{count === 1 ? '' : 's'} selected</span>
      {confirming ? (
        <div className="flex items-center gap-2 ml-auto">
          <span className="flex items-center gap-1 text-red-700"><AlertTriangle size={12} /> Delete permanently?</span>
          <button onClick={handleDelete} disabled={deleting}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-600 text-white disabled:opacity-50">
            {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Confirm
          </button>
          <button onClick={() => setConfirming(false)} disabled={deleting} className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white">Cancel</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => setConfirming(true)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-200 text-red-600 bg-white hover:bg-red-50">
            <Trash2 size={11} /> Delete selected
          </button>
          <button onClick={onClear} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50">
            <X size={11} /> Clear
          </button>
        </div>
      )}
    </div>
  )
}
