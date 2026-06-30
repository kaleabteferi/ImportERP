import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import {
  Check, Clock, AlertTriangle, Truck,
  Anchor, Building2, RotateCcw, Save, Loader2
} from 'lucide-react'

interface TimelineEvent {
  event_type: string
  event_date: string | null
  is_actual: boolean
  notes: string | null
}

interface DemurrageRate {
  dem_free_days: number
  dem_rate_day1_10_usd: number
  dem_rate_day11_20_usd: number
  dem_rate_day21_usd: number
  det_free_days: number
  det_rate_day1_7_usd: number
  det_rate_day8_14_usd: number
  det_rate_day15_usd: number
  stor_free_days: number
  stor_rate_etb_per_m3: number
}

const EVENTS = [
  { type: 'ORDERED',          label: 'Order placed',           icon: Check,       phase: 'china'     },
  { type: 'ETD',              label: 'ETD China',              icon: Clock,       phase: 'china'     },
  { type: 'ETA_DJIBOUTI',     label: 'ETA Djibouti (planned)', icon: Anchor,      phase: 'sea'       },
  { type: 'ARRIVED_DJIBOUTI', label: 'Arrived Djibouti',       icon: Anchor,      phase: 'djibouti'  },
  { type: 'FREE_PERIOD_END',  label: 'Free period ends',       icon: AlertTriangle, phase: 'djibouti'},
  { type: 'CUSTOMS_START',    label: 'Customs processing',     icon: Building2,   phase: 'djibouti'  },
  { type: 'CUSTOMS_END',      label: 'Customs cleared',        icon: Check,       phase: 'djibouti'  },
  { type: 'LEFT_PORT',        label: 'Left Djibouti',          icon: Truck,       phase: 'transit'   },
  { type: 'ARRIVED_ADDIS',    label: 'Arrived Addis Ababa',    icon: Building2,   phase: 'addis'     },
  { type: 'EMPTY_RETURNED',   label: 'Container returned',     icon: RotateCcw,   phase: 'addis'     },
]

const PHASE_COLORS: Record<string, string> = {
  china:    'bg-red-50 border-red-200 text-red-700',
  sea:      'bg-blue-50 border-blue-200 text-blue-700',
  djibouti: 'bg-amber-50 border-amber-200 text-amber-700',
  transit:  'bg-purple-50 border-purple-200 text-purple-700',
  addis:    'bg-green-50 border-green-200 text-green-700',
}

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

export function TimelinePanel({ shipmentId, fxRate, containerVolumeM3 }: {
  shipmentId: string
  fxRate: number
  containerVolumeM3?: number
}) {
  const [events, setEvents]   = useState<Record<string, TimelineEvent>>({})
  const [rates, setRates]     = useState<DemurrageRate>({
    dem_free_days: 5, dem_rate_day1_10_usd: 50,
    dem_rate_day11_20_usd: 75, dem_rate_day21_usd: 100,
    det_free_days: 7, det_rate_day1_7_usd: 40,
    det_rate_day8_14_usd: 60, det_rate_day15_usd: 80,
    stor_free_days: 3, stor_rate_etb_per_m3: 85,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [showRates, setShowRates] = useState(false)

  async function load() {
    setLoading(true)
    const [evRes, rateRes] = await Promise.all([
      supabase.from('shipment_timeline')
        .select('*').eq('shipment_id', shipmentId),
      supabase.from('demurrage_rates')
        .select('*').eq('shipment_id', shipmentId).maybeSingle(),
    ])

    const evMap: Record<string, TimelineEvent> = {}
    for (const ev of (evRes.data ?? [])) {
      evMap[ev.event_type] = ev
    }
    setEvents(evMap)
    if (rateRes.data) setRates(rateRes.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [shipmentId])

  async function setEventDate(type: string, date: string, isActual: boolean) {
    const payload = {
      shipment_id: shipmentId,
      event_type: type,
      event_date: date || null,
      is_actual: isActual,
    }
    await supabase.from('shipment_timeline')
      .upsert(payload, { onConflict: 'shipment_id,event_type' })
    setEvents(prev => ({ ...prev, [type]: payload as any }))
  }

  async function saveRates() {
    setSaving(true)
    await supabase.from('demurrage_rates')
      .upsert({ ...rates, shipment_id: shipmentId },
               { onConflict: 'shipment_id' })
    setSaving(false)
    load()
  }

  // ── Calculate demurrage ───────────────────────────────────
  const today = new Date()

  function daysBetween(a: Date, b: Date) {
    return Math.floor((b.getTime() - a.getTime()) / 86400000)
  }

  function getDemurrageCost(daysAtPort: number): number {
    if (daysAtPort <= rates.dem_free_days) return 0
    let cost = 0
    for (let d = rates.dem_free_days + 1; d <= daysAtPort; d++) {
      if (d <= 10) cost += rates.dem_rate_day1_10_usd
      else if (d <= 20) cost += rates.dem_rate_day11_20_usd
      else cost += rates.dem_rate_day21_usd
    }
    return cost
  }

  function getDetentionCost(daysOut: number): number {
    if (daysOut <= rates.det_free_days) return 0
    let cost = 0
    for (let d = rates.det_free_days + 1; d <= daysOut; d++) {
      if (d <= 7) cost += rates.det_rate_day1_7_usd
      else if (d <= 14) cost += rates.det_rate_day8_14_usd
      else cost += rates.det_rate_day15_usd
    }
    return cost
  }

  const arrivedDjibouti = events['ARRIVED_DJIBOUTI']?.event_date
    ? new Date(events['ARRIVED_DJIBOUTI'].event_date) : null
  const leftPort = events['LEFT_PORT']?.event_date
    ? new Date(events['LEFT_PORT'].event_date) : null
  const emptyReturned = events['EMPTY_RETURNED']?.event_date
    ? new Date(events['EMPTY_RETURNED'].event_date) : null

  const daysAtPort = arrivedDjibouti
    ? daysBetween(arrivedDjibouti, leftPort ?? today) : 0
  const daysDetention = leftPort
    ? daysBetween(leftPort, emptyReturned ?? today) : 0
  const daysStorage = arrivedDjibouti
    ? daysBetween(arrivedDjibouti, leftPort ?? today) : 0

  const demurrageCostUsd  = getDemurrageCost(daysAtPort)
  const detentionCostUsd  = getDetentionCost(daysDetention)
  const storageCostEtb    = Math.max(0, daysStorage - rates.stor_free_days)
    * (containerVolumeM3 ?? 60) * rates.stor_rate_etb_per_m3

  const freePeriodEnd = arrivedDjibouti
    ? new Date(arrivedDjibouti.getTime() + rates.dem_free_days * 86400000)
    : null
  const daysUntilFreeEnd = freePeriodEnd
    ? daysBetween(today, freePeriodEnd) : null
  const isOverdue = daysAtPort > rates.dem_free_days && !leftPort

  if (loading) return (
    <div className="flex items-center justify-center py-8 text-gray-400 gap-2">
      <Loader2 size={16} className="animate-spin" /> Loading timeline…
    </div>
  )

  return (
    <div className="space-y-4">

      {/* Demurrage alert */}
      {isOverdue && (
        <div className="flex items-start gap-3 px-4 py-3 bg-red-50
                        border border-red-300 rounded-xl">
          <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">
              Demurrage accruing — {daysAtPort - rates.dem_free_days} days overdue
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              Cost to date: {N(demurrageCostUsd)} USD ({N(demurrageCostUsd * fxRate)} ETB) ·
              Adding {N(daysAtPort <= 10
                ? rates.dem_rate_day1_10_usd
                : daysAtPort <= 20
                  ? rates.dem_rate_day11_20_usd
                  : rates.dem_rate_day21_usd)} USD/day
            </p>
          </div>
        </div>
      )}

      {/* Free period warning */}
      {daysUntilFreeEnd !== null && daysUntilFreeEnd > 0 && daysUntilFreeEnd <= 3 && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50
                        border border-amber-300 rounded-xl">
          <Clock size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              Free period ends in {daysUntilFreeEnd} day{daysUntilFreeEnd !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              Free period expires {freePeriodEnd?.toLocaleDateString()}.
              Demurrage starts at {N(rates.dem_rate_day1_10_usd)} USD/day after that.
            </p>
          </div>
        </div>
      )}

      {/* Cost summary */}
      {arrivedDjibouti && (
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: 'Demurrage',
              cost: demurrageCostUsd,
              unit: 'USD',
              days: daysAtPort,
              free: rates.dem_free_days,
              color: demurrageCostUsd > 0 ? 'text-red-600' : 'text-green-600',
            },
            {
              label: 'Detention',
              cost: detentionCostUsd,
              unit: 'USD',
              days: daysDetention,
              free: rates.det_free_days,
              color: detentionCostUsd > 0 ? 'text-amber-600' : 'text-green-600',
            },
            {
              label: 'Port storage',
              cost: storageCostEtb / fxRate,
              unit: 'USD',
              days: daysStorage,
              free: rates.stor_free_days,
              color: storageCostEtb > 0 ? 'text-amber-600' : 'text-green-600',
            },
          ].map(s => (
            <div key={s.label}
                 className="bg-gray-50 rounded-xl px-3 py-2.5">
              <p className="text-xs text-gray-400 mb-1">{s.label}</p>
              <p className={`text-sm font-medium font-mono ${s.color}`}>
                {s.cost > 0 ? `${N(s.cost)} USD` : 'No charge'}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Day {s.days} of {s.free} free
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Timeline events */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100
                        flex items-center justify-between">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">
            Shipment timeline
          </p>
          <button
            onClick={() => setShowRates(v => !v)}
            className="text-xs text-blue-600 hover:underline"
          >
            {showRates ? 'Hide rates' : 'Edit demurrage rates'}
          </button>
        </div>

        {/* Demurrage rates editor */}
        {showRates && (
          <div className="px-4 py-4 bg-amber-50 border-b border-amber-100 space-y-3">
            <p className="text-xs font-medium text-amber-800">
              Demurrage & detention rates for this shipment
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-amber-700 font-medium mb-2">
                  🏭 Demurrage (container at port)
                </p>
                <div className="space-y-2">
                  {[
                    { label: 'Free days', key: 'dem_free_days', type: 'int' },
                    { label: 'Day 1–10 rate (USD/day)', key: 'dem_rate_day1_10_usd', type: 'dec' },
                    { label: 'Day 11–20 rate (USD/day)', key: 'dem_rate_day11_20_usd', type: 'dec' },
                    { label: 'Day 21+ rate (USD/day)', key: 'dem_rate_day21_usd', type: 'dec' },
                  ].map(f => (
                    <div key={f.key} className="flex items-center justify-between">
                      <label className="text-xs text-amber-700">{f.label}</label>
                      <input
                        type="number"
                        step={f.type === 'int' ? 1 : 0.01}
                        value={(rates as any)[f.key]}
                        onChange={e => setRates(p => ({ ...p, [f.key]: parseFloat(e.target.value) || 0 }))}
                        className="w-20 px-2 py-1 text-xs font-mono text-right border
                                   border-amber-200 rounded-lg bg-white focus:outline-none
                                   focus:ring-1 focus:ring-amber-400"
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-amber-700 font-medium mb-2">
                  📦 Detention (container out of port)
                </p>
                <div className="space-y-2">
                  {[
                    { label: 'Free days', key: 'det_free_days', type: 'int' },
                    { label: 'Day 1–7 rate (USD/day)', key: 'det_rate_day1_7_usd', type: 'dec' },
                    { label: 'Day 8–14 rate (USD/day)', key: 'det_rate_day8_14_usd', type: 'dec' },
                    { label: 'Day 15+ rate (USD/day)', key: 'det_rate_day15_usd', type: 'dec' },
                  ].map(f => (
                    <div key={f.key} className="flex items-center justify-between">
                      <label className="text-xs text-amber-700">{f.label}</label>
                      <input
                        type="number"
                        step={f.type === 'int' ? 1 : 0.01}
                        value={(rates as any)[f.key]}
                        onChange={e => setRates(p => ({ ...p, [f.key]: parseFloat(e.target.value) || 0 }))}
                        className="w-20 px-2 py-1 text-xs font-mono text-right border
                                   border-amber-200 rounded-lg bg-white focus:outline-none
                                   focus:ring-1 focus:ring-amber-400"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={saveRates}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-600
                           text-white rounded-lg hover:bg-amber-700 disabled:opacity-50
                           transition-colors"
              >
                {saving
                  ? <><Loader2 size={11} className="animate-spin" /> Saving…</>
                  : <><Save size={11} /> Save rates</>
                }
              </button>
            </div>
          </div>
        )}

        {/* Event list */}
        <div className="divide-y divide-gray-50">
          {EVENTS.map(ev => {
            const existing = events[ev.type]
            const isFuture = !existing?.event_date
            const isPast   = existing?.is_actual && existing?.event_date

            // Highlight free period end
            const isFreePeriodEnd = ev.type === 'FREE_PERIOD_END'

            return (
              <div
                key={ev.type}
                className={`flex items-center gap-3 px-4 py-3
                  ${isFreePeriodEnd ? 'bg-amber-50' : ''}`}
              >
                {/* Status dot */}
                <div className={`w-6 h-6 rounded-full flex items-center justify-center
                                  shrink-0 text-xs
                  ${isPast
                    ? 'bg-green-100 text-green-700'
                    : isFreePeriodEnd && isOverdue
                      ? 'bg-red-100 text-red-600'
                      : 'bg-gray-100 text-gray-400'}`}>
                  <ev.icon size={12} />
                </div>

                {/* Label */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-xs font-medium
                      ${isPast ? 'text-gray-900' : 'text-gray-400'}`}>
                      {ev.label}
                    </p>
                    {isFreePeriodEnd && (
                      <span className="text-xs px-1.5 py-0.5 bg-amber-100
                                       text-amber-700 rounded font-medium">
                        Day {rates.dem_free_days}
                      </span>
                    )}
                  </div>
                  {isFreePeriodEnd && arrivedDjibouti && (
                    <p className="text-xs text-amber-600 mt-0.5">
                      = Arrived ({arrivedDjibouti.toLocaleDateString()})
                      + {rates.dem_free_days} free days
                    </p>
                  )}
                </div>

                {/* Date input */}
                <div className="flex items-center gap-2 shrink-0">
                  {ev.type === 'FREE_PERIOD_END' ? (
                    <p className="text-xs font-mono text-amber-700">
                      {freePeriodEnd?.toLocaleDateString() ?? '—'}
                    </p>
                  ) : (
                    <>
                      <input
                        type="date"
                        value={existing?.event_date ?? ''}
                        onChange={e => setEventDate(ev.type, e.target.value, true)}
                        className="px-2 py-1 text-xs border border-gray-200 rounded-lg
                                   focus:outline-none focus:ring-1 focus:ring-blue-400
                                   bg-white"
                      />
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={existing?.is_actual ?? false}
                          onChange={e => {
                            if (existing?.event_date) {
                              setEventDate(ev.type, existing.event_date, e.target.checked)
                            }
                          }}
                          className="rounded"
                        />
                        <span className="text-xs text-gray-400">Actual</span>
                      </label>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Key deadlines */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-3">
          Key deadlines & rules
        </p>
        <div className="space-y-2 text-xs">
          {[
            {
              icon: '⚠️',
              text: `Demurrage-free period: ${rates.dem_free_days} days from arrival at Djibouti port`,
              detail: `After ${rates.dem_free_days} days: $${rates.dem_rate_day1_10_usd}/day (day 1–10), $${rates.dem_rate_day11_20_usd}/day (11–20), $${rates.dem_rate_day21_usd}/day (21+)`,
            },
            {
              icon: '📦',
              text: `Container detention-free: ${rates.det_free_days} days from leaving port`,
              detail: `Return empty container within ${rates.det_free_days} days to avoid detention charges`,
            },
            {
              icon: '🏭',
              text: `Djibouti warehouse free: ${rates.stor_free_days} days storage at no charge`,
              detail: `After ${rates.stor_free_days} days: ${rates.stor_rate_etb_per_m3} ETB/m³/day`,
            },
            {
              icon: '🛃',
              text: 'Ethiopian customs: declare within 30 days of arrival at port of entry',
              detail: 'Failure to declare within 30 days can result in goods being considered abandoned (Customs Proclamation 622/2009)',
            },
            {
              icon: '💰',
              text: 'Customs duty payment: must be paid within 30 days of duty assessment notice',
              detail: 'Late payment incurs 2% monthly surcharge on outstanding duty',
            },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2
                                    bg-gray-50 rounded-lg">
              <span>{item.icon}</span>
              <div>
                <p className="text-gray-700 font-medium">{item.text}</p>
                <p className="text-gray-500 mt-0.5">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}