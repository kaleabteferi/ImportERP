// src/components/dashboard/ManufacturingPerformanceCard.tsx
//
// "Which warehouses are actually hitting their production capacity, and how
// much overtime is that costing?" -- two live panels:
//   1. Capacity efficiency by warehouse: production_daily_logs vs. the
//      rated capacity for that (warehouse, product) as of the log's date,
//      averaged per warehouse, color-coded 85%/65% green/amber/red.
//   2. Overtime hours by type, from the most recent payroll period's
//      auto-classified overtime lines (weekday/night/rest_day/holiday).
//
// Both production_capacity and payroll_overtime_lines are brand new tables
// with no data-entry UI anywhere else in the app yet -- rather than show a
// dead-end empty state for capacity specifically, this card includes a
// minimal inline "set a rate" form so there's at least one real way to
// start populating it.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { Loader2, Gauge, Clock3, Plus } from 'lucide-react'

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 1 }).format(n)

interface WarehouseEfficiency {
  warehouseId: string
  warehouseName: string
  avgEfficiencyPct: number
  consistencyStddev: number
  daysLogged: number
}

interface OvertimeTotal {
  otType: string
  hours: number
  amountEtb: number
}

const OT_TYPE_LABEL: Record<string, string> = {
  weekday: 'Weekday (1.25x)',
  night: 'Night 5–10pm (1.5x)',
  rest_day: 'Rest day (2x)',
  public_holiday: 'Public holiday (2.5x)',
}

function effLabel(pct: number) {
  if (pct >= 85) return { cls: 'text-green-700 bg-green-50', label: 'On target' }
  if (pct >= 65) return { cls: 'text-amber-700 bg-amber-50', label: 'Below target' }
  return { cls: 'text-red-700 bg-red-50', label: 'Underperforming' }
}

export function ManufacturingPerformanceCard() {
  const [loading, setLoading] = useState(true)
  const [efficiency, setEfficiency] = useState<WarehouseEfficiency[]>([])
  const [hasCapacityRows, setHasCapacityRows] = useState(false)
  const [overtime, setOvertime] = useState<OvertimeTotal[]>([])
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([])
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])

  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ warehouseId: '', productId: '', rate: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]

      const [capRes, logsRes, whRes, prodRes, otRes] = await Promise.all([
        supabase.from('production_capacity').select('warehouse_id, product_id, rated_capacity_per_day, effective_from'),
        supabase.from('production_daily_logs')
          .select('log_date, quantity_produced, warehouse_id, product_id, production_orders(warehouse_id, product_id)')
          .gte('log_date', since),
        supabase.from('warehouses').select('id, name'),
        supabase.from('products').select('id, name').eq('is_active', true).order('name'),
        // All auto-classified OT lines grouped by type -- there's no
        // meaningful sort for a client-side sum, just a sane cap.
        supabase.from('payroll_overtime_lines')
          .select('ot_type, hours, amount_etb')
          .limit(1000),
      ])

      const whNameById = new Map((whRes.data ?? []).map((w: any) => [w.id, w.name]))
      setWarehouses((whRes.data ?? []).map((w: any) => ({ id: w.id, name: w.name })))
      setProducts((prodRes.data ?? []).map((p: any) => ({ id: p.id, name: p.name })))

      const capRows = capRes.data ?? []
      setHasCapacityRows(capRows.length > 0)

      function rateFor(warehouseId: string, productId: string, asOf: string): number | null {
        const candidates = capRows.filter((c: any) =>
          c.warehouse_id === warehouseId && c.product_id === productId && c.effective_from <= asOf)
        if (candidates.length === 0) return null
        candidates.sort((a: any, b: any) => b.effective_from.localeCompare(a.effective_from))
        return Number(candidates[0].rated_capacity_per_day)
      }

      const pctByWarehouse = new Map<string, number[]>()
      for (const log of (logsRes.data ?? []) as any[]) {
        const order = Array.isArray(log.production_orders) ? log.production_orders[0] : log.production_orders
        const warehouseId = log.warehouse_id ?? order?.warehouse_id
        const productId = log.product_id ?? order?.product_id
        if (!warehouseId || !productId) continue
        const rate = rateFor(warehouseId, productId, log.log_date)
        if (!rate || rate <= 0) continue
        const pct = (Number(log.quantity_produced) / rate) * 100
        if (!pctByWarehouse.has(warehouseId)) pctByWarehouse.set(warehouseId, [])
        pctByWarehouse.get(warehouseId)!.push(pct)
      }

      const effRows: WarehouseEfficiency[] = []
      for (const [warehouseId, pcts] of pctByWarehouse) {
        const avg = pcts.reduce((s, v) => s + v, 0) / pcts.length
        const variance = pcts.reduce((s, v) => s + (v - avg) ** 2, 0) / pcts.length
        effRows.push({
          warehouseId, warehouseName: whNameById.get(warehouseId) ?? 'Unknown warehouse',
          avgEfficiencyPct: avg, consistencyStddev: Math.sqrt(variance), daysLogged: pcts.length,
        })
      }
      effRows.sort((a, b) => b.avgEfficiencyPct - a.avgEfficiencyPct)
      setEfficiency(effRows)

      const otByType = new Map<string, { hours: number; amount: number }>()
      for (const row of (otRes.data ?? []) as any[]) {
        const cur = otByType.get(row.ot_type) ?? { hours: 0, amount: 0 }
        cur.hours += Number(row.hours ?? 0)
        cur.amount += Number(row.amount_etb ?? 0)
        otByType.set(row.ot_type, cur)
      }
      setOvertime([...otByType.entries()].map(([otType, v]) => ({ otType, hours: v.hours, amountEtb: v.amount })))
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function saveCapacity() {
    if (!form.warehouseId || !form.productId || !form.rate || Number(form.rate) <= 0) {
      setError('Choose a warehouse, product, and a rate greater than 0.'); return
    }
    setSaving(true); setError(null)
    try {
      const { error: insErr } = await supabase.from('production_capacity').insert({
        warehouse_id: form.warehouseId, product_id: form.productId, rated_capacity_per_day: Number(form.rate),
      })
      if (insErr) throw insErr
      setForm({ warehouseId: '', productId: '', rate: '' })
      setAddOpen(false)
      await load()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-xs text-gray-400 py-4"><Loader2 size={14} className="animate-spin" /> Loading manufacturing performance…</div>
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* Capacity efficiency by warehouse */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5"><Gauge size={12} /> Capacity efficiency (last 30 days)</p>
          <button onClick={() => setAddOpen(v => !v)} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
            <Plus size={11} /> Set a rate
          </button>
        </div>

        {addOpen && (
          <div className="flex flex-wrap items-end gap-2 bg-gray-50 rounded-lg p-2.5 mb-3">
            <select value={form.warehouseId} onChange={e => setForm(p => ({ ...p, warehouseId: e.target.value }))}
              className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg bg-white">
              <option value="">Warehouse…</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <select value={form.productId} onChange={e => setForm(p => ({ ...p, productId: e.target.value }))}
              className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg bg-white">
              <option value="">Product…</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input type="number" min="1" placeholder="Units/day" value={form.rate}
              onChange={e => setForm(p => ({ ...p, rate: e.target.value }))}
              className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg w-24" />
            <button onClick={saveCapacity} disabled={saving}
              className="px-2.5 py-1.5 bg-blue-600 text-white text-xs rounded-lg disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}

        {efficiency.length === 0 ? (
          <p className="text-xs text-gray-400">
            {hasCapacityRows
              ? 'Rates are set, but no production has been logged against them in the last 30 days yet.'
              : 'No capacity rates set yet — add one above to start tracking efficiency.'}
          </p>
        ) : (
          <div className="space-y-1.5">
            {efficiency.map(row => {
              const eff = effLabel(row.avgEfficiencyPct)
              return (
                <div key={row.warehouseId} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                  <span className="font-medium text-gray-700">{row.warehouseName}</span>
                  <span className="text-gray-400">{row.daysLogged} log{row.daysLogged === 1 ? '' : 's'} · ±{N(row.consistencyStddev)}pp</span>
                  <span className={`px-2 py-0.5 rounded-full font-medium ${eff.cls}`}>{N(row.avgEfficiencyPct)}% · {eff.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Overtime by type */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1.5"><Clock3 size={12} /> Overtime hours by type</p>
        {overtime.length === 0 ? (
          <p className="text-xs text-gray-400">No overtime logged yet — this fills in once payroll runs classify_overtime_for_entry against real attendance data.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {overtime.map(o => (
              <div key={o.otType} className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400">{OT_TYPE_LABEL[o.otType] ?? o.otType}</p>
                <p className="text-sm font-medium font-mono text-gray-800">{N(o.hours)} hrs</p>
                <p className="text-xs text-gray-400">{new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(o.amountEtb)} ETB</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
