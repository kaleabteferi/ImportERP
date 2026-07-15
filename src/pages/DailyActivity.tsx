import { useState, useEffect, useMemo } from 'react'
import { fetchDailyActivityData, fetchExpensesByDate } from '../api/dailyActivity'
import type { DailyActivityData } from '../api/dailyActivity'
import {
  CalendarDays, Loader2, Package, ShoppingCart, ArrowLeftRight,
  Receipt, Truck, AlertTriangle,
} from 'lucide-react'

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

const PURPOSE_LABEL: Record<string, string> = {
  WAREHOUSE_TO_WAREHOUSE: 'Warehouse transfer',
  SALES: 'Sales dispatch',
  RETURN: 'Return',
  OTHER: 'Other',
}

interface DayGroup {
  date: string
  production: Array<{ warehouseName: string; productName: string; quantity: number }>
  transfers: Array<{
    quantity: number; fromWarehouseName: string; toWarehouseName: string | null
    productName: string; purpose: string; driverName: string | null
    truckPlate: string | null; status: string
  }>
  sales: Array<{ warehouseName: string; orderCount: number; totalEtb: number }>
  stockMoves: Array<{ warehouseName: string; in: number; out: number }>
  expensesEtb: number
  expensesUsd: number
}

export function DailyActivity() {
  const [data, setData] = useState<DailyActivityData | null>(null)
  const [expenseByDate, setExpenseByDate] = useState<Record<string, { etb: number; usd: number }>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const activity = await fetchDailyActivityData(14)
        setData(activity)

        const dates = [...new Set([
          ...activity.productionLogs.map(r => r.log_date),
          ...activity.transfers.map(r => r.transfer_date),
          ...activity.sales.map(r => r.sale_date),
        ])]
        const expenses = await fetchExpensesByDate(dates)
        const map: Record<string, { etb: number; usd: number }> = {}
        for (const e of (expenses ?? []) as any[]) {
          const d = e.expense_date
          if (!map[d]) map[d] = { etb: 0, usd: 0 }
          if (e.currency === 'ETB') map[d].etb += Number(e.amount ?? 0)
          else map[d].usd += Number(e.amount ?? 0)
        }
        setExpenseByDate(map)
      } catch (e: any) {
        console.error(e)
        setError(e?.message ?? 'Unable to load daily activity.')
        setData(null)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const days: DayGroup[] = useMemo(() => {
    if (!data) return []
    const warehouseName = (id: string | null) => data.warehouses.find(w => w.id === id)?.name ?? 'Unassigned'
    const productName = (id: string | null) => data.products.find(p => p.id === id)?.name ?? 'Unknown item'

    const dates = new Set<string>([
      ...data.productionLogs.map(r => r.log_date),
      ...data.transfers.map(r => r.transfer_date),
      ...data.sales.map(r => r.sale_date),
      ...data.stockMoves.map(r => r.movement_date),
    ])

    return [...dates]
      .sort((a, b) => b.localeCompare(a))
      .map(date => {
        const production = data.productionLogs
          .filter(r => r.log_date === date)
          .map(r => ({
            warehouseName: warehouseName(r.warehouse_id),
            productName: productName(r.product_id),
            quantity: r.quantity_produced,
          }))

        const transfers = data.transfers
          .filter(r => r.transfer_date === date)
          .map(r => ({
            quantity: r.quantity,
            fromWarehouseName: warehouseName(r.from_warehouse_id),
            toWarehouseName: r.to_warehouse_id ? warehouseName(r.to_warehouse_id) : null,
            productName: productName(r.product_id),
            purpose: r.purpose,
            driverName: r.driver_name,
            truckPlate: r.truck_plate,
            status: r.status,
          }))

        const salesByWarehouse = new Map<string, { orderCount: number; totalEtb: number }>()
        for (const s of data.sales.filter(r => r.sale_date === date)) {
          const key = warehouseName(s.warehouse_id)
          const entry = salesByWarehouse.get(key) ?? { orderCount: 0, totalEtb: 0 }
          entry.orderCount += 1
          entry.totalEtb += Number(s.total_etb ?? 0)
          salesByWarehouse.set(key, entry)
        }
        const sales = [...salesByWarehouse.entries()].map(([warehouseName, v]) => ({ warehouseName, ...v }))

        const movesByWarehouse = new Map<string, { in: number; out: number }>()
        for (const m of data.stockMoves.filter(r => r.movement_date === date)) {
          const key = warehouseName(m.warehouse_id)
          const entry = movesByWarehouse.get(key) ?? { in: 0, out: 0 }
          if (Number(m.quantity) > 0) entry.in += 1
          else if (Number(m.quantity) < 0) entry.out += 1
          movesByWarehouse.set(key, entry)
        }
        const stockMoves = [...movesByWarehouse.entries()].map(([warehouseName, v]) => ({ warehouseName, ...v }))

        return {
          date, production, transfers, sales, stockMoves,
          expensesEtb: expenseByDate[date]?.etb ?? 0,
          expensesUsd: expenseByDate[date]?.usd ?? 0,
        }
      })
  }, [data, expenseByDate])

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <CalendarDays size={18} /> Daily activity
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">What happened each day — production, transfers, sales, stock movement, spend</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertTriangle size={14} /> {error}
        </div>
      ) : days.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400">
          No activity in the last 14 days yet. This fills in as production is logged,
          transfers move stock, and sales happen.
        </div>
      ) : (
        <div className="space-y-4">
          {days.map(day => {
            const totalUnits = day.production.reduce((s, p) => s + p.quantity, 0)
            const totalOrders = day.sales.reduce((s, w) => s + w.orderCount, 0)
            const totalSalesEtb = day.sales.reduce((s, w) => s + w.totalEtb, 0)

            return (
              <div key={day.date} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm font-medium">{day.date}</p>
                  <div className="flex gap-4 text-xs text-gray-500 flex-wrap">
                    <span className="flex items-center gap-1"><Package size={12} /> {N(totalUnits)} units produced</span>
                    <span className="flex items-center gap-1"><Truck size={12} /> {day.transfers.length} transfers</span>
                    <span className="flex items-center gap-1"><ShoppingCart size={12} /> {totalOrders} orders · {N(totalSalesEtb)} ETB</span>
                    {(day.expensesEtb > 0 || day.expensesUsd > 0) && (
                      <span className="flex items-center gap-1 text-red-600">
                        <Receipt size={12} />
                        {day.expensesEtb > 0 && `${N(day.expensesEtb)} ETB`}
                        {day.expensesUsd > 0 && ` $${N(day.expensesUsd)}`}
                      </span>
                    )}
                  </div>
                </div>

                {day.production.length === 0 && day.transfers.length === 0 && day.sales.length === 0 && day.stockMoves.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-gray-400">No activity recorded.</div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {day.production.length > 0 && (
                      <div className="px-4 py-2.5">
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                          <Package size={11} /> Production
                        </p>
                        {day.production.map((p, i) => (
                          <div key={i} className="flex items-center gap-3 text-xs py-0.5">
                            <span className="flex-1 text-gray-700">{p.productName}</span>
                            <span className="text-gray-400 w-32">{p.warehouseName}</span>
                            <span className="text-gray-900 font-medium font-mono">{N(p.quantity)} units</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {day.transfers.length > 0 && (
                      <div className="px-4 py-2.5">
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                          <Truck size={11} /> Warehouse transfers
                        </p>
                        {day.transfers.map((t, i) => (
                          <div key={i} className="flex items-center gap-3 text-xs py-0.5 flex-wrap">
                            <span className="flex-1 text-gray-700 min-w-[120px]">{t.productName} · {N(t.quantity)}</span>
                            <span className="text-gray-400">
                              {t.fromWarehouseName} → {t.toWarehouseName ?? PURPOSE_LABEL[t.purpose] ?? t.purpose}
                            </span>
                            {(t.driverName || t.truckPlate) && (
                              <span className="text-gray-400">{[t.driverName, t.truckPlate].filter(Boolean).join(' · ')}</span>
                            )}
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                              t.status === 'RECEIVED' ? 'bg-green-100 text-green-700'
                                : t.status === 'CANCELLED' ? 'bg-gray-100 text-gray-500'
                                : 'bg-amber-50 text-amber-700'
                            }`}>
                              {t.status === 'IN_TRANSIT' ? 'In transit' : t.status.charAt(0) + t.status.slice(1).toLowerCase()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {day.sales.length > 0 && (
                      <div className="px-4 py-2.5">
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                          <ShoppingCart size={11} /> Sales
                        </p>
                        {day.sales.map((w, i) => (
                          <div key={i} className="flex items-center gap-3 text-xs py-0.5">
                            <span className="flex-1 text-gray-700">{w.warehouseName}</span>
                            <span className="text-gray-400">{w.orderCount} orders</span>
                            <span className="text-gray-900 font-medium font-mono">{N(w.totalEtb)} ETB</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {day.stockMoves.length > 0 && (
                      <div className="px-4 py-2.5">
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                          <ArrowLeftRight size={11} /> Stock movement
                        </p>
                        {day.stockMoves.map((w, i) => (
                          <div key={i} className="flex items-center gap-3 text-xs py-0.5">
                            <span className="flex-1 text-gray-700">{w.warehouseName}</span>
                            <span className="text-gray-400">{w.in} in · {w.out} out</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
