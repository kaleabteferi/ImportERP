import { ArrowRightLeft } from 'lucide-react'

// Shared "hawala breakdown" block, reused by every payment/expense form in
// the app (Supplier Payments, Payables, Expenses, Sales, Credit Accounts,
// Quick Actions, ...) rather than duplicating the same three fields and
// the ETB/rate → converted-amount math in each one.
//
// When targetCurrency is ETB (or omitted — sales/credit are always ETB),
// there's nothing to convert: the amount field elsewhere in the form
// already IS the ETB amount, so only the route shows, for record-keeping.
export interface HawalaValue { route: string; etbAmount: string; exchangeRate: string }

export function emptyHawalaValue(): HawalaValue {
  return { route: '', etbAmount: '', exchangeRate: '' }
}

export function computeHawalaAmount(value: HawalaValue): number | null {
  const etb = Number(value.etbAmount)
  const rate = Number(value.exchangeRate)
  if (etb > 0 && rate > 0) return Math.round((etb / rate) * 100) / 100
  return null
}

export function HawalaFields({ value, onChange, targetCurrency }: {
  value: HawalaValue
  onChange: (next: HawalaValue) => void
  targetCurrency?: string | null
}) {
  const needsConversion = !!targetCurrency && targetCurrency !== 'ETB'
  const computed = computeHawalaAmount(value)

  return (
    <div className="bg-purple-50/50 border border-purple-100 rounded-lg p-3 space-y-2">
      <input
        value={value.route}
        onChange={e => onChange({ ...value, route: e.target.value })}
        placeholder="Hawala dealer / route (e.g. Ahmed - Merkato to Guangzhou)"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg"
      />
      {needsConversion && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={value.etbAmount} onChange={e => onChange({ ...value, etbAmount: e.target.value })}
              placeholder="ETB paid to dealer" className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
            <input type="number" value={value.exchangeRate} onChange={e => onChange({ ...value, exchangeRate: e.target.value })}
              placeholder={`Rate (ETB per 1 ${targetCurrency})`} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          </div>
          <p className="text-xs text-purple-700 flex items-center gap-1">
            <ArrowRightLeft size={11} className="shrink-0" />
            {computed != null
              ? <>≈ <span className="font-mono font-medium">{N(computed)} {targetCurrency}</span> reaches the other side</>
              : 'Enter ETB paid and the rate to see the converted amount.'}
          </p>
        </>
      )}
    </div>
  )
}

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 2 }).format(n)
