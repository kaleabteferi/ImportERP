import { useState } from 'react'
import { Trash2, X, AlertTriangle, Loader2 } from 'lucide-react'
import { deleteShipmentCascade, type DeleteShipmentResult } from '../../api/shipments'

export function DeleteShipmentModal({ shipmentId, shipmentNumber, status, onCancel, onDeleted }: {
  shipmentId: string
  shipmentNumber: string
  status: string
  onCancel: () => void
  onDeleted: (result: DeleteShipmentResult) => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasProgressed = !['ORDERED', 'IN_PRODUCTION'].includes(status)
  const canConfirm = confirmText.trim() === shipmentNumber

  async function confirm() {
    if (!canConfirm) return
    setDeleting(true); setError(null)
    try {
      const result = await deleteShipmentCascade(shipmentId)
      onDeleted(result)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete shipment.')
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && !deleting && onCancel()}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-medium flex items-center gap-1.5 text-red-700">
            <Trash2 size={15} /> Delete {shipmentNumber}
          </h2>
          <button onClick={onCancel} disabled={deleting} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-gray-600">
            This permanently deletes the shipment and everything tied to it — line items, expenses,
            damage reports, timeline, attachments, and any Djibouti warehouse transfers.
          </p>
          {hasProgressed && (
            <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>
                This shipment is past "Ordered" — if its goods were already received into inventory,
                deleting it will remove those stock movements too. Current stock for its products will
                drop accordingly; if any of that stock has since been sold, quantities can go negative.
                Double-check this is test data, not a real shipment.
              </span>
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Type <span className="font-mono font-medium">{shipmentNumber}</span> to confirm
            </label>
            <input
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono
                         focus:outline-none focus:ring-2 focus:ring-red-400"
              placeholder={shipmentNumber}
              autoFocus
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onCancel} disabled={deleting}
            className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={confirm} disabled={!canConfirm || deleting}
            className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white text-xs rounded-lg
                       hover:bg-red-700 disabled:opacity-40 transition-colors min-w-[140px] justify-center">
            {deleting ? <><Loader2 size={12} className="animate-spin" /> Deleting…</> : <><Trash2 size={12} /> Delete permanently</>}
          </button>
        </div>
      </div>
    </div>
  )
}
