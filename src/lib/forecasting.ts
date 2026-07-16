// src/lib/forecasting.ts — statistical demand/stock-out forecasting, no
// external API. Recency-weighted daily-average demand per product, compared
// against effective available stock (on-hand + what can still be built from
// SKD/CKD component stock per an active BOM, since a kit's sellable stock
// isn't fully reflected by its own inventory_ledger balance — see the
// Djibouti/assembly-flow fixes elsewhere in this app).

export interface SalesLine {
  product_id: string
  quantity: number
  sale_date: string // YYYY-MM-DD
}

export interface ForecastRow {
  productId: string
  avgDailyDemand: number
  recentAvgDailyDemand: number
  priorAvgDailyDemand: number
  trendPct: number | null // null when there's no prior-period baseline to compare against
  onHandStock: number
  buildableStock: number
  effectiveStock: number
  daysUntilStockout: number | null // null when there's no measurable demand
  recommendReorderBy: string | null // YYYY-MM-DD, null when not applicable
}

const RECENT_WINDOW_DAYS = 30
const PRIOR_WINDOW_DAYS = 30
// Below this many days of runway, a stock-out is close enough to actively plan for.
export const STOCKOUT_WARNING_DAYS = 21

function isoDate(d: Date) { return d.toISOString().slice(0, 10) }
function daysAgoStr(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d) }

// Recency-weighted average daily demand per product over a 60-day lookback,
// split into a "recent" 30 days and a "prior" 30 days so a trend can be read
// off the comparison, not just a single flat average that hides direction.
export function computeDemandForecast(
  lines: SalesLine[],
  stockByProduct: Map<string, { onHand: number; buildable: number }>,
  today: Date = new Date(),
): Map<string, ForecastRow> {
  const recentStart = daysAgoStr(RECENT_WINDOW_DAYS - 1)
  const priorStart = daysAgoStr(RECENT_WINDOW_DAYS + PRIOR_WINDOW_DAYS - 1)
  const priorEnd = daysAgoStr(RECENT_WINDOW_DAYS)

  const recentByProduct = new Map<string, number>()
  const priorByProduct = new Map<string, number>()

  for (const l of lines) {
    const qty = Number(l.quantity ?? 0)
    if (qty <= 0 || !l.sale_date) continue
    if (l.sale_date >= recentStart) {
      recentByProduct.set(l.product_id, (recentByProduct.get(l.product_id) ?? 0) + qty)
    } else if (l.sale_date >= priorStart && l.sale_date <= priorEnd) {
      priorByProduct.set(l.product_id, (priorByProduct.get(l.product_id) ?? 0) + qty)
    }
  }

  const productIds = new Set([...recentByProduct.keys(), ...priorByProduct.keys(), ...stockByProduct.keys()])
  const result = new Map<string, ForecastRow>()

  for (const productId of productIds) {
    const recentTotal = recentByProduct.get(productId) ?? 0
    const priorTotal = priorByProduct.get(productId) ?? 0
    const recentAvg = recentTotal / RECENT_WINDOW_DAYS
    const priorAvg = priorTotal / PRIOR_WINDOW_DAYS

    // Recency-biased blend: weight the recent window more heavily so a
    // sudden pickup or slump in demand shows up faster than a flat 60-day
    // average would allow, but a single spike day can't swing the forecast
    // alone.
    const avgDailyDemand = priorTotal > 0
      ? recentAvg * 0.7 + priorAvg * 0.3
      : recentAvg

    const trendPct = recentAvg > 0 && priorAvg > 0
      ? ((recentAvg - priorAvg) / priorAvg) * 100
      : null

    const stock = stockByProduct.get(productId) ?? { onHand: 0, buildable: 0 }
    const effectiveStock = stock.onHand + stock.buildable

    const daysUntilStockout = avgDailyDemand > 0 ? effectiveStock / avgDailyDemand : null
    const recommendReorderBy = daysUntilStockout !== null
      ? isoDate(new Date(today.getTime() + Math.max(0, daysUntilStockout) * 86_400_000))
      : null

    result.set(productId, {
      productId,
      avgDailyDemand,
      recentAvgDailyDemand: recentAvg,
      priorAvgDailyDemand: priorAvg,
      trendPct,
      onHandStock: stock.onHand,
      buildableStock: stock.buildable,
      effectiveStock,
      daysUntilStockout,
      recommendReorderBy,
    })
  }

  return result
}
