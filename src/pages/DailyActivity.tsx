import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { fetchDailyActivityData } from '../api/dailyActivity'
import type { DailyActivityData, MoneyRow } from '../api/dailyActivity'
import { usePageState } from '../lib/pageState'
import {
  CalendarDays, Loader2, Package, ShoppingCart, ArrowLeftRight,
  Receipt, Truck, AlertTriangle, Ship, SlidersHorizontal, TrendingUp, TrendingDown,
  ArrowUpDown, ChevronDown, Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

const PURPOSE_LABEL: Record<string, string> = {
  WAREHOUSE_TO_WAREHOUSE: 'Warehouse transfer',
  SALES: 'Sales dispatch',
  RETURN: 'Return',
  OTHER: 'Other',
}

const MONEY_CATEGORY_LABEL: Record<MoneyRow['category'], string> = {
  sale: 'Sale payment',
  credit_repayment: 'Credit repayment',
  expense: 'Expense',
  supplier_payment: 'Supplier payment',
  shipment_expense: 'Shipment cost',
}

type CategoryKey = 'production' | 'shipments_received' | 'transfers' | 'sales' | 'damage' | 'adjustments' | 'money'

interface CategoryDef { key: CategoryKey; label: string; icon: LucideIcon; badge: string; accent: string }

// Order here doubles as the "Default" section order. Roughly the physical
// flow of goods through the business — inbound, made, moved, sold, lost,
// corrected — with money last since it's a summary, not an itemized list.
const CATEGORIES: CategoryDef[] = [
  { key: 'shipments_received', label: 'Shipments received', icon: Ship, badge: 'bg-indigo-50 text-indigo-700', accent: 'text-indigo-500' },
  { key: 'production', label: 'Production', icon: Package, badge: 'bg-blue-50 text-blue-700', accent: 'text-blue-500' },
  { key: 'transfers', label: 'Warehouse transfers', icon: Truck, badge: 'bg-purple-50 text-purple-700', accent: 'text-purple-500' },
  { key: 'sales', label: 'Sales', icon: ShoppingCart, badge: 'bg-green-50 text-green-700', accent: 'text-green-500' },
  { key: 'damage', label: 'Damage & loss', icon: AlertTriangle, badge: 'bg-red-50 text-red-700', accent: 'text-red-500' },
  { key: 'adjustments', label: 'Stock adjustments', icon: SlidersHorizontal, badge: 'bg-amber-50 text-amber-700', accent: 'text-amber-500' },
  { key: 'money', label: 'Money', icon: ArrowLeftRight, badge: 'bg-gray-100 text-gray-600', accent: 'text-gray-500' },
]

interface Row { key: string; magnitude: number; content: React.ReactNode }
interface DaySection { def: CategoryDef; rows: Row[]; magnitude: number }
interface DayGroup {
  date: string; sections: DaySection[]
  cashInEtb: number; cashOutEtb: number; foreignOut: { currency: string; amount: number }[]
  totalUnits: number; totalOrders: number; totalSalesEtb: number; totalTransfers: number
  shipmentsCount: number; damageCount: number; damageUnits: number; adjustmentsCount: number
}

function joinClauses(clauses: string[]): string {
  if (clauses.length === 0) return ''
  if (clauses.length === 1) return clauses[0]
  if (clauses.length === 2) return clauses.join(' and ')
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`
}

// Plain-English summary of one day, in the same terse, number-forward
// voice as the Dashboard's advice cards — built deterministically from
// the same totals shown in the header strip, not a separate computation,
// so the sentence can never say something the numbers above it don't.
function describeDay(day: DayGroup): string {
  const clauses: string[] = []
  if (day.shipmentsCount > 0) clauses.push(`received ${day.shipmentsCount} shipment${day.shipmentsCount === 1 ? '' : 's'}`)
  if (day.totalUnits > 0) clauses.push(`produced ${N(day.totalUnits)} units`)
  if (day.totalTransfers > 0) clauses.push(`moved stock across ${day.totalTransfers} transfer${day.totalTransfers === 1 ? '' : 's'}`)
  if (day.totalOrders > 0) clauses.push(`sold ${N(day.totalSalesEtb)} ETB across ${day.totalOrders} order${day.totalOrders === 1 ? '' : 's'}`)
  if (day.damageCount > 0) clauses.push(`lost ${N(day.damageUnits)} units to damage`)
  if (day.adjustmentsCount > 0) clauses.push(`logged ${day.adjustmentsCount} stock correction${day.adjustmentsCount === 1 ? '' : 's'}`)

  if (clauses.length === 0) return 'No recorded activity.'

  let sentence = joinClauses(clauses)
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.'

  const netCash = day.cashInEtb - day.cashOutEtb
  if (day.cashInEtb > 0 || day.cashOutEtb > 0) {
    sentence += ` Cash ${netCash >= 0 ? 'up' : 'down'} ${N(Math.abs(netCash))} ETB net.`
  }
  return sentence
}

// Same voice, rolled up across the whole visible window — the "so what"
// a reader wants before scrolling through 14 individual day cards.
function describePeriod(days: DayGroup[]): string {
  if (days.length === 0) return ''
  const totalUnits = days.reduce((s, d) => s + d.totalUnits, 0)
  const totalShipments = days.reduce((s, d) => s + d.shipmentsCount, 0)
  const totalOrders = days.reduce((s, d) => s + d.totalOrders, 0)
  const totalSalesEtb = days.reduce((s, d) => s + d.totalSalesEtb, 0)
  const totalTransfers = days.reduce((s, d) => s + d.totalTransfers, 0)
  const totalDamageUnits = days.reduce((s, d) => s + d.damageUnits, 0)
  const totalDamageCount = days.reduce((s, d) => s + d.damageCount, 0)
  const totalAdjustments = days.reduce((s, d) => s + d.adjustmentsCount, 0)
  const netCash = days.reduce((s, d) => s + d.cashInEtb - d.cashOutEtb, 0)
  const activeDays = days.filter(d => d.sections.length > 0).length

  const clauses: string[] = []
  if (totalUnits > 0) clauses.push(`${N(totalUnits)} units produced`)
  if (totalShipments > 0) clauses.push(`${totalShipments} shipment${totalShipments === 1 ? '' : 's'} received`)
  if (totalOrders > 0) clauses.push(`${N(totalSalesEtb)} ETB sold across ${totalOrders} order${totalOrders === 1 ? '' : 's'}`)
  if (totalTransfers > 0) clauses.push(`${totalTransfers} warehouse transfer${totalTransfers === 1 ? '' : 's'}`)
  if (totalAdjustments > 0) clauses.push(`${totalAdjustments} stock correction${totalAdjustments === 1 ? '' : 's'}`)

  let summary = `Over ${days.length} day${days.length === 1 ? '' : 's'} (${activeDays} with recorded activity): ${joinClauses(clauses) || 'nothing recorded'}.`
  summary += ` Net cash ${netCash >= 0 ? 'up' : 'down'} ${N(Math.abs(netCash))} ETB.`
  if (totalDamageCount > 0) {
    summary += ` ${N(totalDamageUnits)} unit${totalDamageUnits === 1 ? '' : 's'} lost to damage across ${totalDamageCount} report${totalDamageCount === 1 ? '' : 's'} — worth a look.`
  }
  return summary
}

export function DailyActivity() {
  const [data, setData] = useState<DailyActivityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visibleCategories, setVisibleCategories] = usePageState<CategoryKey[]>('dailyActivity.categories', CATEGORIES.map(c => c.key))
  const [dayOrder, setDayOrder] = usePageState<'newest' | 'oldest'>('dailyActivity.dayOrder', 'newest')
  const [sectionOrder, setSectionOrder] = usePageState<'default' | 'busiest'>('dailyActivity.sectionOrder', 'default')

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const activity = await fetchDailyActivityData(14)
        setData(activity)
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

  function toggleCategory(key: CategoryKey) {
    setVisibleCategories(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  // allDays feeds the period narrative (a true report of what happened,
  // independent of which category chips are toggled); days is the
  // category-filtered view actually rendered as cards below it.
  const allDays: DayGroup[] = useMemo(() => {
    if (!data) return []
    const warehouseName = (id: string | null) => data.warehouses.find(w => w.id === id)?.name ?? 'Unassigned'
    const productName = (id: string | null) => data.products.find(p => p.id === id)?.name ?? 'Unknown item'
    const supplierName = (id: string | null) => data.suppliers.find(s => s.id === id)?.name ?? 'Unknown supplier'

    const dates = new Set<string>([
      ...data.productionLogs.map(r => r.log_date),
      ...data.transfers.map(r => r.event_date),
      ...data.sales.map(r => r.sale_date),
      ...data.shipmentsReceived.map(r => r.received_at.split('T')[0]),
      ...data.damage.map(r => r.report_date),
      ...data.adjustments.map(r => r.movement_date.split('T')[0]),
      ...data.money.map(r => r.date),
    ])

    const byMagnitudeDesc = (a: Row, b: Row) => b.magnitude - a.magnitude

    return [...dates]
      .sort((a, b) => dayOrder === 'newest' ? b.localeCompare(a) : a.localeCompare(b))
      .map(date => {
        // Same product + warehouse can be logged multiple times in one day
        // (separate batches/shifts) — sum them into one row per pair rather
        // than one row per log entry, same as sales aggregates per
        // warehouse below. Besides being more scannable, un-aggregated rows
        // here previously collided on React key (product_id + warehouse_id)
        // since nothing else about a log entry is unique.
        const productionByPair = new Map<string, { productId: string | null; warehouseId: string | null; quantity: number }>()
        for (const r of data.productionLogs.filter(r => r.log_date === date)) {
          const key = `${r.product_id ?? ''} ${r.warehouse_id ?? ''}`
          const existing = productionByPair.get(key)
          if (existing) existing.quantity += r.quantity_produced
          else productionByPair.set(key, { productId: r.product_id, warehouseId: r.warehouse_id, quantity: r.quantity_produced })
        }
        const production: Row[] = [...productionByPair.entries()]
          .map(([key, v]) => ({
            key,
            magnitude: v.quantity,
            content: (
              <>
                <span className="flex-1 text-gray-700">{productName(v.productId)}</span>
                <span className="text-gray-400 w-32">{warehouseName(v.warehouseId)}</span>
                <span className="text-gray-900 font-medium font-mono">{N(v.quantity)} units</span>
              </>
            ),
          }))
          .sort(byMagnitudeDesc)

        const shipmentsReceived: Row[] = data.shipmentsReceived
          .filter(r => r.received_at.split('T')[0] === date)
          .map(r => ({
            key: r.id,
            magnitude: 1,
            content: (
              <>
                <Link to={`/shipments/${r.id}`} className="flex-1 text-blue-600 hover:underline">{r.shipment_number}</Link>
                <span className="text-gray-400">{supplierName(r.supplier_id)}</span>
                <span className="text-gray-400 w-32 text-right">{warehouseName(r.warehouse_id)}</span>
              </>
            ),
          }))

        const transfers: Row[] = data.transfers
          .filter(r => r.event_date === date)
          .map(r => ({
            key: r.id,
            magnitude: r.quantity,
            content: (
              <>
                <span className="flex-1 text-gray-700 min-w-[120px]">{productName(r.product_id)} · {N(r.quantity)}</span>
                <span className="text-gray-400">
                  {warehouseName(r.from_warehouse_id)} → {r.to_warehouse_id ? warehouseName(r.to_warehouse_id) : PURPOSE_LABEL[r.purpose] ?? r.purpose}
                </span>
                {(r.driver_name || r.truck_plate) && (
                  <span className="text-gray-400">{[r.driver_name, r.truck_plate].filter(Boolean).join(' · ')}</span>
                )}
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                  r.status === 'RECEIVED' ? 'bg-green-100 text-green-700'
                    : r.status === 'CANCELLED' ? 'bg-gray-100 text-gray-500'
                    : 'bg-amber-50 text-amber-700'
                }`}>
                  {r.status === 'IN_TRANSIT' ? 'In transit' : r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                </span>
              </>
            ),
          }))
          .sort(byMagnitudeDesc)

        const salesByWarehouse = new Map<string, { orderCount: number; totalEtb: number }>()
        for (const s of data.sales.filter(r => r.sale_date === date)) {
          const key = warehouseName(s.warehouse_id)
          const entry = salesByWarehouse.get(key) ?? { orderCount: 0, totalEtb: 0 }
          entry.orderCount += 1
          entry.totalEtb += Number(s.total_etb ?? 0)
          salesByWarehouse.set(key, entry)
        }
        const totalOrders = [...salesByWarehouse.values()].reduce((s, v) => s + v.orderCount, 0)
        const sales: Row[] = [...salesByWarehouse.entries()]
          .map(([wh, v]) => ({
            key: wh, magnitude: v.totalEtb,
            content: (
              <>
                <span className="flex-1 text-gray-700">{wh}</span>
                <span className="text-gray-400">{v.orderCount} order{v.orderCount === 1 ? '' : 's'}</span>
                <span className="text-gray-900 font-medium font-mono">{N(v.totalEtb)} ETB</span>
              </>
            ),
          }))
          .sort(byMagnitudeDesc)

        const damage: Row[] = data.damage
          .filter(r => r.report_date === date)
          .map(r => ({
            key: r.id,
            magnitude: r.quantity,
            content: (
              <>
                <span className="flex-1 text-gray-700">{productName(r.product_id)}</span>
                <span className="text-gray-400 flex-1">{r.reason ?? '—'}</span>
                <span className="text-gray-400 w-28">{warehouseName(r.warehouse_id)}</span>
                <span className="text-red-600 font-medium font-mono">−{N(r.quantity)}</span>
              </>
            ),
          }))
          .sort(byMagnitudeDesc)

        const adjustments: Row[] = data.adjustments
          .filter(r => r.movement_date.split('T')[0] === date)
          .map(r => ({
            key: r.id,
            magnitude: Math.abs(r.quantity),
            content: (
              <>
                <span className="flex-1 text-gray-700">{productName(r.product_id)}</span>
                <span className="text-gray-400 flex-1 truncate">{r.notes ?? '—'}</span>
                <span className="text-gray-400 w-28">{warehouseName(r.warehouse_id)}</span>
                <span className={`font-medium font-mono ${r.quantity >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {r.quantity >= 0 ? '+' : ''}{N(r.quantity)}
                </span>
              </>
            ),
          }))
          .sort((a, b) => b.magnitude - a.magnitude)

        const dayMoney = data.money.filter(m => m.date === date)
        const cashInEtb = dayMoney.filter(m => m.direction === 'in').reduce((s, m) => s + m.etbAmount, 0)
        const cashOutEtb = dayMoney.filter(m => m.direction === 'out').reduce((s, m) => s + m.etbAmount, 0)
        // Non-hawala foreign-currency supplier payments never touch an ETB
        // account (etbAmount is 0 for those) — surfaced separately per
        // currency rather than folded into the ETB net, same convention as
        // the Dashboard/Reports payables split.
        const foreignOutMap = new Map<string, number>()
        for (const m of dayMoney) {
          if (m.direction === 'out' && m.currency !== 'ETB' && m.etbAmount === 0) {
            foreignOutMap.set(m.currency, (foreignOutMap.get(m.currency) ?? 0) + m.amount)
          }
        }
        const foreignOut = [...foreignOutMap.entries()].map(([currency, amount]) => ({ currency, amount }))

        const money: Row[] = dayMoney
          .map((m, i) => ({
            key: `money-${i}`,
            magnitude: m.etbAmount || m.amount,
            content: (
              <>
                {m.direction === 'in'
                  ? <TrendingUp size={11} className="text-green-600 shrink-0" />
                  : <TrendingDown size={11} className="text-red-500 shrink-0" />}
                <span className="flex-1 text-gray-700">{MONEY_CATEGORY_LABEL[m.category]} · {m.party}</span>
                {m.detail && <span className="text-gray-400">{m.detail}</span>}
                <span className={`font-medium font-mono ${m.direction === 'in' ? 'text-green-700' : 'text-red-600'}`}>
                  {m.direction === 'in' ? '+' : '−'}{N(m.amount)} {m.currency}
                </span>
              </>
            ),
          }))
          .sort(byMagnitudeDesc)

        const sectionsAll: DaySection[] = [
          { def: CATEGORIES[0], rows: shipmentsReceived, magnitude: shipmentsReceived.length },
          { def: CATEGORIES[1], rows: production, magnitude: production.reduce((s, r) => s + r.magnitude, 0) },
          { def: CATEGORIES[2], rows: transfers, magnitude: transfers.length },
          { def: CATEGORIES[3], rows: sales, magnitude: sales.reduce((s, r) => s + r.magnitude, 0) },
          { def: CATEGORIES[4], rows: damage, magnitude: damage.reduce((s, r) => s + r.magnitude, 0) },
          { def: CATEGORIES[5], rows: adjustments, magnitude: adjustments.length },
          { def: CATEGORIES[6], rows: money, magnitude: cashInEtb + cashOutEtb },
        ].filter(s => visibleCategories.includes(s.def.key) && s.rows.length > 0)

        const sections = sectionOrder === 'busiest'
          ? [...sectionsAll].sort((a, b) => b.magnitude - a.magnitude)
          : sectionsAll

        return {
          date, sections,
          cashInEtb, cashOutEtb, foreignOut,
          totalUnits: production.reduce((s, r) => s + r.magnitude, 0),
          totalOrders,
          totalSalesEtb: sales.reduce((s, r) => s + r.magnitude, 0),
          totalTransfers: transfers.length,
          shipmentsCount: shipmentsReceived.length,
          damageCount: damage.length,
          damageUnits: damage.reduce((s, r) => s + r.magnitude, 0),
          adjustmentsCount: adjustments.length,
        }
      })
  }, [data, visibleCategories, dayOrder, sectionOrder])

  const days = useMemo(() => allDays.filter(day => day.sections.length > 0), [allDays])
  const periodNarrative = useMemo(() => describePeriod(allDays), [allDays])

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="mb-4 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-medium flex items-center gap-2">
            <CalendarDays size={18} /> Daily activity
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">What happened each day — inbound, production, transfers, sales, loss, and cash</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSectionOrder(o => o === 'default' ? 'busiest' : 'default')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            title="Change how sections are ordered within each day"
          >
            <ArrowUpDown size={12} /> {sectionOrder === 'default' ? 'Default order' : 'Busiest first'}
          </button>
          <button
            onClick={() => setDayOrder(o => o === 'newest' ? 'oldest' : 'newest')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            <ChevronDown size={12} className={dayOrder === 'oldest' ? 'rotate-180' : ''} /> {dayOrder === 'newest' ? 'Newest first' : 'Oldest first'}
          </button>
        </div>
      </div>

      {periodNarrative && (
        <div className="bg-indigo-600 text-white rounded-2xl p-4 mb-5 flex items-start gap-2.5">
          <Sparkles size={15} className="shrink-0 mt-0.5 text-indigo-200" />
          <p className="text-sm leading-snug">{periodNarrative}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mb-5">
        {CATEGORIES.map(c => {
          const active = visibleCategories.includes(c.key)
          return (
            <button
              key={c.key}
              onClick={() => toggleCategory(c.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                active ? `${c.badge} border-transparent` : 'bg-transparent text-gray-400 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <c.icon size={11} /> {c.label}
            </button>
          )
        })}
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
          {visibleCategories.length === 0
            ? 'No categories selected — turn at least one back on above.'
            : 'No activity in the last 14 days yet. This fills in as production is logged, shipments arrive, transfers move stock, and sales happen.'}
        </div>
      ) : (
        <div className="space-y-4">
          {days.map(day => {
            const netCashEtb = day.cashInEtb - day.cashOutEtb
            return (
              <div key={day.date} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-sm font-medium">{day.date}</p>
                    <div className="flex gap-4 text-xs text-gray-500 flex-wrap">
                      {day.totalUnits > 0 && <span className="flex items-center gap-1"><Package size={12} /> {N(day.totalUnits)} units produced</span>}
                      {day.totalTransfers > 0 && <span className="flex items-center gap-1"><Truck size={12} /> {day.totalTransfers} transfers</span>}
                      {day.totalOrders > 0 && <span className="flex items-center gap-1"><ShoppingCart size={12} /> {day.totalOrders} orders · {N(day.totalSalesEtb)} ETB</span>}
                      {(day.cashInEtb > 0 || day.cashOutEtb > 0) && (
                        <span className={`flex items-center gap-1 font-medium ${netCashEtb >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                          <Receipt size={12} /> {netCashEtb >= 0 ? '+' : ''}{N(netCashEtb)} ETB net
                          {day.foreignOut.map(f => ` · −${f.currency === 'USD' ? '$' : f.currency === 'CNY' ? '¥' : ''}${N(f.amount)}${f.currency !== 'USD' && f.currency !== 'CNY' ? ` ${f.currency}` : ''}`).join('')}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 italic mt-1">{describeDay(day)}</p>
                </div>

                <div className="divide-y divide-gray-50">
                  {day.sections.map(section => (
                    <div key={section.def.key} className="px-4 py-2.5">
                      <p className={`text-xs font-medium uppercase tracking-wide mb-1.5 flex items-center gap-1 ${section.def.accent}`}>
                        <section.def.icon size={11} /> {section.def.label}
                        <span className="text-gray-300 font-normal normal-case">· {section.rows.length}</span>
                      </p>
                      {section.rows.map(row => (
                        <div key={row.key} className="flex items-center gap-3 text-xs py-0.5 flex-wrap">
                          {row.content}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
