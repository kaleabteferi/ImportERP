import { Link } from 'react-router-dom'
import { useDashboardData } from '../../hooks/useDashboardData'
import {
  TrendingUp, Package, Wallet, CreditCard, ShoppingCart, Wrench,
  Banknote, ChevronRight, Loader2, AlertTriangle,
} from 'lucide-react'

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

function Tile({ to, icon: Icon, label, value, tone }: {
  to: string; icon: typeof TrendingUp; label: string; value: string; tone?: 'warn' | 'good'
}) {
  return (
    <Link to={to} className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-col gap-2 active:bg-gray-50">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tone === 'warn' ? 'bg-amber-50 text-amber-600' : tone === 'good' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
        <Icon size={16} />
      </div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-base font-semibold text-gray-900">{value}</p>
      </div>
    </Link>
  )
}

function ActionButton({ to, icon: Icon, label, color }: { to: string; icon: typeof ShoppingCart; label: string; color: string }) {
  return (
    <Link to={to} className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl py-4 text-white ${color} active:opacity-90`}>
      <Icon size={22} />
      <span className="text-xs font-medium">{label}</span>
    </Link>
  )
}

export function MobileHome() {
  const d = useDashboardData('day')
  const today = new Date().toLocaleDateString('en-ET', { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div className="p-4 pb-6 max-w-md mx-auto">
      <div className="mb-4">
        <p className="text-xs text-gray-400">{today}</p>
        <h1 className="text-lg font-semibold">Today at a glance</h1>
      </div>

      {d.loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {d.topAdvice && (
            <div className="bg-indigo-600 text-white rounded-2xl p-4 mb-4">
              <p className="text-xs text-indigo-200 uppercase tracking-wide mb-1">Today's advice</p>
              <p className="text-sm leading-snug">{d.topAdvice.text}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 mb-2">
            <ActionButton to="/sales" icon={ShoppingCart} label="Record sale" color="bg-blue-600" />
            <ActionButton to="/production" icon={Wrench} label="Log production" color="bg-green-600" />
          </div>
          <div className="grid grid-cols-2 gap-2 mb-5">
            <ActionButton to="/money-tracking" icon={Banknote} label="Add income" color="bg-emerald-600" />
            <ActionButton to="/money-tracking" icon={Wallet} label="Add expense" color="bg-red-600" />
          </div>

          <div className="grid grid-cols-2 gap-2.5 mb-5">
            <Tile to="/sales" icon={TrendingUp} label="Revenue today" value={`${N(d.revenueEtb)} ETB`} />
            <Tile to="/production" icon={Package} label="Produced today" value={`${N(d.producedUnits)} units`} />
            <Tile to="/receivables" icon={CreditCard} label="Customers owe" value={`${N(d.receivablesEtb)} ETB`} tone={d.receivablesEtb > 0 ? 'warn' : undefined} />
            <Tile to="/payables" icon={Wallet} label="You owe" value={`${N(d.payablesEtb)} ETB`} tone={d.payablesEtb > 0 ? 'warn' : undefined} />
          </div>

          {d.todoToday.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <p className="text-xs font-medium text-gray-500 px-4 pt-3 pb-1">What needs attention</p>
              {d.todoToday.map((t, i) => {
                const content = (
                  <div className="flex items-center gap-2.5 px-4 py-3">
                    <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                    <p className="flex-1 text-sm text-gray-700">{t.text}</p>
                    {t.link && <ChevronRight size={15} className="text-gray-300 shrink-0" />}
                  </div>
                )
                return t.link
                  ? <Link key={i} to={t.link} className={`block active:bg-gray-50 ${i < d.todoToday.length - 1 ? 'border-b border-gray-50' : ''}`}>{content}</Link>
                  : <div key={i} className={i < d.todoToday.length - 1 ? 'border-b border-gray-50' : ''}>{content}</div>
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
