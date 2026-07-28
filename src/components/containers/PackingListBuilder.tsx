// src/components/containers/PackingListBuilder.tsx
//
// Splits a proforma invoice's line items across containers. Each container
// gets exactly one packing_lists row (enforced by a DB unique constraint on
// container_id); this component fetches-or-creates that row, then lets the
// user add pl_items pointing back at specific pi_items with a carton/unit
// split — this is how "different items per container" gets represented
// (e.g. chairs -> container A, tables -> container B).
import { useState, useEffect, useCallback } from 'react'
import { Plus, X, Loader2, Package } from 'lucide-react'
import type { PiItem } from '../../api/proformaInvoices'
import {
  getOrCreatePackingList, listPackingListItems, addPackingListItem,
  deletePackingListItem, getAllocatedQuantities,
} from '../../api/containers'

interface Props {
  piId: string
  containerId: string
  piItems: PiItem[]
  onChanged?: () => void
}

const EMPTY_LINE = { pi_item_id: '', carton_qty: '', units_per_carton: '', length_cm: '', width_cm: '', height_cm: '' }

const N3 = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 4 }).format(n)

export function PackingListBuilder({ piId, containerId, piItems, onChanged }: Props) {
  const [packingListId, setPackingListId] = useState<string | null>(null)
  const [lines, setLines] = useState<any[]>([])
  const [allocated, setAllocated] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ ...EMPTY_LINE })
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const plId = await getOrCreatePackingList(containerId, piId)
      setPackingListId(plId)
      const [items, allocs] = await Promise.all([
        listPackingListItems(plId),
        getAllocatedQuantities(piId),
      ])
      setLines(items)
      setAllocated(allocs)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
    setLoading(false)
  }, [containerId, piId])

  useEffect(() => { load() }, [load])

  function remaining(item: PiItem) {
    return Number(item.quantity) - (allocated[item.id] ?? 0)
  }

  // Picking a line item pre-fills its product's standard carton size and
  // units/carton -- only into fields still blank, so it never overwrites
  // something already typed for this specific container.
  function pickLineItem(piItemId: string) {
    const piItem = piItems.find(pi => pi.id === piItemId)
    const p = piItem?.products
    setForm(prev => ({
      ...prev,
      pi_item_id: piItemId,
      units_per_carton: prev.units_per_carton || (p?.default_units_per_carton ? String(p.default_units_per_carton) : ''),
      length_cm: prev.length_cm || (p?.carton_length_cm ? String(p.carton_length_cm) : ''),
      width_cm: prev.width_cm || (p?.carton_width_cm ? String(p.carton_width_cm) : ''),
      height_cm: prev.height_cm || (p?.carton_height_cm ? String(p.carton_height_cm) : ''),
    }))
  }

  const cartonVolumeM3 = form.length_cm && form.width_cm && form.height_cm
    ? (parseFloat(form.length_cm) * parseFloat(form.width_cm) * parseFloat(form.height_cm)) / 1000000
    : null

  async function addLine() {
    if (!packingListId || !form.pi_item_id || !form.carton_qty || !form.units_per_carton) {
      setError('Fill in item, cartons, and units per carton'); return
    }
    // Price is a PI-level fact, already set when the line item was added to
    // the invoice -- packing is purely a physical split, so it's derived
    // here rather than re-typed (and possibly re-typed wrong) per container.
    const piItem = piItems.find(pi => pi.id === form.pi_item_id)
    if (!piItem) { setError('Selected item not found.'); return }
    setAdding(true)
    setError(null)
    try {
      await addPackingListItem(packingListId, {
        pi_item_id: form.pi_item_id,
        carton_qty: parseFloat(form.carton_qty),
        units_per_carton: parseFloat(form.units_per_carton),
        unit_price_foreign: piItem.unit_price,
        length_cm: form.length_cm ? parseFloat(form.length_cm) : null,
        width_cm: form.width_cm ? parseFloat(form.width_cm) : null,
        height_cm: form.height_cm ? parseFloat(form.height_cm) : null,
      })
      setForm({ ...EMPTY_LINE })
      await load()
      onChanged?.()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
    setAdding(false)
  }

  async function removeLine(id: string) {
    try {
      await deletePackingListItem(id)
      await load()
      onChanged?.()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-xs text-gray-400 py-4"><Loader2 size={13} className="animate-spin" /> Loading packing list…</div>
  }

  return (
    <div className="mt-2">
      {error && <div className="mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

      {lines.length === 0 ? (
        <div className="text-xs text-gray-400 py-2 flex items-center gap-1.5">
          <Package size={13} /> No items packed into this container yet.
        </div>
      ) : (
        <table className="w-full text-xs mb-3">
          <thead>
            <tr className="text-gray-400 text-left">
              <th className="font-medium py-1">Item</th>
              <th className="font-medium py-1 text-right">Cartons</th>
              <th className="font-medium py-1 text-right">Units/ctn</th>
              <th className="font-medium py-1 text-right">Total units</th>
              <th className="font-medium py-1 text-right">Unit price</th>
              <th className="font-medium py-1 text-right">Volume</th>
              <th className="w-6"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {lines.map(l => (
              <tr key={l.id}>
                <td className="py-1.5">{l.pi_items?.item_description ?? l.pi_items?.products?.name ?? '—'}</td>
                <td className="py-1.5 text-right font-mono">{l.carton_qty}</td>
                <td className="py-1.5 text-right font-mono">{l.units_per_carton}</td>
                <td className="py-1.5 text-right font-mono">{l.total_units}</td>
                <td className="py-1.5 text-right font-mono">${l.unit_price_foreign}</td>
                <td className="py-1.5 text-right font-mono">
                  {l.total_volume_m3 > 0 ? `${N3(l.total_volume_m3)} m³` : <span className="text-amber-500">no size</span>}
                </td>
                <td className="py-1.5"><button onClick={() => removeLine(l.id)} className="text-gray-300 hover:text-red-500 transition-colors"><X size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-end gap-2 bg-gray-50 rounded-lg p-2.5">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Line item</label>
          <select className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg bg-white w-48"
            value={form.pi_item_id} onChange={e => pickLineItem(e.target.value)}>
            <option value="">— select —</option>
            {piItems.map(pi => (
              <option key={pi.id} value={pi.id}>
                {pi.item_description} (rem. {remaining(pi)})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Cartons</label>
          <input type="number" className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg w-20"
            value={form.carton_qty} onChange={e => setForm(p => ({ ...p, carton_qty: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Units/ctn</label>
          <input type="number" className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg w-20"
            value={form.units_per_carton} onChange={e => setForm(p => ({ ...p, units_per_carton: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">L (cm)</label>
          <input type="number" step="0.1" className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg w-16"
            value={form.length_cm} onChange={e => setForm(p => ({ ...p, length_cm: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">W (cm)</label>
          <input type="number" step="0.1" className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg w-16"
            value={form.width_cm} onChange={e => setForm(p => ({ ...p, width_cm: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">H (cm)</label>
          <input type="number" step="0.1" className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg w-16"
            value={form.height_cm} onChange={e => setForm(p => ({ ...p, height_cm: e.target.value }))} />
        </div>
        <button onClick={addLine} disabled={adding}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
        </button>
        {cartonVolumeM3 != null && form.carton_qty && (
          <p className="w-full text-xs text-gray-400">
            = {N3(cartonVolumeM3)} m³/carton × {form.carton_qty} cartons = <span className="font-medium text-gray-600">{N3(cartonVolumeM3 * parseFloat(form.carton_qty || '0'))} m³ total</span>
          </p>
        )}
      </div>
    </div>
  )
}
