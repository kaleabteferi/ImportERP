import { useState, useEffect, useMemo } from 'react'
import { produceAssembly, fetchAssemblableProducts, fetchComponentAvailability } from '../api/production';
import type { AssemblableProduct, ComponentAvailability } from '../api/production';
import { fetchWarehousesList } from '../api/income'
import { fetchEmployeesList } from '../api/companyExpenses'
import { Hammer, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'

import { usePageState } from '../lib/pageState'
interface Option { id: string; name: string }

export function Assembly() {
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [products, setProducts] = useState<AssemblableProduct[]>([])
  const [employees, setEmployees] = useState<Option[]>([])
  const [warehouseId, setWarehouseId] = usePageState('assembly.warehouseId', '')
  const [bomHeaderId, setBomHeaderId] = usePageState('assembly.bomHeaderId', '')
  const [quantity, setQuantity] = useState('')
  const [loggedBy, setLoggedBy] = useState('')
  const [notes, setNotes] = useState('')
  const [availability, setAvailability] = useState<ComponentAvailability[]>([])
  const [loadingAvailability, setLoadingAvailability] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchWarehousesList(), fetchAssemblableProducts(), fetchEmployeesList()])
      .then(([w, p, e]) => {
        setWarehouses((w ?? []).map((x: any) => ({ id: x.id, name: x.name })))
        setProducts(p)
        setEmployees((e ?? []).map((x: any) => ({ id: x.id, name: x.full_name })))
        setWarehouseId(prev => prev || (w?.[0]?.id ?? ''))
      })
      .catch(e => setError(e?.message ?? 'Failed to load setup data.'))
  }, [])

  useEffect(() => {
    if (!warehouseId || !bomHeaderId) { setAvailability([]); return }
    setLoadingAvailability(true)
    fetchComponentAvailability(bomHeaderId, warehouseId)
      .then(setAvailability)
      .catch(e => setError(e?.message ?? 'Failed to load component stock.'))
      .finally(() => setLoadingAvailability(false))
  }, [warehouseId, bomHeaderId])

  const maxAssemblable = useMemo(() => {
    if (availability.length === 0) return null
    return Math.min(...availability.map(a => a.quantityRequired > 0 ? Math.floor(a.available / a.quantityRequired) : Infinity))
  }, [availability])

  async function submit() {
    const qty = Number(quantity)
    if (!warehouseId) { setError('Choose a warehouse.'); return }
    if (!bomHeaderId) { setError('Choose a product to assemble.'); return }
    if (!qty || qty <= 0) { setError('Enter a quantity greater than 0.'); return }
    if (maxAssemblable !== null && qty > maxAssemblable) {
      setError(`Not enough component stock — you can assemble at most ${maxAssemblable} today.`)
      return
    }
    const product = products.find(p => p.bomHeaderId === bomHeaderId)
    setSaving(true); setError(null); setSuccess(null)
    try {
      const result = await produceAssembly(warehouseId, product!.productId, qty, loggedBy || undefined, notes || undefined)
      setSuccess(`Assembled ${qty} × "${product?.productName}" — order ${result?.order_number ?? ''}`)
      setQuantity(''); setNotes('')
      const refreshed = await fetchComponentAvailability(bomHeaderId, warehouseId)
      setAvailability(refreshed)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record assembly.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-5 max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-medium flex items-center gap-2"><Hammer size={18} /> Assembly</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Turn CKD/SKD components into finished goods, logged for today
        </p>
      </div>

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5"><AlertTriangle size={12} />{error}</div>}
      {success && <div className="mb-4 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700 flex items-center gap-1.5"><CheckCircle2 size={12} />{success}</div>}

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex gap-2">
          <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
            className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
            <option value="">Which warehouse?</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select value={bomHeaderId} onChange={e => setBomHeaderId(e.target.value)}
            className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
            <option value="">
              {products.length === 0 ? 'No BOMs set up yet' : 'Which product to assemble?'}
            </option>
            {products.map(p => <option key={p.bomHeaderId} value={p.bomHeaderId}>{p.productName}</option>)}
          </select>
        </div>

        {products.length === 0 && (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
            No bills of materials exist yet, so there's nothing to assemble. A BOM defines which
            components make up a finished product — ask to have this set up before using Assembly.
          </p>
        )}

        {loadingAvailability && (
          <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
            <Loader2 size={12} className="animate-spin" /> Checking component stock…
          </div>
        )}

        {!loadingAvailability && availability.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-medium text-gray-500">Component stock at this warehouse</p>
            {availability.map(a => {
              const short = a.available < a.quantityRequired
              return (
                <div key={a.componentProductId} className="flex justify-between text-xs">
                  <span className={short ? 'text-red-600' : 'text-gray-600'}>{a.componentName}</span>
                  <span className={short ? 'text-red-600 font-medium' : 'text-gray-500'}>
                    {a.available} in stock · {a.quantityRequired} needed per unit
                  </span>
                </div>
              )
            })}
            {maxAssemblable !== null && isFinite(maxAssemblable) && (
              <p className="text-xs text-blue-600 pt-1">You can assemble up to {maxAssemblable} today with current stock.</p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)}
            placeholder="Quantity to assemble"
            className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          <select value={loggedBy} onChange={e => setLoggedBy(e.target.value)}
            className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
            <option value="">Who's logging this?</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)"
          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />

        <button onClick={submit} disabled={saving}
          className="w-full px-3 py-2 text-xs rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50">
          {saving ? 'Assembling…' : "Log today's assembly"}
        </button>
      </div>
    </div>
  )
}