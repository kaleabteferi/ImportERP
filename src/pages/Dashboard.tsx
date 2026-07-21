import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDashboardData, type DayPoint, type Period } from '../hooks/useDashboardData'
import { useAuth } from '../lib/auth'
import { QuickActions } from '../components/dashboard/QuickActions'
import { GlobalSearchBar } from '../components/GlobalSearchBar'
import {
  Sparkles, TrendingUp, TrendingDown, ChevronDown, ChevronRight,
  Loader2, ArrowRight, CheckCircle2, Wallet, Landmark, CreditCard,
  Package, Users, RefreshCw,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))
const pctChange = (current: number, prev: number) =>
  prev === 0 ? (current > 0 ? 100 : 0) : ((current - prev) / prev) * 100

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function timeAgo(d: Date | null) {
  if (!d) return ''
  const secs = Math.floor((Date.now() - d.getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

const PERIOD_LABEL: Record<Period, string> = { day: 'Today', week: 'This week', month: 'This month' }
const PERIOD_PREV_LABEL: Record<Period, string> = { day: 'yesterday', week: 'last week', month: 'last month' }

function KpiCard({ label, value, sub, trend, icon: Icon, tone, to }: {
  label: string; value: string; sub?: string; trend?: number; icon: LucideIcon; tone?: 'warn' | 'good'; to?: string
}) {
  const body = (
    <>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 text-gray-400">
          <Icon size={12} />
          <p className="text-xs">{label}</p>
        </div>
        {to && <ChevronRight size={13} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1 group-hover:translate-x-0 duration-150" />}
      </div>
      <p className={`text-xl font-medium ${tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-green-700' : ''}`}>{value}</p>
      {trend !== undefined ? (
        <p className={`text-xs mt-1 flex items-center gap-1 ${trend >= 0 ? 'text-green-600' : 'text-red-500'}`}>
          {trend >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {Math.abs(trend).toFixed(0)}%{sub ? ` ${sub}` : ''}
        </p>
      ) : sub ? (
        <p className="text-xs mt-1 text-gray-400">{sub}</p>
      ) : null}
    </>
  )
  const cls = 'group bg-white border border-gray-200 rounded-xl p-4 block transition-all duration-150'
  return to ? (
    <Link to={to} className={`${cls} hover:border-blue-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400`}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function MiniTrend({ points, formatValue }: { points: DayPoint[]; formatValue: (n: number) => string }) {
  const max = Math.max(1, ...points.map(p => p.value))
  const best = Math.max(...points.map(p => p.value))
  const avg = points.reduce((s, p) => s + p.value, 0) / Math.max(points.length, 1)
  const showLabels = points.length <= 14
  return (
    <div>
      <div className="flex items-end gap-1 h-20 mb-2">
        {points.map(p => (
          <div key={p.date} className="flex-1 flex flex-col items-center justify-end gap-1">
            <div
              className="w-full rounded-t bg-indigo-500/80"
              style={{ height: `${Math.max(4, (p.value / max) * 100)}%` }}
              title={`${p.date}: ${formatValue(p.value)}`}
            />
            {showLabels && <span className="text-[9px] text-gray-400">{new Date(p.date).toLocaleDateString('en', { weekday: 'narrow' })}</span>}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-gray-400 border-t border-gray-100 pt-2">
        <span>Best day <span className="text-gray-600 font-medium">{formatValue(best)}</span></span>
        <span>Average <span className="text-gray-600 font-medium">{formatValue(avg)}</span></span>
      </div>
    </div>
  )
}

function QuestionCard({ question, children, viewAllTo, viewAllLabel, defaultOpen }: {
  question: string; children: React.ReactNode; viewAllTo?: string; viewAllLabel?: string; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors duration-150"
      >
        <span className="text-sm font-medium">{question}</span>
        {open ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3">
          {children}
          {viewAllTo && (
            <Link to={viewAllTo} className="mt-3 flex items-center gap-1 text-xs text-blue-600 hover:underline w-fit">
              {viewAllLabel ?? 'View all'} <ArrowRight size={11} />
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

function AdviceNote({ text }: { text: string }) {
  return (
    <div className="mt-3 flex gap-2 text-xs text-indigo-700 bg-indigo-50 rounded-lg px-3 py-2">
      <Sparkles size={13} className="shrink-0 mt-0.5" />
      <p className="italic">{text}</p>
    </div>
  )
}

export function Dashboard() {
  const { profile } = useAuth()
  const [period, setPeriod] = useState<Period>('day')
  const d = useDashboardData(period)
  const firstName = (profile?.full_name ?? '').split(' ')[0] || 'there'

  const revenueChangePct = pctChange(d.revenueEtb, d.revenuePrevEtb)
  const productionChangePct = pctChange(d.producedUnits, d.producedPrevUnits)
  const netCashEtb = d.cashInEtb - d.cashOutEtb

  if (d.loading && !d.lastUpdated) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-gray-400 gap-2">
        <Loader2 size={18} className="animate-spin" /> Getting the numbers…
      </div>
    )
  }

  return (
    <div className="p-5 max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-5 items-start">
    <div className="space-y-5 min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-medium">{greeting()}, {firstName}</h1>
          <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5">
            {new Date().toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })}
            <span className="text-gray-300">·</span>
            <RefreshCw size={10} className={d.loading ? 'animate-spin' : ''} />
            Updated {timeAgo(d.lastUpdated)}
          </p>
        </div>
        <div className="flex gap-1">
          {(['day', 'week', 'month'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors
                ${period === p ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      <GlobalSearchBar />

      {d.error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{d.error}</div>
      )}

      {/* Top advice */}
      {d.topAdvice && (
        <div className="bg-indigo-600 text-white rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2 text-indigo-200 text-xs uppercase tracking-wide font-medium">
            <Sparkles size={13} /> {PERIOD_LABEL[period]}'s advice
          </div>
          <p className="text-lg leading-snug">{d.topAdvice.text}</p>
          {d.secondaryAdvice && (
            <p className="text-sm text-indigo-200 mt-3 flex items-start gap-1.5">
              <ArrowRight size={14} className="shrink-0 mt-0.5" /> {d.secondaryAdvice.text}
            </p>
          )}
        </div>
      )}

      {/* Tier 1 — headline KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label={`Revenue · ${PERIOD_LABEL[period].toLowerCase()}`} icon={TrendingUp} to="/sales"
          value={`${N(d.revenueEtb)} ETB`} trend={revenueChangePct} sub={`vs ${PERIOD_PREV_LABEL[period]}`} />
        <KpiCard label={`Produced · ${PERIOD_LABEL[period].toLowerCase()}`} icon={Package} to="/production"
          value={`${N(d.producedUnits)} units`} trend={productionChangePct} sub={`vs ${PERIOD_PREV_LABEL[period]}`} />
        <KpiCard label="Net cash" icon={Wallet} to="/money-tracking"
          value={`${netCashEtb >= 0 ? '+' : ''}${N(netCashEtb)} ETB`}
          sub={`${N(d.cashInEtb)} in · ${N(d.cashOutEtb)} out`}
          tone={netCashEtb >= 0 ? 'good' : 'warn'} />
        <KpiCard label="Days of stock" icon={Package} to="/inventory"
          value={d.daysOfStock !== null ? `${d.daysOfStock.toFixed(0)} days` : '—'}
          sub={`${N(d.inventoryValueEtb)} ETB on hand`}
          tone={d.daysOfStock !== null && d.daysOfStock < 7 ? 'warn' : undefined} />
        <KpiCard label="Customers owe you" icon={CreditCard} to="/receivables"
          value={`${N(d.receivablesEtb)} ETB`}
          tone={d.receivablesEtb > 0 ? 'warn' : undefined} />
        <KpiCard label="You owe suppliers" icon={Landmark} to="/supplier-payments"
          value={`${N(d.payablesEtb)} ETB`}
          sub={[d.payablesUsd > 0 ? `$${N(d.payablesUsd)} USD` : null, d.payablesCny > 0 ? `¥${N(d.payablesCny)} CNY` : null].filter(Boolean).join(' · ') || undefined}
          tone={d.payablesEtb > 0 || d.payablesUsd > 0 || d.payablesCny > 0 ? 'warn' : undefined} />
        <KpiCard label="Active customers" icon={Users} to="/customers"
          value={String(d.activeCustomers)}
          sub={`${PERIOD_LABEL[period].toLowerCase()}`} />
        <KpiCard label="Frequent customers" icon={Users} to="/customers"
          value={String(d.frequentCustomers)}
          sub="2+ orders in 30 days" />
      </div>

      {/* Tier 2 — trends */}
      <div className="grid grid-cols-2 gap-3">
        <Link to="/sales" className="group bg-white border border-gray-200 rounded-xl p-4 block transition-all duration-150 hover:border-blue-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-gray-500">Revenue trend</p>
            <ChevronRight size={13} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1 group-hover:translate-x-0 duration-150" />
          </div>
          <MiniTrend points={d.revenueTrend} formatValue={n => `${N(n)} ETB`} />
        </Link>
        <Link to="/production" className="group bg-white border border-gray-200 rounded-xl p-4 block transition-all duration-150 hover:border-blue-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-gray-500">Production trend</p>
            <ChevronRight size={13} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1 group-hover:translate-x-0 duration-150" />
          </div>
          <MiniTrend points={d.productionTrend} formatValue={n => `${N(n)} units`} />
        </Link>
      </div>

      {/* Tier 3 — drill-down */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">Ask the business</p>
        <div className="space-y-2">
          <QuestionCard question="What sold best?" viewAllTo="/sales" viewAllLabel="Go to Sales" defaultOpen>
            {d.topProducts.length === 0 ? (
              <p className="text-sm text-gray-400">No sales recorded in this period yet.</p>
            ) : (
              <div className="space-y-2">
                {d.topProducts.map((p, i) => (
                  <div key={p.name} className="flex items-center gap-3 text-sm">
                    <span className="text-gray-300 font-medium w-4">{i + 1}.</span>
                    <span className="flex-1">{p.name}</span>
                    <span className="text-gray-500">{N(p.quantity)} sold</span>
                    <span className="font-medium w-28 text-right">{N(p.revenue)} ETB</span>
                  </div>
                ))}
                {d.topProducts[0] && d.revenueEtb > 0 && (
                  <AdviceNote text={`${d.topProducts[0].name} contributes ${Math.round((d.topProducts[0].revenue / d.revenueEtb) * 100)}% of revenue this ${period} — prioritize its supply chain and production schedule.`} />
                )}
              </div>
            )}
          </QuestionCard>

          <QuestionCard question="Where are we losing money?" viewAllTo="/products" viewAllLabel="Go to Products">
            {d.lowMarginProducts.length === 0 ? (
              <p className="text-sm text-gray-400">Not enough sales data yet to check margins.</p>
            ) : (
              <div className="space-y-2">
                {d.lowMarginProducts.map(p => (
                  <div key={p.name} className="flex justify-between text-sm">
                    <span>{p.name}</span>
                    <span className={`font-medium ${p.marginPct < 20 ? 'text-red-500' : 'text-gray-600'}`}>
                      {p.marginPct.toFixed(0)}% margin
                    </span>
                  </div>
                ))}
                {d.lowMarginProducts[0].marginPct < 20 && (
                  <AdviceNote text={`Review "${d.lowMarginProducts[0].name}" — its cost or price needs attention. Check its BOM cost and consider a price adjustment.`} />
                )}
              </div>
            )}
          </QuestionCard>

          <QuestionCard question="What should I do today?" defaultOpen={d.todoToday.length > 0}>
            {d.todoToday.length === 0 ? (
              <p className="text-sm text-gray-400 flex items-center gap-2">
                <CheckCircle2 size={14} className="text-green-500" /> Nothing urgent — everything's on track.
              </p>
            ) : (
              <ul className="space-y-1">
                {d.todoToday.map((t, i) => (
                  <li key={i}>
                    {t.link ? (
                      <Link to={t.link} className="flex items-start gap-2 text-sm -mx-2 px-2 py-1 rounded-lg hover:bg-gray-50 transition-colors duration-150 group">
                        <span className="text-gray-300 mt-0.5">•</span>
                        <span className="flex-1">{t.text}</span>
                        <ChevronRight size={13} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                      </Link>
                    ) : (
                      <div className="flex items-start gap-2 text-sm px-2 py-1">
                        <span className="text-gray-300 mt-0.5">•</span>
                        <span>{t.text}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </QuestionCard>
        </div>
      </div>

      <p className="text-center text-xs text-gray-300 pt-2">
        Need the full picture? <Link to="/reports" className="text-indigo-500 hover:underline">See detailed reports</Link>
      </p>
    </div>

    <div className="lg:sticky lg:top-5">
      <QuickActions onChanged={d.refresh} />
    </div>
    </div>
  )
}
