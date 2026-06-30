import { useState } from 'react'
import { Info, TrendingUp, TrendingDown } from 'lucide-react'

interface MarginItem {
  product_name: string
  sku: string
  quantity: number
  unit_landed_cost_etb: number | null
  unit_price_usd: number
}

interface Props {
  items: MarginItem[]
  fxRate: number
}

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

export function MarginAnalysis({ items, fxRate: _fxRate }: Props) {
  const [targetMargin, setTargetMargin] = useState(30)
  const [customPrices, setCustomPrices] = useState<Record<string, string>>({})
  const [vatRate] = useState(15)   // VAT on sales (if VAT-registered seller)

  const priceItems = items.filter(i => i.unit_landed_cost_etb)

  if (priceItems.length === 0) return (
    <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
      <TrendingUp size={32} className="mx-auto text-gray-200 mb-3" />
      <p className="text-sm font-medium text-gray-500 mb-1">No cost data yet</p>
      <p className="text-xs text-gray-400">
        Calculate landed costs first, then come back here for pricing analysis.
      </p>
    </div>
  )

  const rows = priceItems.map(item => {
    const cost          = item.unit_landed_cost_etb!
    const customPrice   = parseFloat(customPrices[item.sku] ?? '0')
    const minPrice30    = Math.ceil(cost / (1 - targetMargin / 100) / 50) * 50
    const salePrice     = customPrice > 0 ? customPrice : minPrice30
    const grossProfit   = salePrice - cost
    const marginPct     = (grossProfit / salePrice) * 100
    const markupPct     = (grossProfit / cost) * 100
    const salePriceExVat = salePrice / (1 + vatRate / 100)
    const vatAmount     = salePrice - salePriceExVat
    const revenueTotal  = salePrice * item.quantity
    const costTotal     = cost * item.quantity
    const profitTotal   = revenueTotal - costTotal

    return {
      ...item,
      cost,
      salePrice,
      grossProfit,
      marginPct,
      markupPct,
      salePriceExVat,
      vatAmount,
      revenueTotal,
      costTotal,
      profitTotal,
      minPrice30,
      isCustom: customPrice > 0,
    }
  })

  const totalRevenue = rows.reduce((s, r) => s + r.revenueTotal, 0)
  const totalCost    = rows.reduce((s, r) => s + r.costTotal, 0)
  const totalProfit  = rows.reduce((s, r) => s + r.profitTotal, 0)
  const avgMargin    = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

  return (
    <div className="space-y-4">

      {/* Controls */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-1">
            <label className="text-xs text-gray-500 whitespace-nowrap">
              Target margin
            </label>
            <input
              type="range" min="5" max="70" step="1"
              value={targetMargin}
              onChange={e => setTargetMargin(parseInt(e.target.value))}
              className="flex-1 min-w-24"
            />
            <span className="text-sm font-medium text-blue-700 min-w-10">
              {targetMargin}%
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Info size={12} />
            <span>
              Prices rounded up to nearest 50 ETB for clean pricing
            </span>
          </div>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total revenue',    val: N(totalRevenue) + ' ETB', color: 'text-blue-700'  },
          { label: 'Total landed cost',val: N(totalCost)    + ' ETB', color: 'text-red-600'   },
          { label: 'Gross profit',     val: N(totalProfit)  + ' ETB', color: 'text-green-700' },
          { label: 'Average margin',   val: Math.round(avgMargin) + '%',
            color: avgMargin >= 30 ? 'text-green-700' : avgMargin >= 20 ? 'text-amber-600' : 'text-red-600' },
        ].map(k => (
          <div key={k.label} className="bg-gray-50 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-400 mb-1">{k.label}</p>
            <p className={`text-base font-medium font-mono ${k.color}`}>{k.val}</p>
          </div>
        ))}
      </div>

      {/* Per-product pricing table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">
            Pricing & margin per product
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            Enter custom sell price to see your actual margin, or use the
            suggested price for {targetMargin}% margin
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-2.5 font-medium text-gray-400 uppercase tracking-wide">
                  Product
                </th>
                <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">
                  Qty
                </th>
                <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">
                  Landed cost
                </th>
                <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">
                  Min price ({targetMargin}%)
                </th>
                <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">
                  Your sell price
                </th>
                <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">
                  Margin
                </th>
                <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">
                  Markup
                </th>
                <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">
                  Total profit
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(row => {
                const marginOk = row.marginPct >= targetMargin
                const marginWarn = row.marginPct >= targetMargin * 0.7 && row.marginPct < targetMargin
                return (
                  <tr key={row.sku} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{row.product_name}</p>
                      <p className="font-mono text-gray-400 mt-0.5">{row.sku}</p>
                    </td>
                    <td className="px-3 py-3 text-right font-mono">{N(row.quantity)}</td>
                    <td className="px-3 py-3 text-right font-mono text-red-600">
                      {N(row.cost)} ETB
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-blue-700">
                      {N(row.minPrice30)} ETB
                    </td>
                    <td className="px-3 py-3 text-right">
                      <input
                        type="number"
                        step="50"
                        value={customPrices[row.sku] ?? ''}
                        onChange={e => setCustomPrices(p => ({
                          ...p, [row.sku]: e.target.value
                        }))}
                        placeholder={String(N(row.minPrice30))}
                        className="w-28 px-2 py-1.5 text-xs font-mono text-right
                                   border border-gray-200 rounded-lg
                                   focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {marginOk
                          ? <TrendingUp size={12} className="text-green-600" />
                          : <TrendingDown size={12} className="text-red-500" />
                        }
                        <span className={`font-medium ${
                          marginOk ? 'text-green-700'
                          : marginWarn ? 'text-amber-600'
                          : 'text-red-600'
                        }`}>
                          {Math.round(row.marginPct)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-gray-600">
                      {Math.round(row.markupPct)}%
                    </td>
                    <td className={`px-3 py-3 text-right font-mono font-medium
                      ${row.profitTotal >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {N(row.profitTotal)} ETB
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200 font-medium text-sm">
                <td className="px-4 py-3 text-xs text-gray-500">Total</td>
                <td className="px-3 py-3 text-right font-mono text-xs">
                  {N(rows.reduce((s, r) => s + r.quantity, 0))}
                </td>
                <td className="px-3 py-3 text-right font-mono text-red-600">
                  {N(totalCost)} ETB
                </td>
                <td colSpan={2}></td>
                <td className={`px-3 py-3 text-right font-medium
                  ${avgMargin >= 30 ? 'text-green-700' : 'text-amber-600'}`}>
                  {Math.round(avgMargin)}% avg
                </td>
                <td></td>
                <td className="px-3 py-3 text-right font-mono text-green-700">
                  {N(totalProfit)} ETB
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Pricing guidance */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">
          Pricing formulas
        </p>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="font-medium text-gray-700 mb-1">Target margin formula</p>
            <p className="font-mono text-blue-700 text-sm">
              Price = Cost ÷ (1 − margin%)
            </p>
            <p className="text-gray-500 mt-1">
              e.g. Cost 8,750 at 30% margin = 8,750 ÷ 0.70 = 12,500 ETB
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="font-medium text-gray-700 mb-1">Markup formula</p>
            <p className="font-mono text-blue-700 text-sm">
              Price = Cost × (1 + markup%)
            </p>
            <p className="text-gray-500 mt-1">
              30% margin ≠ 30% markup. 30% margin = 42.8% markup on cost.
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="font-medium text-gray-700 mb-1">
              If you charge VAT ({vatRate}%)
            </p>
            <p className="text-gray-500">
              Your customer pays price × 1.{vatRate}.
              Your actual revenue = price (VAT is collected on behalf of ERCA).
              Cost base stays the same.
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="font-medium text-gray-700 mb-1">Break-even</p>
            <p className="text-gray-500">
              The minimum price where margin = 0% is exactly your landed cost.
              Never sell below this — you would be losing money on every unit sold.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}