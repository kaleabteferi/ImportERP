import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchWarehousesList } from '../../api/income'
import { logProductionQuick } from '../../lib/productionLogging'
import { Wrench, Loader2, Check, Package, AlertTriangle } from 'lucide-react'

interface BomOption { id: string; name: string; productName: string; stage: string }
interface Option { id: string; name: string }
interface RecentLog { id: string; log_date: string; quantity_produced: number; productName: string }

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

export function MobileProduction() {
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [boms, setBoms] = useState<BomOption[]>([])
  const [recent, setRecent] = useState<RecentLog[]>([])
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [warehouseRows, bomRows] = await Promise.all([
        fetchWarehousesList(),
        supabase.from('bom_headers').select('id, name, stage, product_id, finished_product_id').eq('is_active', true),
      ])
      setWarehouses((warehouseRows ?? []).map((w: any) => ({ id: w.id, name: w.name })))
      setWarehouseId(prev => prev || (warehouseRows?.[0]?.id ?? ''))

      const rows = bomRows.data ?? []
      const productIds = [...new Set(rows.map((r: any) => r.product_id ?? r.finished_product_id).filter(Boolean))]
      const { data: products } = productIds.length > 0
        ? await supabase.from('products').select('id, name').in('id', productIds)
        : { data: [] }
      const nameById = new Map((products ?? []).map((p: any) => [p.id, p.name]))
      setBoms(rows.map((r: any) => ({
        id: r.id, name: r.name, stage: r.stage ?? 'ASSEMBLY',
        productName: nameById.get(r.product_id ?? r.finished_product_id) ?? 'Unknown product',
      })))

      const { data: logs } = await supabase
        .from('production_daily_logs')
        .select('id, log_date, quantity_produced, bom_header_id, production_orders(bom_headers(product_id, finished_product_id))')
        .order('log_date', { ascending: false })
        .limit(10)
      setRecent((logs ?? []).map((l: any) => {
        const orderBom = Array.isArray(l.production_orders) ? l.production_orders[0] : l.production_orders
        const bomHeaderId = l.bom_header_id ?? null
        const productName = bomHeaderId
          ? boms.find(b => b.id === bomHeaderId)?.productName
          : nameById.get(orderBom?.bom_headers?.product_id ?? orderBom?.bom_headers?.finished_product_id)
        return { id: l.id, log_date: l.log_date, quantity_produced: Number(l.quantity_produced ?? 0), productName: productName ?? 'Production' }
      }))
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function logOne(bomId: string) {
    const qty = Number(entries[bomId] ?? '0')
    if (!warehouseId) { setError('Choose a warehouse first.'); return }
    if (!qty || qty <= 0) { setError('Enter a quantity greater than 0.'); return }
    setSavingId(bomId); setError(null); setSuccess(null)
    try {
      await logProductionQuick(bomId, warehouseId, qty, undefined, new Date().toISOString().split('T')[0])
      setEntries(prev => ({ ...prev, [bomId]: '' }))
      const bom = boms.find(b => b.id === bomId)
      setSuccess(`Logged ${qty} × ${bom?.productName ?? ''}`)
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to log production.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="p-4 pb-6 max-w-md mx-auto">
      <div className="mb-4">
        <h1 className="text-lg font-semibold flex items-center gap-2"><Wrench size={18} /> Production</h1>
        <p className="text-xs text-gray-400 mt-0.5">Tap a product, enter today's quantity, log it</p>
      </div>

      <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
        className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white mb-3">
        <option value="">Choose warehouse…</option>
        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>

      {error && <div className="mb-3 flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{error}</div>}
      {success && <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">{success}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : boms.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400">No active BOMs — set one up on the full version first.</div>
      ) : (
        <div className="space-y-2 mb-6">
          {boms.map(b => (
            <div key={b.id} className="bg-white border border-gray-200 rounded-2xl p-3.5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0"><Package size={14} className="text-gray-400" /></div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{b.productName}</p>
                  <p className="text-xs text-gray-400 capitalize">{b.stage.toLowerCase()}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={entries[b.id] ?? ''} onChange={e => setEntries(prev => ({ ...prev, [b.id]: e.target.value }))}
                  placeholder="Quantity" className="flex-1 h-9 px-3 text-sm border border-gray-200 rounded-lg" />
                <button onClick={() => logOne(b.id)} disabled={savingId === b.id}
                  className="h-9 px-4 bg-green-600 text-white text-xs rounded-lg flex items-center gap-1.5 disabled:opacity-50">
                  {savingId === b.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Log
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Recent activity</p>
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            {recent.map((r, i) => (
              <div key={r.id} className={`flex items-center justify-between px-4 py-2.5 text-xs ${i < recent.length - 1 ? 'border-b border-gray-50' : ''}`}>
                <span className="text-gray-600">{r.productName}</span>
                <span className="text-gray-400">{r.log_date}</span>
                <span className="font-mono font-medium text-green-700">+{N(r.quantity_produced)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
