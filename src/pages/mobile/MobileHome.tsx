import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useDashboardData, type Period } from '../../hooks/useDashboardData'
import { ArrowDownRight, ArrowUpRight, Banknote, Boxes, ChevronRight, CircleAlert, CreditCard, Loader2, Package, RefreshCw, ShoppingCart, Users, Wallet, Wrench } from 'lucide-react'

const N = (value: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0, notation: Math.abs(value) >= 1_000_000 ? 'compact' : 'standard' }).format(Math.round(value))

export function MobileHome() {
  const [period, setPeriod] = useState<Period>('day')
  const data = useDashboardData(period)
  const netCash = data.cashInEtb - data.cashOutEtb
  const revenueChange = data.revenuePrevEtb ? (data.revenueEtb - data.revenuePrevEtb) / data.revenuePrevEtb * 100 : null
  const today = new Date().toLocaleDateString('en-ET', { weekday: 'long', month: 'short', day: 'numeric' })

  return <div className="mobile-surface mobile-dashboard">
    <header className="mobile-page-intro">
      <div><span>{today}</span><h1>Operating pulse</h1><p>Sales, cash and warehouse activity in one view.</p></div>
      <button className="mobile-icon-button" onClick={data.refresh} aria-label="Refresh dashboard"><RefreshCw size={18} className={data.loading ? 'animate-spin' : ''} /></button>
    </header>
    <div className="mobile-periods" aria-label="Dashboard period">{(['day', 'week', 'month'] as Period[]).map(value => <button key={value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value)}>{value === 'day' ? 'Today' : `This ${value}`}</button>)}</div>

    {data.loading ? <div className="mobile-state"><Loader2 className="animate-spin" /><span>Loading live company data…</span></div> : <>
      {data.error && <div className="mobile-alert is-error"><CircleAlert size={17} /><span>{data.error}</span></div>}
      <section className="mobile-pulse-card">
        <div className="mobile-pulse-head"><span>Net cash movement</span><small>{period === 'day' ? 'today' : `this ${period}`}</small></div>
        <strong>{netCash >= 0 ? '+' : '−'}{N(Math.abs(netCash))}<small> ETB</small></strong>
        <div className="mobile-cash-flow"><div><ArrowDownRight /><span>Cash in<b>{N(data.cashInEtb)} ETB</b></span></div><div><ArrowUpRight /><span>Cash out<b>{N(data.cashOutEtb)} ETB</b></span></div></div>
        <Sparkline points={data.revenueTrend.map(point => point.value)} />
      </section>

      <section className="mobile-quick-actions" aria-label="Quick actions">
        <QuickAction to="/sales" icon={<ShoppingCart />} label="Record sale" />
        <QuickAction to="/production" icon={<Wrench />} label="Log output" />
        <QuickAction to="/money-tracking?action=income" icon={<Banknote />} label="Add income" />
        <QuickAction to="/money-tracking?action=expense" icon={<Wallet />} label="Add expense" />
      </section>

      <section className="mobile-metric-grid">
        <Metric to="/sales" label="Revenue" value={`${N(data.revenueEtb)} ETB`} meta={revenueChange == null ? 'No prior comparison' : `${revenueChange >= 0 ? '+' : ''}${revenueChange.toFixed(1)}% vs previous`} tone="blue" />
        <Metric to="/production" label="Produced" value={`${N(data.producedUnits)} units`} meta={`${N(data.producedPrevUnits)} previous`} tone="green" />
        <Metric to="/receivables" label="Customers owe" value={`${N(data.receivablesEtb)} ETB`} meta={`${data.activeCustomers} active customers`} tone="amber" />
        <Metric to="/payables" label="Supplier debt" value={`${N(data.payablesEtb)} ETB`} meta={data.payablesUsd ? `${N(data.payablesUsd)} USD also due` : 'ETB obligations'} tone="red" />
      </section>

      <section className="mobile-section">
        <div className="mobile-section-title"><div><span>Company position</span><h2>What the business holds</h2></div></div>
        <div className="mobile-position-list">
          <Position to="/inventory" icon={<Boxes />} label="Inventory value" value={`${N(data.inventoryValueEtb)} ETB`} detail={data.daysOfStock == null ? 'Stock coverage unavailable' : `${data.daysOfStock.toFixed(0)} days of stock`} />
          <Position to="/inventory" icon={<Package />} label="Stock-out risk" value={`${data.stockoutRiskCount} products`} detail="Forecast attention" alert={data.stockoutRiskCount > 0} />
          <Position to="/customers" icon={<Users />} label="Customer activity" value={`${data.activeCustomers} active`} detail={`${data.frequentCustomers} repeat customers`} />
          <Position to="/credit-accounts" icon={<CreditCard />} label="Receivables" value={`${N(data.receivablesEtb)} ETB`} detail="Open customer balances" />
        </div>
      </section>

      {(data.topAdvice || data.todoToday.length > 0) && <section className="mobile-section">
        <div className="mobile-section-title"><div><span>Priority queue</span><h2>Needs attention</h2></div><b>{data.todoToday.length + (data.topAdvice ? 1 : 0)}</b></div>
        <div className="mobile-attention-list">
          {data.topAdvice && <article className="is-advice"><i><CircleAlert /></i><div><span>Recommended next step</span><p>{data.topAdvice.text}</p></div></article>}
          {data.todoToday.map((item, index) => item.link ? <Link key={index} to={item.link}><i><CircleAlert /></i><p>{item.text}</p><ChevronRight /></Link> : <article key={index}><i><CircleAlert /></i><p>{item.text}</p></article>)}
        </div>
      </section>}
    </>}
  </div>
}

function QuickAction({ to, icon, label }: { to: string; icon: ReactNode; label: string }) { return <Link to={to}><i>{icon}</i><span>{label}</span></Link> }
function Metric({ to, label, value, meta, tone }: { to: string; label: string; value: string; meta: string; tone: string }) { return <Link to={to} className={`mobile-metric tone-${tone}`}><span>{label}</span><strong>{value}</strong><small>{meta}</small></Link> }
function Position({ to, icon, label, value, detail, alert }: { to: string; icon: ReactNode; label: string; value: string; detail: string; alert?: boolean }) { return <Link to={to} className={alert ? 'is-alert' : ''}><i>{icon}</i><div><span>{label}</span><small>{detail}</small></div><strong>{value}</strong><ChevronRight /></Link> }
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null
  const max = Math.max(...points, 1); const min = Math.min(...points); const range = Math.max(1, max - min)
  const path = points.map((value, index) => `${index ? 'L' : 'M'} ${index / (points.length - 1) * 100} ${36 - (value - min) / range * 30}`).join(' ')
  return <svg className="mobile-sparkline" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="Revenue trend"><path d={`${path} L 100 40 L 0 40 Z`} className="fill" /><path d={path} className="line" /></svg>
}
