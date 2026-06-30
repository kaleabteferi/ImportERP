import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Wrench, X, Check, Loader2, BarChart3, Package } from 'lucide-react'

interface ProductionOrder {
  id: string
  order_number: string
  target_quantity: number
  completed_quantity: number
  status: string
  planned_start_date: string | null
  labor_cost_etb: number
  bom_header_id: string | null
  bom_headers: { products: { id: string; name: string; sku: string } | null } | null
}

interface DailyLog {
  id: string
  log_date: string
  quantity_produced: number
  production_order_id: string
  notes: string | null
  production_orders?: { order_number: string; bom_headers: { products: { name: string } | null } | null }
}

interface DayMovement {
  id: string
  movement_type: string
  quantity: number
  movement_date: string
  notes: string | null
  products: { name: string; sku: string } | null
}

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

const STATUS_STYLE: Record<string, string> = {
  DRAFT:       'bg-gray-100 text-gray-600',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
  COMPLETED:   'bg-green-50 text-green-700',
  CANCELLED:   'bg-red-50 text-red-700',
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled',
}

function normBom(bom: any) {
  if (!bom) return null
  const row = Array.isArray(bom) ? bom[0] : bom
  if (!row) return null
  const products = row.products
  return {
    products: Array.isArray(products) ? products[0] ?? null : products,
  }
}

function normOrder(o: any): ProductionOrder {
  return { ...o, bom_headers: normBom(o.bom_headers) }
}

function normLog(l: any): DailyLog {
  const po = Array.isArray(l.production_orders) ? l.production_orders[0] : l.production_orders
  return {
    ...l,
    production_orders: po
      ? { ...po, bom_headers: normBom(po.bom_headers) }
      : undefined,
  }
}

export function Production() {
  const [orders, setOrders]     = useState<ProductionOrder[]>([])
  const [logs, setLogs]         = useState<DailyLog[]>([])
  const [movements, setMovements] = useState<DayMovement[]>([])
  const [salesToday, setSalesToday] = useState(0)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState<'orders' | 'report'>('orders')
  const [logOpen, setLogOpen]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [entries, setEntries]   = useState<Record<string, string>>({})
  const [logDate, setLogDate]   = useState(new Date().toISOString().split('T')[0])
  const [logNotes, setLogNotes] = useState('')

  async function load() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const since = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]

    const [ordersRes, logsRes, moveRes, salesRes] = await Promise.all([
      supabase.from('production_orders')
        .select('id, order_number, target_quantity, completed_quantity, status, planned_start_date, labor_cost_etb, bom_header_id, bom_headers(products(id, name, sku))')
        .in('status', ['DRAFT', 'IN_PROGRESS'])
        .order('created_at', { ascending: false }),
      supabase.from('production_daily_logs')
        .select('id, log_date, quantity_produced, production_order_id, notes, production_orders(order_number, bom_headers(products(name)))')
        .gte('log_date', since)
        .order('log_date', { ascending: false }),
      supabase.from('inventory_ledger')
        .select('id, movement_type, quantity, movement_date, notes, products(name, sku)')
        .gte('movement_date', since)
        .in('movement_type', ['PRODUCTION_CONSUMED', 'PRODUCTION_OUTPUT', 'SALE'])
        .order('movement_date', { ascending: false }),
      supabase.from('sales_orders')
        .select('total_etb')
        .eq('sale_date', today)
        .in('status', ['INVOICED', 'PAID']),
    ])

    setOrders((ordersRes.data ?? []).map(normOrder))
    setLogs((logsRes.data ?? []).map(normLog))
    setMovements((moveRes.data ?? []).map(m => ({
      ...m,
      products: Array.isArray(m.products) ? m.products[0] ?? null : m.products,
    })))
    setSalesToday((salesRes.data ?? []).reduce((s, r) => s + (r.total_etb ?? 0), 0))

    const todayLogs = (logsRes.data ?? []).filter(l => l.log_date === today)
    const e: Record<string, string> = {}
    for (const l of todayLogs) {
      e[l.production_order_id] = String(l.quantity_produced)
    }
    setEntries(e)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function saveLog() {
    setSaving(true)
    setError(null)
    const active = orders.filter(o => o.status === 'IN_PROGRESS')
    if (!active.length) { setError('No orders in progress.'); setSaving(false); return }

    try {
      for (const order of active) {
        const qty = parseInt(entries[order.id] ?? '0')
        if (qty <= 0) continue

        const productId = order.bom_headers?.products?.id
        if (!productId) continue

        const { data: existing } = await supabase
          .from('production_daily_logs')
          .select('id, quantity_produced')
          .eq('production_order_id', order.id)
          .eq('log_date', logDate)
          .maybeSingle()

        const prevQty = existing?.quantity_produced ?? 0
        const delta   = qty - prevQty

        if (existing) {
          await supabase.from('production_daily_logs')
            .update({ quantity_produced: qty, notes: logNotes || null })
            .eq('id', existing.id)
        } else {
          await supabase.from('production_daily_logs').insert({
            production_order_id: order.id,
            log_date: logDate,
            quantity_produced: qty,
            notes: logNotes || null,
          })
        }

        if (delta !== 0) {
          const newCompleted = Math.min(
            order.target_quantity,
            Math.max(0, order.completed_quantity + delta),
          )
          await supabase.from('production_orders').update({
            completed_quantity: newCompleted,
            status: newCompleted >= order.target_quantity ? 'COMPLETED' : 'IN_PROGRESS',
          }).eq('id', order.id)

          // Finished goods into inventory
          await supabase.from('inventory_ledger').insert({
            product_id:    productId,
            quantity:      delta,
            movement_type: 'PRODUCTION_OUTPUT',
            movement_date: logDate,
            notes:         `Assembly line output · ${order.order_number}`,
            reference_type: 'production_order',
            reference_id:   order.id,
          })

          // Component withdrawal (BOM consumption estimate)
          if (delta > 0 && order.bom_header_id) {
            const { data: bomLines } = await supabase
              .from('bom_lines')
              .select('component_product_id, quantity_per_unit')
              .eq('bom_header_id', order.bom_header_id)

            for (const line of bomLines ?? []) {
              await supabase.from('inventory_ledger').insert({
                product_id:    line.component_product_id,
                quantity:      -(line.quantity_per_unit * delta),
                movement_type: 'PRODUCTION_CONSUMED',
                movement_date: logDate,
                notes:         `Withdrawn for ${order.order_number}`,
                reference_type: 'production_order',
                reference_id:   order.id,
              })
            }
          }
        }
      }

      setLogOpen(false)
      setLogNotes('')
      load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const inProgress = orders.filter(o => o.status === 'IN_PROGRESS')
  const todayStr   = new Date().toISOString().split('T')[0]
  const totalToday = logs
    .filter(l => l.log_date === todayStr)
    .reduce((s, l) => s + l.quantity_produced, 0)

  const withdrawals = movements.filter(m => m.movement_type === 'PRODUCTION_CONSUMED')
  const outputs     = movements.filter(m => m.movement_type === 'PRODUCTION_OUTPUT')
  const salesMoves  = movements.filter(m => m.movement_type === 'SALE')

  return (
    <div className="p-5 max-w-4xl mx-auto">

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium">Production</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {inProgress.length} orders in progress
            {totalToday > 0 && ` · ${N(totalToday)} units logged today`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {(['orders', 'report'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize
                  ${tab === t
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              >
                {t === 'orders' ? 'Assembly lines' : 'Daily report'}
              </button>
            ))}
          </div>
          <button
            onClick={() => { setLogOpen(true); setError(null) }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white
                       text-xs rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={13} /> Log production
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && tab === 'orders' && orders.length === 0 && (
        <div className="text-center py-16">
          <Wrench size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No production orders</p>
          <p className="text-xs text-gray-400 max-w-xs mx-auto">
            Create production orders from BOMs. SKD/CKD shipments feed component stock
            for assembly lines.
          </p>
        </div>
      )}

      {!loading && tab === 'orders' && (
        <div className="space-y-3">
          {orders.map(order => {
            const prod     = order.bom_headers?.products
            const pct      = order.target_quantity > 0
              ? Math.min(100, Math.round(order.completed_quantity / order.target_quantity * 100))
              : 0
            const todayLog = logs.find(l =>
              l.production_order_id === order.id && l.log_date === todayStr)
            const barColor = pct >= 100
              ? 'bg-green-500' : pct >= 50 ? 'bg-blue-500' : 'bg-amber-400'
            const remaining = order.target_quantity - order.completed_quantity

            return (
              <div key={order.id}
                   className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">
                        {prod?.name ?? 'Unknown product'}
                      </span>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium
                        ${STATUS_STYLE[order.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABEL[order.status] ?? order.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">
                      {order.order_number}
                      {prod?.sku && ` · ${prod.sku}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-medium font-mono text-blue-700">{pct}%</p>
                    <p className="text-xs text-gray-400">complete</p>
                  </div>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
                  <div className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                       style={{ width: `${pct}%` }} />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Target',    val: N(order.target_quantity) },
                    { label: 'Done',      val: N(order.completed_quantity) },
                    { label: 'Remaining', val: N(remaining) },
                    { label: 'Today',     val: todayLog ? N(todayLog.quantity_produced) : '—' },
                  ].map(stat => (
                    <div key={stat.label}
                         className="bg-gray-50 rounded-lg px-3 py-2 text-center">
                      <p className="text-xs text-gray-400 mb-1">{stat.label}</p>
                      <p className="text-sm font-medium font-mono">{stat.val}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && tab === 'report' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Produced today', val: `${N(totalToday)} units`, icon: Wrench },
              { label: 'Sales today', val: `${N(salesToday)} ETB`, icon: BarChart3 },
              { label: 'Withdrawals (30d)', val: String(withdrawals.length), icon: Package },
            ].map(s => (
              <div key={s.label} className="bg-gray-50 rounded-xl px-4 py-3">
                <p className="text-xs text-gray-400">{s.label}</p>
                <p className="text-sm font-medium font-mono mt-1">{s.val}</p>
              </div>
            ))}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500">
              Production logs (last 30 days)
            </div>
            {logs.length === 0 ? (
              <p className="px-4 py-6 text-xs text-gray-400 text-center">No logs yet</p>
            ) : logs.map((l, i) => (
              <div key={l.id}
                   className={`flex items-center justify-between px-4 py-2.5 text-xs
                     ${i < logs.length - 1 ? 'border-b border-gray-50' : ''}`}>
                <span className="text-gray-600">
                  {l.log_date} · {(l.production_orders as any)?.bom_headers?.products?.name ?? '—'}
                </span>
                <span className="font-mono font-medium">{N(l.quantity_produced)} units</span>
              </div>
            ))}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500">
              Warehouse withdrawals & sales
            </div>
            {[...withdrawals, ...outputs, ...salesMoves].length === 0 ? (
              <p className="px-4 py-6 text-xs text-gray-400 text-center">No movements recorded</p>
            ) : [...withdrawals, ...outputs, ...salesMoves]
              .sort((a, b) => b.movement_date.localeCompare(a.movement_date))
              .map((m, i, arr) => (
                <div key={m.id}
                     className={`flex items-center justify-between px-4 py-2.5 text-xs
                       ${i < arr.length - 1 ? 'border-b border-gray-50' : ''}`}>
                  <span className="text-gray-600">
                    {m.movement_date} · {m.products?.name ?? '—'} ·{' '}
                    <span className={
                      m.movement_type === 'SALE' ? 'text-red-600'
                        : m.movement_type === 'PRODUCTION_OUTPUT' ? 'text-green-600'
                        : 'text-amber-600'
                    }>
                      {m.movement_type.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  </span>
                  <span className={`font-mono font-medium ${m.quantity < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {m.quantity > 0 ? '+' : ''}{N(m.quantity)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Log Modal — unchanged structure */}
      {logOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setLogOpen(false)}
        >
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh]
                          overflow-auto shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-medium">Log production</h2>
              <button onClick={() => setLogOpen(false)}
                      className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Log date</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                             focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={logDate}
                  onChange={e => setLogDate(e.target.value)}
                />
              </div>
              {inProgress.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400 bg-gray-50 rounded-xl">
                  No orders currently in progress.
                </div>
              ) : (
                <div className="space-y-3">
                  {inProgress.map(order => {
                    const prod      = order.bom_headers?.products
                    const remaining = order.target_quantity - order.completed_quantity
                    return (
                      <div key={order.id} className="bg-gray-50 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium">{prod?.name ?? '—'}</p>
                          <span className="text-xs text-blue-600">max {N(remaining)}</span>
                        </div>
                        <input
                          type="number" min="0" max={remaining}
                          value={entries[order.id] ?? ''}
                          onChange={e => setEntries(p => ({ ...p, [order.id]: e.target.value }))}
                          placeholder="0"
                          className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg"
                        />
                      </div>
                    )
                  })}
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none"
                  value={logNotes}
                  onChange={e => setLogNotes(e.target.value)}
                />
              </div>
              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  {error}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setLogOpen(false)}
                      className="px-4 py-2 text-xs border border-gray-200 rounded-lg">
                Cancel
              </button>
              <button onClick={saveLog} disabled={saving || inProgress.length === 0}
                      className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white
                                 text-xs rounded-lg disabled:opacity-50">
                {saving
                  ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                  : <><Check size={12} /> Save</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}