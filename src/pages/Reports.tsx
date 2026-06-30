import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart3, Loader2 } from 'lucide-react'

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

interface PLRow {
  month: string
  revenue: number
  cogs: number
  grossProfit: number
  grossMarginPct: number
  orderCount: number
}

export function Reports() {
  const [pl, setPL]         = useState<PLRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const sixAgo = new Date()
      sixAgo.setMonth(sixAgo.getMonth() - 5)
      sixAgo.setDate(1)

      const { data } = await supabase
        .from('sales_orders')
        .select('sale_date, total_etb, total_cogs_etb, gross_profit_etb')
        .gte('sale_date', sixAgo.toISOString().split('T')[0])
        .in('status', ['INVOICED', 'PAID'])
        .order('sale_date')

      const map = new Map<string, PLRow>()
      for (const row of data ?? []) {
        const month = row.sale_date.slice(0, 7)
        if (!map.has(month)) map.set(month, {
          month, revenue: 0, cogs: 0,
          grossProfit: 0, grossMarginPct: 0, orderCount: 0,
        })
        const e = map.get(month)!
        e.revenue     += row.total_etb ?? 0
        e.cogs        += row.total_cogs_etb ?? 0
        e.grossProfit += row.gross_profit_etb ?? 0
        e.orderCount  += 1
      }

      setPL([...map.values()].map(m => ({
        ...m,
        grossMarginPct: m.revenue > 0 ? (m.grossProfit / m.revenue) * 100 : 0,
      })))
      setLoading(false)
    }
    load()
  }, [])

  const totalRev    = pl.reduce((s, m) => s + m.revenue, 0)
  const totalProfit = pl.reduce((s, m) => s + m.grossProfit, 0)
  const avgMargin   = totalRev > 0 ? (totalProfit / totalRev) * 100 : 0

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-gray-400 gap-2">
      <Loader2 size={18} className="animate-spin" /> Loading…
    </div>
  )

  return (
    <div className="p-5 max-w-4xl mx-auto">

      <div className="mb-5">
        <h1 className="text-lg font-medium">Reports</h1>
        <p className="text-xs text-gray-400 mt-0.5">Last 6 months</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Total revenue',  val: N(totalRev) + ' ETB',          color: 'text-blue-700'  },
          { label: 'Gross profit',   val: N(totalProfit) + ' ETB',        color: 'text-green-700' },
          { label: 'Average margin', val: Math.round(avgMargin) + '%',    color: 'text-green-700' },
        ].map(k => (
          <div key={k.label} className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{k.label}</p>
            <p className={`text-xl font-medium ${k.color}`}>{k.val}</p>
          </div>
        ))}
      </div>

      {pl.length === 0 ? (
        <div className="text-center py-16">
          <BarChart3 size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No sales data yet</p>
          <p className="text-xs text-gray-400">
            Reports populate automatically once sales orders are created and invoiced.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5
                          bg-gray-50 border-b border-gray-100
                          text-xs font-medium text-gray-400 uppercase tracking-wide">
            <div>Month</div>
            <div className="text-right">Orders</div>
            <div className="text-right">Revenue</div>
            <div className="text-right">COGS</div>
            <div className="text-right">Gross profit</div>
            <div className="text-right">Margin</div>
          </div>

          {pl.map((m, i) => {
            const mc = m.grossMarginPct >= 30
              ? 'text-green-700' : m.grossMarginPct >= 20
                ? 'text-amber-700' : 'text-red-600'
            return (
              <div
                key={m.month}
                className={`grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3
                            items-center text-sm
                            ${i < pl.length - 1 ? 'border-b border-gray-50' : ''}`}
              >
                <div className="font-medium">
                  {new Date(m.month + '-01').toLocaleDateString('en-ET',
                    { month: 'short', year: 'numeric' })}
                </div>
                <div className="text-right text-gray-500">{m.orderCount}</div>
                <div className="text-right font-mono font-medium text-blue-700">
                  {N(m.revenue / 1000)}K
                </div>
                <div className="text-right font-mono text-gray-500">
                  {N(m.cogs / 1000)}K
                </div>
                <div className="text-right font-mono font-medium text-green-700">
                  {N(m.grossProfit / 1000)}K
                </div>
                <div className={`text-right font-medium ${mc}`}>
                  {Math.round(m.grossMarginPct)}%
                </div>
              </div>
            )
          })}

          {/* Totals */}
          <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3
                          bg-gray-50 border-t border-gray-100 font-medium text-sm">
            <div className="text-gray-500">Total</div>
            <div className="text-right text-gray-500">
              {pl.reduce((s, m) => s + m.orderCount, 0)}
            </div>
            <div className="text-right font-mono text-blue-700">
              {N(totalRev / 1000)}K ETB
            </div>
            <div className="text-right font-mono text-gray-500">
              {N(pl.reduce((s, m) => s + m.cogs, 0) / 1000)}K ETB
            </div>
            <div className="text-right font-mono text-green-700">
              {N(totalProfit / 1000)}K ETB
            </div>
            <div className={`text-right ${avgMargin >= 25 ? 'text-green-700' : 'text-red-600'}`}>
              {Math.round(avgMargin)}%
            </div>
          </div>
        </div>
      )}
    </div>
  )
}