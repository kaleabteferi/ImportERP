// src/components/shipments/ShipmentOwedSummary.tsx
//
// "As of today, how much do we currently owe, and to whom?" -- summed live
// across every container on this shipment (each tracked independently) plus
// Ali's forwarder invoice, using the exact same day-by-day math each
// container's own TimelinePanel cards already show (see lib/djiboutiCost.ts).
// WH storage fee is grouped under Ali (it's his warehouse); demurrage +
// detention under the shipping line; port fee under the port authority.
import { useEffect, useState } from 'react'
import { Loader2, TrendingUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { DEFAULT_DEMURRAGE_RATES, computeDjiboutiCosts, type DemurrageRates, type TimelineEventLike } from '../../lib/djiboutiCost'
import { listAliCharges } from '../../api/aliCharges'

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

async function loadContainerCosts(shipmentId: string, containerId: string | null, djiboutiReceivedAt: string | null) {
  const timelineQuery = supabase.from('shipment_timeline').select('*').eq('shipment_id', shipmentId)
  const rateQuery = supabase.from('demurrage_rates').select('*').eq('shipment_id', shipmentId)
  const [evRes, rateRes] = await Promise.all([
    containerId ? timelineQuery.eq('container_id', containerId) : timelineQuery.is('container_id', null),
    (containerId ? rateQuery.eq('container_id', containerId) : rateQuery.is('container_id', null)).maybeSingle(),
  ])
  const evMap: Record<string, TimelineEventLike> = {}
  for (const ev of (evRes.data ?? [])) evMap[ev.event_type] = ev
  const rates: DemurrageRates = { ...DEFAULT_DEMURRAGE_RATES, ...(rateRes.data ?? {}) }
  return computeDjiboutiCosts(evMap, rates, djiboutiReceivedAt)
}

interface Breakdown { shippingLineUsd: number; portAuthorityUsd: number; aliUsd: number }

export function ShipmentOwedSummary({ shipmentId, containerIds, fxRate, djiboutiReceivedAt }: {
  shipmentId: string
  /** One entry per container on this shipment; [] for a manual, container-less shipment (still tracked as a single null-container row). */
  containerIds: string[]
  fxRate: number
  djiboutiReceivedAt?: string | null
}) {
  const [loading, setLoading] = useState(true)
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const ids: (string | null)[] = containerIds.length > 0 ? containerIds : [null]

    Promise.all([
      Promise.all(ids.map(id => loadContainerCosts(shipmentId, id, djiboutiReceivedAt ?? null))),
      listAliCharges(shipmentId),
    ]).then(([containerCosts, aliCharges]) => {
      if (cancelled) return
      const shippingLineUsd = containerCosts.reduce((s, c) => s + c.demurrageCostUsd + c.detentionCostUsd, 0)
      const portAuthorityUsd = containerCosts.reduce((s, c) => s + c.portFeeCostUsd, 0)
      const whUsd = containerCosts.reduce((s, c) => s + c.whCostUsd, 0)
      const aliChargesUsd = aliCharges.reduce((s, c) => {
        const amount = c.actual_amount ?? c.expected_amount
        if (amount == null) return s
        // Same USD/ETB convention used elsewhere (syncAliChargeToExpense):
        // CNY is treated like USD -- fxRate is the only conversion rate this
        // shipment tracks.
        return s + (c.currency === 'ETB' ? amount / (fxRate || 1) : amount)
      }, 0)
      setBreakdown({ shippingLineUsd, portAuthorityUsd, aliUsd: whUsd + aliChargesUsd })
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [shipmentId, containerIds.join(','), fxRate, djiboutiReceivedAt])

  if (loading || !breakdown) {
    return <div className="flex items-center gap-2 text-xs text-gray-400 py-4"><Loader2 size={14} className="animate-spin" /> Calculating total owed…</div>
  }

  const totalUsd = breakdown.shippingLineUsd + breakdown.portAuthorityUsd + breakdown.aliUsd
  if (totalUsd <= 0) return null

  return (
    <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-100 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={14} className="text-blue-600" />
        <p className="text-xs font-medium text-blue-900 uppercase tracking-wide">Total currently owed (as of today)</p>
      </div>
      <p className="text-2xl font-semibold font-mono text-blue-900">
        {N(totalUsd)} USD <span className="text-sm font-normal text-blue-400">({N(totalUsd * fxRate)} ETB)</span>
      </p>
      <div className="grid grid-cols-3 gap-3 mt-3">
        {[
          { label: 'Shipping line', sub: 'Demurrage + detention', value: breakdown.shippingLineUsd },
          { label: 'Port authority', sub: 'Port fee', value: breakdown.portAuthorityUsd },
          { label: 'Ali', sub: 'Warehouse (WH) + forwarder charges', value: breakdown.aliUsd },
        ].map(r => (
          <div key={r.label} className="bg-white/70 rounded-lg px-3 py-2">
            <p className="text-xs text-gray-400">{r.label}</p>
            <p className="text-sm font-medium font-mono text-gray-800">{N(r.value)} USD</p>
            <p className="text-xs text-gray-400 mt-0.5">{r.sub}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
