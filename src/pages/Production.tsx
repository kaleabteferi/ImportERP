import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Wrench, X, Check, Loader2 } from 'lucide-react'

interface ProductionOrder {
  id: string
  order_number: string
  target_quantity: number
  completed_quantity: number
  status: string
  planned_start_date: string | null
  labor_cost_etb: number
  bom_headers: { products: { name: string; sku: string } | null } | null
}

interface DailyLog {
  id: string
  log_date: string
  quantity_produced: number
  production_order_id: string
  notes: string | null
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

export function Production() {
  const [orders, setOrders]   = useState<ProductionOrder[]>([])
  const [logs, setLogs]       = useState<DailyLog[]>([])
  const [loading, setLoading] = useState(true)
  const [logOpen, setLogOpen] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [entries, setEntries] = useState<Record<string, string>>({})
  const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0])
  const [logNotes, setLogNotes] = useState('')

  async function load() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const [ordersRes, logsRes] = await Promise.all([
      supabase.from('production_orders')
        .select('id, order_number, target_quantity, completed_quantity, status, planned_start_date, labor_cost_etb, bom_headers(products(name, sku))')
        .in('status', ['DRAFT', 'IN_PROGRESS'])
        .order('created_at', { ascending: false }),
      supabase.from('production_daily_logs')
        .select('id, log_date, quantity_produced, production_order_id, notes')
        .eq('log_date', today),
    ])
    setOrders(ordersRes.data ?? [])
    setLogs(logsRes.data ?? [])
    const e: Record<string, string> = {}
    for (const l of logsRes.data ?? []) {
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

    for (const order of active) {
      const qty = parseInt(entries[order.id] ?? '0')
      if (qty <= 0) continue

      const { data: existing } = await supabase
        .from('production_daily_logs')
        .select('id')
        .eq('production_order_id', order.id)
        .eq('log_date', logDate)
        .single()

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

      const newCompleted = Math.min(order.target_quantity, order.completed_quantity + qty)
      await supabase.from('production_orders').update({
        completed_quantity: newCompleted,
        status: newCompleted >= order.target_quantity ? 'COMPLETED' : 'IN_PROGRESS',
      }).eq('id', order.id)
    }

    setSaving(false)
    setLogOpen(false)
    setLogNotes('')
    load()
  }

  const inProgress  = orders.filter(o => o.status === 'IN_PROGRESS')
  const totalToday  = logs.reduce((s, l) => s + l.quantity_produced, 0)

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
        <button
          onClick={() => { setLogOpen(true); setError(null) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white
                     text-xs rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={13} /> Log today's production
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && orders.length === 0 && (
        <div className="text-center py-16">
          <Wrench size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No production orders</p>
          <p className="text-xs text-gray-400 max-w-xs mx-auto">
            Production orders are created from your Bill of Materials.
            Add products and BOMs in Supabase to get started.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {orders.map(order => {
          const prod     = (order.bom_headers as any)?.products
          const pct      = order.target_quantity > 0
            ? Math.min(100, Math.round(order.completed_quantity / order.target_quantity * 100))
            : 0
          const todayLog = logs.find(l => l.production_order_id === order.id)
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

              {/* Progress bar */}
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
                <div className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                     style={{ width: `${pct}%` }} />
              </div>

              {/* Stats */}
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

      {/* Log Modal */}
      {logOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setLogOpen(false)}
        >
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh]
                          overflow-auto shadow-xl">

            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-medium">Log today's production</h2>
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
                  <p className="text-xs text-gray-500">
                    Units assembled today per product:
                  </p>
                  {inProgress.map(order => {
                    const prod      = (order.bom_headers as any)?.products
                    const remaining = order.target_quantity - order.completed_quantity
                    return (
                      <div key={order.id}
                           className="bg-gray-50 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="text-sm font-medium">{prod?.name ?? '—'}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {N(order.completed_quantity)} / {N(order.target_quantity)} done
                              · {N(remaining)} remaining
                            </p>
                          </div>
                          <span className="text-xs text-blue-600 font-medium">
                            max {N(remaining)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            max={remaining}
                            value={entries[order.id] ?? ''}
                            onChange={e => setEntries(prev => ({
                              ...prev, [order.id]: e.target.value
                            }))}
                            placeholder="0"
                            className="w-24 px-3 py-2 text-sm font-mono text-right
                                       border border-gray-200 rounded-lg
                                       focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                          <span className="text-xs text-gray-400">units assembled</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                             focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                  value={logNotes}
                  onChange={e => setLogNotes(e.target.value)}
                  placeholder="Any notes about today's production…"
                />
              </div>

              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg
                                text-xs text-red-700">
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4
                            border-t border-gray-100">
              <button
                onClick={() => setLogOpen(false)}
                className="px-4 py-2 text-xs text-gray-600 border border-gray-200
                           rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveLog}
                disabled={saving || inProgress.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white
                           text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50
                           transition-colors min-w-[140px] justify-center"
              >
                {saving
                  ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                  : <><Check size={12} /> Save production log</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}