// src/components/containers/PackingListBuilder.tsx
//
// Splits a proforma invoice's line items across containers. Each container
// gets exactly one packing_lists row (enforced by a DB unique constraint on
// container_id); this component fetches-or-creates that row, then lets the
// user add pl_items pointing back at specific pi_items with a carton/unit
// split — this is how "different items per container" gets represented
// (e.g. chairs -> container A, tables -> container B).
import { useState, useEffect, useCallback } from 'react'
import { Plus, X, Pencil, Check, Loader2, Package } from 'lucide-react'
import type { PiItem } from '../../api/proformaInvoices'
import {
  getOrCreatePackingList, listPackingListItems, addPackingListItem, updatePackingListItem,
  deletePackingListItem, getAllocatedQuantities,
} from '../../api/containers'

interface Props {
  piId: string
  containerId: string
  piItems: PiItem[]
  onChanged?: () => void
  /** Bumped by the parent after an out-of-band write (e.g. "Suggest layout")
   * to force this container's own lines to refetch, since its load() has no
   * other way to know rows changed underneath it. */
  refreshToken?: number
}

const EMPTY_LINE = { pi_item_id: '', carton_qty: '', units_per_carton: '', length_cm: '', width_cm: '', height_cm: '', gross_weight_per_ctn: '', net_weight_per_ctn: '', marks_and_numbers: '' }

const N3 = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 4 }).format(n)

// Real volume when carton dimensions were entered, otherwise the product's
// own per-unit volume (set on the Products page) x units packed -- an
// estimate, but a real one, instead of reading 0 until someone measures
// every carton by hand.
function effectiveVolume(l: any): { m3: number; estimated: boolean } {
  const dimensionVolume = Number(l.total_volume_m3 ?? 0)
  if (dimensionVolume > 0) return { m3: dimensionVolume, estimated: false }
  const perUnit = l.pi_items?.products?.volume_m3
  if (perUnit) return { m3: Number(perUnit) * Number(l.total_units ?? 0), estimated: true }
  return { m3: 0, estimated: false }
}

export function PackingListBuilder({ piId, containerId, piItems, onChanged, refreshToken }: Props) {
  const [packingListId, setPackingListId] = useState<string | null>(null)
  const [lines, setLines] = useState<any[]>([])
  const [allocated, setAllocated] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ ...EMPTY_LINE })
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const plId = await getOrCreatePackingList(containerId, piId)
      setPackingListId(plId)
      const [items, allocs] = await Promise.all([
        listPackingListItems(plId),
        // Editing a line shouldn't make its own already-counted units look
        // like they're eating into its own remaining -- excluded here and
        // re-fetched fresh whenever which line is being edited changes.
        getAllocatedQuantities(piId, editingLineId ?? undefined),
      ])
      setLines(items)
      setAllocated(allocs)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
    setLoading(false)
  }, [containerId, piId, editingLineId, refreshToken])

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
    const existing = lines.find(line => line.pi_item_id === piItemId)
    setForm(prev => ({
      ...prev,
      pi_item_id: piItemId,
      units_per_carton: existing?.units_per_carton ? String(existing.units_per_carton) : prev.units_per_carton || (p?.default_units_per_carton ? String(p.default_units_per_carton) : ''),
      length_cm: existing?.length_cm ? String(existing.length_cm) : prev.length_cm || (p?.carton_length_cm ? String(p.carton_length_cm) : ''),
      width_cm: existing?.width_cm ? String(existing.width_cm) : prev.width_cm || (p?.carton_width_cm ? String(p.carton_width_cm) : ''),
      height_cm: existing?.height_cm ? String(existing.height_cm) : prev.height_cm || (p?.carton_height_cm ? String(p.carton_height_cm) : ''),
      gross_weight_per_ctn: existing?.gross_weight_per_ctn ? String(existing.gross_weight_per_ctn) : prev.gross_weight_per_ctn,
      net_weight_per_ctn: existing?.net_weight_per_ctn ? String(existing.net_weight_per_ctn) : prev.net_weight_per_ctn,
      marks_and_numbers: existing?.marks_and_numbers || prev.marks_and_numbers,
    }))
  }

  function startEdit(l: any) {
    setEditingLineId(l.id)
    setForm({
      pi_item_id: l.pi_item_id,
      carton_qty: String(l.carton_qty),
      units_per_carton: String(l.units_per_carton),
      length_cm: l.length_cm != null ? String(l.length_cm) : '',
      width_cm: l.width_cm != null ? String(l.width_cm) : '',
      height_cm: l.height_cm != null ? String(l.height_cm) : '',
      gross_weight_per_ctn: l.gross_weight_per_ctn != null ? String(l.gross_weight_per_ctn) : '',
      net_weight_per_ctn: l.net_weight_per_ctn != null ? String(l.net_weight_per_ctn) : '',
      marks_and_numbers: l.marks_and_numbers ?? '',
    })
    setError(null)
  }

  function cancelEdit() {
    setEditingLineId(null)
    setForm({ ...EMPTY_LINE })
    setError(null)
  }

  const cartonVolumeM3 = form.length_cm && form.width_cm && form.height_cm
    ? (parseFloat(form.length_cm) * parseFloat(form.width_cm) * parseFloat(form.height_cm)) / 1000000
    : null

  async function saveLine() {
    if (!packingListId || !form.pi_item_id || !form.carton_qty || !form.units_per_carton) {
      setError('Fill in item, cartons, and units per carton'); return
    }
    // Price is a PI-level fact, already set when the line item was added to
    // the invoice -- packing is purely a physical split, so it's derived
    // here rather than re-typed (and possibly re-typed wrong) per container.
    const piItem = piItems.find(pi => pi.id === form.pi_item_id)
    if (!piItem) { setError('Selected item not found.'); return }
    const proposedUnits = Number(form.carton_qty) * Number(form.units_per_carton)
    if (!editingLineId && proposedUnits > remaining(piItem) + 0.0001) {
      setError(`This adds ${proposedUnits} units, but only ${remaining(piItem)} remain unallocated.`); return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        pi_item_id: form.pi_item_id,
        carton_qty: parseFloat(form.carton_qty),
        units_per_carton: parseFloat(form.units_per_carton),
        unit_price_foreign: piItem.unit_price,
        length_cm: form.length_cm ? parseFloat(form.length_cm) : null,
        width_cm: form.width_cm ? parseFloat(form.width_cm) : null,
        height_cm: form.height_cm ? parseFloat(form.height_cm) : null,
        gross_weight_per_ctn: form.gross_weight_per_ctn ? parseFloat(form.gross_weight_per_ctn) : null,
        net_weight_per_ctn: form.net_weight_per_ctn ? parseFloat(form.net_weight_per_ctn) : null,
        marks_and_numbers: form.marks_and_numbers || null,
      }
      if (editingLineId) {
        await updatePackingListItem(editingLineId, payload)
      } else {
        await addPackingListItem(packingListId, payload)
      }
      setForm({ ...EMPTY_LINE })
      setEditingLineId(null)
      await load()
      onChanged?.()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
    setSaving(false)
  }

  async function removeLine(id: string) {
    try {
      await deletePackingListItem(id)
      if (editingLineId === id) cancelEdit()
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
    <div className="packing-builder">
      {error && <div className="mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

      {lines.length === 0 ? (
        <div className="text-xs text-gray-400 py-2 flex items-center gap-1.5">
          <Package size={13} /> No items packed into this container yet.
        </div>
      ) : (
        <table className="packing-table">
          <thead>
            <tr className="text-gray-400 text-left">
              <th className="font-medium py-1">Item</th>
              <th className="font-medium py-1 text-right">Cartons</th>
              <th className="font-medium py-1 text-right">Units/ctn</th>
              <th className="font-medium py-1 text-right">Total units</th>
              <th className="font-medium py-1 text-right">Unit price</th>
              <th className="font-medium py-1 text-right">Volume</th>
              <th className="font-medium py-1 text-right">Gross kg</th>
              <th className="font-medium py-1">Marks</th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {lines.map(l => {
              const vol = effectiveVolume(l)
              return (
                <tr key={l.id} className={editingLineId === l.id ? 'bg-blue-50/60' : ''}>
                  <td className="py-1.5">{l.pi_items?.item_description ?? l.pi_items?.products?.name ?? '—'}</td>
                  <td className="py-1.5 text-right font-mono">{l.carton_qty}</td>
                  <td className="py-1.5 text-right font-mono">{l.units_per_carton}</td>
                  <td className="py-1.5 text-right font-mono">{l.total_units}</td>
                  <td className="py-1.5 text-right font-mono">${l.unit_price_foreign}</td>
                  <td className="py-1.5 text-right font-mono">
                    {vol.m3 > 0
                      ? <span className={vol.estimated ? 'text-amber-600' : ''}>{N3(vol.m3)} m³{vol.estimated ? ' (est.)' : ''}</span>
                      : <span className="text-amber-500">no size</span>}
                  </td>
                  <td className="py-1.5 text-right font-mono">{l.gross_weight_per_ctn ? N3(Number(l.gross_weight_per_ctn) * Number(l.carton_qty)) : '—'}</td>
                  <td className="py-1.5">{l.marks_and_numbers || '—'}</td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button onClick={() => startEdit(l)} className="text-gray-300 hover:text-blue-600 transition-colors"><Pencil size={12} /></button>
                      <button onClick={() => removeLine(l.id)} className="text-gray-300 hover:text-red-500 transition-colors"><X size={12} /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className={`packing-form ${editingLineId ? 'editing' : ''}`}>
        {editingLineId && (
          <p className="w-full text-xs font-medium text-blue-700">Editing this line — Save to apply, or Cancel.</p>
        )}
        {!editingLineId && form.pi_item_id && lines.some(line => line.pi_item_id === form.pi_item_id) && <p className="packing-merge-note"><Package size={13} /> Already in this container — the additional cartons will increase the existing line instead of creating a duplicate.</p>}
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
          <label className="block text-xs text-gray-400 mb-1">Gross kg/ctn</label>
          <input type="number" step="0.01" value={form.gross_weight_per_ctn} onChange={e => setForm(p => ({ ...p, gross_weight_per_ctn: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Net kg/ctn</label>
          <input type="number" step="0.01" value={form.net_weight_per_ctn} onChange={e => setForm(p => ({ ...p, net_weight_per_ctn: e.target.value }))} />
        </div>
        <div className="packing-form-marks">
          <label className="block text-xs text-gray-400 mb-1">Shipping marks / carton range</label>
          <input value={form.marks_and_numbers} onChange={e => setForm(p => ({ ...p, marks_and_numbers: e.target.value }))} placeholder="e.g. KA-01–KA-120" />
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
        <button onClick={saveLine} disabled={saving}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? <Loader2 size={12} className="animate-spin" /> : editingLineId ? <Check size={12} /> : <Plus size={12} />}
          {editingLineId ? 'Save' : 'Add'}
        </button>
        {editingLineId && (
          <button onClick={cancelEdit} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-white transition-colors">
            Cancel
          </button>
        )}
        {cartonVolumeM3 != null && form.carton_qty && (
          <p className="w-full text-xs text-gray-400">
            = {N3(cartonVolumeM3)} m³/carton × {form.carton_qty} cartons = <span className="font-medium text-gray-600">{N3(cartonVolumeM3 * parseFloat(form.carton_qty || '0'))} m³ total</span>
          </p>
        )}
      </div>
    </div>
  )
}
