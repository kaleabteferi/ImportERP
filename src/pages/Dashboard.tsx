import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Boxes, ChevronRight,
  CircleAlert, Clock3, CreditCard, Landmark, Loader2, PackageCheck,
  RefreshCw, Sparkles, TrendingDown, TrendingUp, Users, Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlobalSearchBar } from '../components/GlobalSearchBar'
import { ManufacturingPerformanceCard } from '../components/dashboard/ManufacturingPerformanceCard'
import { useDashboardData, type DayPoint, type Period } from '../hooks/useDashboardData'
import { useAuth } from '../lib/auth'

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))
const PERIOD_LABEL: Record<Period, string> = { day: 'Today', week: 'This week', month: 'This month' }
const PREVIOUS_LABEL: Record<Period, string> = { day: 'yesterday', week: 'last week', month: 'last month' }
const pctChange = (current: number, previous: number) =>
  previous === 0 ? (current > 0 ? 100 : 0) : ((current - previous) / previous) * 100

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function timeAgo(date: Date | null) {
  if (!date) return 'waiting for sync'
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'synced just now'
  if (seconds < 3600) return `synced ${Math.floor(seconds / 60)}m ago`
  return `synced ${Math.floor(seconds / 3600)}h ago`
}

function TrendPill({ value, period }: { value: number; period: Period }) {
  const positive = value >= 0
  return (
    <span className={`dashboard-trend ${positive ? 'is-positive' : 'is-negative'}`}>
      {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(value).toFixed(0)}% vs {PREVIOUS_LABEL[period]}
    </span>
  )
}

function Sparkline({ points, tone = 'lime' }: { points: DayPoint[]; tone?: 'lime' | 'blue' }) {
  if (points.length < 2) return <div className="dashboard-chart-empty">Trend builds as data arrives</div>
  const values = points.map(point => point.value)
  const max = Math.max(...values, 1)
  const min = Math.min(...values)
  const range = Math.max(max - min, 1)
  const coordinates = points.map((point, index) => {
    const x = (index / Math.max(points.length - 1, 1)) * 100
    const y = 46 - ((point.value - min) / range) * 38
    return `${x},${y}`
  }).join(' ')
  const area = `0,52 ${coordinates} 100,52`
  return (
    <svg className={`dashboard-sparkline is-${tone}`} viewBox="0 0 100 54" preserveAspectRatio="none" aria-label="Value trend">
      <defs>
        <linearGradient id={`trend-${tone}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity=".26" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#trend-${tone})`} />
      <polyline points={coordinates} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function MetricCard({ label, value, detail, icon: Icon, to, tone = 'neutral' }: {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  to: string
  tone?: 'neutral' | 'lime' | 'amber'
}) {
  return (
    <Link to={to} className={`dashboard-metric is-${tone}`}>
      <div className="dashboard-metric__top">
        <span className="dashboard-metric__icon"><Icon size={15} /></span>
        <ChevronRight size={15} className="dashboard-metric__arrow" />
      </div>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </Link>
  )
}

function CashBreakdown({ title, value, items, direction }: {
  title: string
  value: number
  items: { label: string; amountEtb: number; to: string }[]
  direction: 'in' | 'out'
}) {
  return (
    <div className="cash-breakdown">
      <div className="cash-breakdown__header">
        <div>
          <span>{title}</span>
          <strong>{N(value)} <small>ETB</small></strong>
        </div>
        <span className={`cash-direction is-${direction}`}>
          {direction === 'in' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
        </span>
      </div>
      <div className="cash-breakdown__rows">
        {items.length === 0 ? <p className="dashboard-empty">No movement in this period</p> : items.map(item => (
          <Link to={item.to} key={item.label}>
            <span>{item.label}</span>
            <strong>{N(item.amountEtb)}</strong>
          </Link>
        ))}
      </div>
    </div>
  )
}

function TrendPanel({ title, value, unit, points, change, period, to, tone }: {
  title: string
  value: string
  unit: string
  points: DayPoint[]
  change: number
  period: Period
  to: string
  tone: 'lime' | 'blue'
}) {
  const values = points.map(point => point.value)
  const best = values.length ? Math.max(...values) : 0
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  return (
    <Link to={to} className="dashboard-trend-panel">
      <div className="dashboard-section-label">
        <span>{title}</span>
        <TrendPill value={change} period={period} />
      </div>
      <div className="dashboard-trend-panel__value"><strong>{value}</strong><span>{unit}</span></div>
      <div className="dashboard-trend-panel__chart"><Sparkline points={points} tone={tone} /></div>
      <div className="dashboard-trend-panel__foot">
        <span>Best <strong>{N(best)}</strong></span>
        <span>Daily average <strong>{N(average)}</strong></span>
        <ArrowRight size={14} />
      </div>
    </Link>
  )
}

function BusinessQuestion({ title, eyebrow, to, children, className = '' }: {
  title: string
  eyebrow: string
  to: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <article className={`dashboard-question ${className}`}>
      <div className="dashboard-question__header">
        <div><span className="dashboard-kicker">{eyebrow}</span><h3>{title}</h3></div>
        <Link to={to} aria-label={`Open ${title}`}><ArrowRight size={14} /></Link>
      </div>
      <div className="dashboard-question__body">{children}</div>
    </article>
  )
}

export function Dashboard() {
  const { profile } = useAuth()
  const [period, setPeriod] = useState<Period>('day')
  const [opsTab, setOpsTab] = useState<'sales' | 'margin' | 'production'>('sales')
  const data = useDashboardData(period)
  const firstName = (profile?.full_name ?? '').split(' ')[0] || 'there'
  const revenueChange = pctChange(data.revenueEtb, data.revenuePrevEtb)
  const productionChange = pctChange(data.producedUnits, data.producedPrevUnits)
  const netCash = data.cashInEtb - data.cashOutEtb

  if (data.loading && !data.lastUpdated) {
    return (
      <div className="dashboard-loading">
        <Loader2 size={18} className="animate-spin" />
        Opening your operations desk…
      </div>
    )
  }

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <div className="dashboard-eyebrow"><span /> Operations overview</div>
          <h1>{greeting()}, {firstName}</h1>
          <p>{new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })} · {timeAgo(data.lastUpdated)}</p>
        </div>
        <div className="dashboard-header__tools">
          <GlobalSearchBar placeholder="Search the business…" />
          <button className="dashboard-refresh" onClick={data.refresh} aria-label="Refresh dashboard" title="Refresh dashboard">
            <RefreshCw size={16} className={data.loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <nav className="dashboard-periods" aria-label="Dashboard period">
        {(['day', 'week', 'month'] as Period[]).map(option => (
          <button key={option} onClick={() => setPeriod(option)} className={period === option ? 'is-active' : ''}>
            {PERIOD_LABEL[option]}
          </button>
        ))}
      </nav>

      {data.error && <div className="dashboard-error"><CircleAlert size={15} /> {data.error}</div>}

      <section className="dashboard-hero">
        <div className="dashboard-hero__main">
          <div className="dashboard-section-label">
            <span>Revenue</span>
            <TrendPill value={revenueChange} period={period} />
          </div>
          <div className="dashboard-hero__value"><strong>{N(data.revenueEtb)}</strong><span>ETB</span></div>
          <Sparkline points={data.revenueTrend} />
          <div className="dashboard-hero__foot">
            <span>Sales performance · {PERIOD_LABEL[period].toLowerCase()}</span>
            <Link to="/sales">Open sales <ArrowRight size={13} /></Link>
          </div>
        </div>

        <div className="dashboard-pulse">
          <div className="dashboard-section-label">
            <span>Operating pulse</span>
            <span className="dashboard-live"><i /> Live</span>
          </div>
          <div className="dashboard-pulse__score">
            <span>{data.todoToday.length === 0 ? 'Clear' : `${data.todoToday.length} to do`}</span>
            <div className="dashboard-pulse__orb">
              <span>{data.unusualTransactionCount + data.stockoutRiskCount}</span><small>risks</small>
            </div>
          </div>
          <div className="dashboard-advice">
            <Sparkles size={15} />
            <p>{data.topAdvice?.text ?? 'Your operating picture is up to date.'}</p>
          </div>
          <Link to={data.todoToday[0]?.link ?? '/reports'} className="dashboard-pulse__action">
            {data.todoToday.length ? 'Review first priority' : 'View business report'} <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      <section className="dashboard-metrics" aria-label="Key business metrics">
        <MetricCard label={`Revenue · ${PERIOD_LABEL[period].toLowerCase()}`} value={`${N(data.revenueEtb)} ETB`}
          detail={`${Math.abs(revenueChange).toFixed(0)}% vs ${PREVIOUS_LABEL[period]}`} icon={TrendingUp} to="/sales" tone={revenueChange >= 0 ? 'lime' : 'amber'} />
        <MetricCard label={`Produced · ${PERIOD_LABEL[period].toLowerCase()}`} value={`${N(data.producedUnits)} units`}
          detail={`${Math.abs(productionChange).toFixed(0)}% vs ${PREVIOUS_LABEL[period]}`} icon={PackageCheck} to="/production" tone={productionChange >= 0 ? 'neutral' : 'amber'} />
        <MetricCard label="Net cash" value={`${netCash >= 0 ? '+' : ''}${N(netCash)} ETB`}
          detail={`${N(data.cashInEtb)} in · ${N(data.cashOutEtb)} out`} icon={Wallet} to="/money-tracking" tone={netCash >= 0 ? 'lime' : 'amber'} />
        <MetricCard label="Stock cover" value={data.daysOfStock === null ? 'No run rate' : `${data.daysOfStock.toFixed(0)} days`}
          detail={`${N(data.inventoryValueEtb)} ETB on hand`} icon={Boxes} to="/inventory" tone={data.daysOfStock !== null && data.daysOfStock < 7 ? 'amber' : 'neutral'} />
        <MetricCard label="Customers owe you" value={`${N(data.receivablesEtb)} ETB`}
          detail="Open customer balances" icon={CreditCard} to="/receivables" tone={data.receivablesEtb > 0 ? 'amber' : 'neutral'} />
        <MetricCard label="You owe suppliers" value={`${N(data.payablesEtb)} ETB`}
          detail={[data.payablesUsd > 0 ? `$${N(data.payablesUsd)} USD` : null, data.payablesCny > 0 ? `¥${N(data.payablesCny)} CNY` : null].filter(Boolean).join(' · ') || 'No foreign balance'} icon={Landmark} to="/supplier-payments" tone={data.payablesEtb > 0 || data.payablesUsd > 0 || data.payablesCny > 0 ? 'amber' : 'neutral'} />
        <MetricCard label="Active customers" value={String(data.activeCustomers)}
          detail={PERIOD_LABEL[period].toLowerCase()} icon={Users} to="/customers" />
        <MetricCard label="Frequent customers" value={String(data.frequentCustomers)}
          detail="2+ orders in 30 days" icon={Users} to="/customers" />
      </section>

      <section className="dashboard-grid">
        <div className="dashboard-panel cash-panel">
          <div className="dashboard-panel__header">
            <div><span className="dashboard-kicker">Payments & cash</span><h2>Where money moved</h2></div>
            <span className="ledger-live"><i /> Live ledgers</span>
            <Link to="/money-tracking">All transactions <ArrowRight size={13} /></Link>
          </div>
          <div className="cash-grid">
            <CashBreakdown title="Cash in" value={data.cashInEtb} items={data.cashInBreakdown} direction="in" />
            <CashBreakdown title="Cash out" value={data.cashOutEtb} items={data.cashOutBreakdown} direction="out" />
          </div>
          <div className="cash-obligations">
            <Link to="/receivables"><CreditCard size={14} /><span>Customers owe</span><strong>{N(data.receivablesEtb)} ETB</strong></Link>
            <Link to="/supplier-payments"><Landmark size={14} /><span>Supplier payables</span><strong>{N(data.payablesEtb)} ETB</strong></Link>
          </div>
        </div>

        <div className="dashboard-panel action-panel">
          <div className="dashboard-panel__header">
            <div><span className="dashboard-kicker">Action queue</span><h2>What needs attention</h2></div>
            <span className="action-count">{data.todoToday.length}</span>
          </div>
          <div className="action-list">
            {data.todoToday.length === 0 ? (
              <div className="action-clear"><PackageCheck size={24} /><strong>Nothing urgent</strong><span>Your operation is on track.</span></div>
            ) : data.todoToday.slice(0, 4).map((item, index) => (
              <Link to={item.link ?? '/'} key={`${item.text}-${index}`}>
                <span className="action-index">{String(index + 1).padStart(2, '0')}</span>
                <p>{item.text}</p>
                <ChevronRight size={15} />
              </Link>
            ))}
          </div>
          <div className="action-signals">
            <span><CircleAlert size={13} /> {data.unusualTransactionCount} unusual transactions</span>
            <span><Clock3 size={13} /> {data.stockoutRiskCount} stock risks</span>
          </div>
        </div>
      </section>

      <section className="dashboard-panel intelligence-panel">
        <div className="dashboard-panel__header intelligence-header">
          <div><span className="dashboard-kicker">Business intelligence</span><h2>Read the operation</h2></div>
          <div className="intelligence-tabs" role="tablist">
            <button onClick={() => setOpsTab('sales')} className={opsTab === 'sales' ? 'is-active' : ''}>Best sellers</button>
            <button onClick={() => setOpsTab('margin')} className={opsTab === 'margin' ? 'is-active' : ''}>Margin watch</button>
            <button onClick={() => setOpsTab('production')} className={opsTab === 'production' ? 'is-active' : ''}>Production</button>
          </div>
        </div>

        {opsTab === 'sales' && (
          <div className="intelligence-list">
            {data.topProducts.length === 0 ? <p className="dashboard-empty">No sales recorded in this period yet.</p> :
              data.topProducts.map((product, index) => {
                const maxRevenue = Math.max(...data.topProducts.map(item => item.revenue), 1)
                return (
                  <Link to="/sales" key={product.name} className="intelligence-row">
                    <span className="intelligence-rank">{String(index + 1).padStart(2, '0')}</span>
                    <div><strong>{product.name}</strong><span>{N(product.quantity)} units sold</span></div>
                    <div className="intelligence-bar"><i style={{ width: `${(product.revenue / maxRevenue) * 100}%` }} /></div>
                    <strong>{N(product.revenue)} <small>ETB</small></strong>
                  </Link>
                )
              })}
          </div>
        )}
        {opsTab === 'margin' && (
          <div className="intelligence-list">
            {data.lowMarginProducts.length === 0 ? <p className="dashboard-empty">Not enough sales data to calculate margins.</p> :
              data.lowMarginProducts.map((product, index) => (
                <Link to="/products" key={product.name} className="intelligence-row">
                  <span className="intelligence-rank">{String(index + 1).padStart(2, '0')}</span>
                  <div><strong>{product.name}</strong><span>Review landed cost and sales price</span></div>
                  <div className="intelligence-bar"><i className={product.marginPct < 20 ? 'is-risk' : ''} style={{ width: `${Math.max(3, Math.min(product.marginPct, 100))}%` }} /></div>
                  <strong>{product.marginPct.toFixed(0)}<small>% margin</small></strong>
                </Link>
              ))}
          </div>
        )}
        {opsTab === 'production' && <div className="production-panel"><ManufacturingPerformanceCard /></div>}
      </section>

      <section className="dashboard-trends-section">
        <div className="dashboard-section-heading">
          <div><span className="dashboard-kicker">Period history</span><h2>Revenue and production trends</h2></div>
          <span>Real sales orders and production logs</span>
        </div>
        <div className="dashboard-trends-grid">
          <TrendPanel title="Revenue trend" value={N(data.revenueEtb)} unit="ETB" points={data.revenueTrend}
            change={revenueChange} period={period} to="/sales" tone="lime" />
          <TrendPanel title="Production trend" value={N(data.producedUnits)} unit="units" points={data.productionTrend}
            change={productionChange} period={period} to="/production" tone="blue" />
        </div>
      </section>

      <section className="dashboard-decisions">
        <div className="dashboard-section-heading">
          <div><span className="dashboard-kicker">Ask the business</span><h2>Answers from your operating data</h2></div>
          <span>No sample or placeholder figures</span>
        </div>
        <div className="dashboard-questions-grid">
          <BusinessQuestion title="What sold best?" eyebrow="Sales mix" to="/sales">
            {data.topProducts.length === 0 ? <p className="dashboard-empty">No sales recorded in this period yet.</p> : (
              <>
                <div className="question-list">
                  {data.topProducts.map((product, index) => (
                    <div key={product.name}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <p><strong>{product.name}</strong><small>{N(product.quantity)} sold</small></p>
                      <b>{N(product.revenue)} ETB</b>
                    </div>
                  ))}
                </div>
                {data.topProducts[0] && data.revenueEtb > 0 && (
                  <div className="question-advice"><Sparkles size={13} />
                    <p>{data.topProducts[0].name} contributes {Math.round((data.topProducts[0].revenue / data.revenueEtb) * 100)}% of revenue this {period}. Prioritize its supply chain and production schedule.</p>
                  </div>
                )}
              </>
            )}
          </BusinessQuestion>

          <BusinessQuestion title="Where are we losing money?" eyebrow="Margin watch" to="/products">
            {data.lowMarginProducts.length === 0 ? <p className="dashboard-empty">Not enough sales data yet to check margins.</p> : (
              <>
                <div className="margin-list">
                  {data.lowMarginProducts.map(product => (
                    <div key={product.name}>
                      <span><strong>{product.name}</strong><small>Cost vs sales price</small></span>
                      <b className={product.marginPct < 20 ? 'is-risk' : ''}>{product.marginPct.toFixed(0)}%</b>
                    </div>
                  ))}
                </div>
                {data.lowMarginProducts[0].marginPct < 20 && (
                  <div className="question-advice"><Sparkles size={13} />
                    <p>Review {data.lowMarginProducts[0].name}. Check its BOM cost and consider a price adjustment.</p>
                  </div>
                )}
              </>
            )}
          </BusinessQuestion>

          <BusinessQuestion title="How efficient is production?" eyebrow="Output & overtime" to="/production" className="is-wide">
            <ManufacturingPerformanceCard />
          </BusinessQuestion>

          <BusinessQuestion title="What should I do today?" eyebrow="Priority list" to={data.todoToday[0]?.link ?? '/reports'} className="is-wide">
            {data.todoToday.length === 0 ? (
              <div className="action-clear is-compact"><PackageCheck size={24} /><strong>Nothing urgent</strong><span>Production and sales are on track.</span></div>
            ) : (
              <div className="question-todos">
                {data.todoToday.map((item, index) => (
                  <Link to={item.link ?? '/'} key={`${item.text}-${index}`}>
                    <span>{String(index + 1).padStart(2, '0')}</span><p>{item.text}</p><ChevronRight size={14} />
                  </Link>
                ))}
              </div>
            )}
            {data.secondaryAdvice && <div className="question-advice"><Sparkles size={13} /><p>{data.secondaryAdvice.text}</p></div>}
          </BusinessQuestion>
        </div>
      </section>
    </div>
  )
}
