import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import {
  Check, Clock, AlertTriangle, Truck,
  Anchor, Building2, RotateCcw, Save, Loader2, RefreshCw, Warehouse,
} from 'lucide-react'
import { hasPaidAutoExpense, markAutoExpensesPaid, syncDemurrageExpenses } from '../../lib/expenseSync'
import { DEFAULT_DEMURRAGE_RATES, computeDjiboutiCosts, type DemurrageRates as DemurrageRate } from '../../lib/djiboutiCost'

interface TimelineEvent {
  event_type: string
  event_date: string | null
  is_actual: boolean
  notes: string | null
}

// EVENTS renders as a connected vertical timeline; RELEASED_TO_ALI is a
// synthetic, read-only node (not a real shipment_timeline row) spliced in
// after CUSTOMS_END -- it mirrors shipments.djibouti_received_at, which is
// set exactly once elsewhere (src/lib/inventoryReceive.ts) when goods post
// into Ali's warehouse stock. It must never be independently editable here,
// or the cost timeline and the warehouse stock ledger could drift apart.
const EVENTS = [
  { type: 'ORDERED',          label: 'Order placed',           icon: Check,       phase: 'china'     },
  { type: 'ETD',              label: 'ETD China',              icon: Clock,       phase: 'china'     },
  { type: 'ETA_DJIBOUTI',     label: 'ETA Djibouti (planned)', icon: Anchor,      phase: 'sea'       },
  { type: 'ARRIVED_DJIBOUTI', label: 'Arrived Djibouti',       icon: Anchor,      phase: 'djibouti'  },
  { type: 'FREE_PERIOD_END',  label: 'Free period ends',       icon: AlertTriangle, phase: 'djibouti'},
  { type: 'CUSTOMS_START',    label: 'Customs processing',     icon: Building2,   phase: 'djibouti'  },
  { type: 'CUSTOMS_END',      label: 'Customs cleared',        icon: Check,       phase: 'djibouti'  },
  { type: 'RELEASED_TO_ALI',  label: "Released to Ali's warehouse", icon: Warehouse, phase: 'djibouti', readOnly: true },
  { type: 'LEFT_PORT',        label: 'Left Djibouti',          icon: Truck,       phase: 'transit'   },
  { type: 'ARRIVED_ADDIS',    label: 'Arrived Addis Ababa',    icon: Building2,   phase: 'addis'     },
  { type: 'EMPTY_RETURNED',   label: 'Container returned',     icon: RotateCcw,   phase: 'addis'     },
]

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

export function TimelinePanel({ shipmentId, containerId = null, fxRate, containerVolumeM3, djiboutiReceivedAt }: {
  shipmentId: string
  /** Which container within this shipment this panel tracks. null for a
   * container-less (manual) shipment, or the shipment's sole container --
   * ContainerTimelineTabs only passes a real id when a shipment has 2+
   * containers needing independent tracking. */
  containerId?: string | null
  fxRate: number
  containerVolumeM3?: number
  djiboutiReceivedAt?: string | null
}) {
  void containerVolumeM3 // no longer used now that storage is flat $/day, not ETB/m3 -- kept for call-site compatibility
  const [events, setEvents]   = useState<Record<string, TimelineEvent>>({})
  const [rates, setRates]     = useState<DemurrageRate>(DEFAULT_DEMURRAGE_RATES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [showRates, setShowRates] = useState(false)
  const lastSyncKey = useRef('')

  async function load() {
    setLoading(true)
    const timelineQuery = supabase.from('shipment_timeline').select('*').eq('shipment_id', shipmentId)
    const rateQuery = supabase.from('demurrage_rates').select('*').eq('shipment_id', shipmentId)
    const [evRes, rateRes] = await Promise.all([
      containerId ? timelineQuery.eq('container_id', containerId) : timelineQuery.is('container_id', null),
      (containerId ? rateQuery.eq('container_id', containerId) : rateQuery.is('container_id', null)).maybeSingle(),
    ])

    const evMap: Record<string, TimelineEvent> = {}
    for (const ev of (evRes.data ?? [])) {
      evMap[ev.event_type] = ev
    }
    setEvents(evMap)
    if (rateRes.data) setRates(prev => ({ ...prev, ...rateRes.data }))
    setLoading(false)
  }

  useEffect(() => { load() }, [shipmentId, containerId])

  async function setEventDate(type: string, date: string, isActual: boolean) {
    const payload = {
      shipment_id: shipmentId,
      container_id: containerId,
      event_type: type,
      event_date: date || null,
      is_actual: isActual,
    }
    await supabase.from('shipment_timeline')
      .upsert(payload, { onConflict: 'shipment_id,container_key,event_type' })
    setEvents(prev => ({ ...prev, [type]: payload as any }))
    lastSyncKey.current = ''
  }

  async function saveRates() {
    setSaving(true)
    await supabase.from('demurrage_rates')
      .upsert({ ...rates, shipment_id: shipmentId, container_id: containerId },
               { onConflict: 'shipment_id,container_key' })
    setSaving(false)
    load()
  }

  // ── Calculate demurrage ───────────────────────────────────
  const today = new Date()
  const arrivedDate = events['ARRIVED_DJIBOUTI']?.event_date ?? null
  const releasedToAli = djiboutiReceivedAt ? new Date(djiboutiReceivedAt) : null

  const {
    daysAtPort, daysDetention, daysWh,
    demurrageCostUsd, detentionCostUsd, portFeeCostUsd, whCostUsd,
    arrivedDjibouti, freePeriodEnd, isOverdue,
  } = computeDjiboutiCosts(events, rates, djiboutiReceivedAt, today)

  function daysBetween(a: Date, b: Date) {
    return Math.floor((b.getTime() - a.getTime()) / 86400000)
  }
  const daysUntilFreeEnd = freePeriodEnd
    ? daysBetween(today, freePeriodEnd) : null

  const syncCosts = useCallback(async () => {
    if (!arrivedDate) return
    setSyncing(true)
    setSyncMsg(null)
    try {
      const paid = await Promise.all([
        hasPaidAutoExpense(shipmentId, 'demurrage', containerId),
        hasPaidAutoExpense(shipmentId, 'detention', containerId),
        hasPaidAutoExpense(shipmentId, 'port_fee', containerId),
        hasPaidAutoExpense(shipmentId, 'wh_fee', containerId),
      ])
      if (paid.some(Boolean)) {
        setSyncMsg('Some Djibouti costs are marked paid; no further accrual will be synced for those')
        return
      }
      await syncDemurrageExpenses(shipmentId, {
        demurrageUsd: demurrageCostUsd,
        detentionUsd: detentionCostUsd,
        portFeeUsd: portFeeCostUsd,
        whUsd: whCostUsd,
      }, fxRate, undefined, containerId)
      setSyncMsg('Demurrage, port fee, detention & WH synced to expenses')
    } catch (e: any) {
      setSyncMsg(`Sync failed: ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }, [shipmentId, containerId, demurrageCostUsd, detentionCostUsd, portFeeCostUsd, whCostUsd, fxRate, arrivedDate])

  async function markPaid() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      await markAutoExpensesPaid(shipmentId, ['demurrage', 'detention', 'port_fee', 'wh_fee'], containerId)
      setSyncMsg('Demurrage, detention, port fee and WH marked as paid')
      await load()
    } catch (e: any) {
      setSyncMsg(`Unable to mark paid: ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    if (!arrivedDate) return
    const key = `${demurrageCostUsd}|${detentionCostUsd}|${portFeeCostUsd}|${whCostUsd}`
    if (key === lastSyncKey.current) return
    lastSyncKey.current = key
    Promise.all([
      hasPaidAutoExpense(shipmentId, 'demurrage', containerId),
      hasPaidAutoExpense(shipmentId, 'detention', containerId),
      hasPaidAutoExpense(shipmentId, 'port_fee', containerId),
      hasPaidAutoExpense(shipmentId, 'wh_fee', containerId),
    ])
      .then(async paid => {
        if (paid.some(Boolean)) {
          setSyncMsg('Some Djibouti costs are marked paid; no further accrual will be synced for those')
          return
        }
        await syncDemurrageExpenses(shipmentId, {
          demurrageUsd: demurrageCostUsd,
          detentionUsd: detentionCostUsd,
          portFeeUsd: portFeeCostUsd,
          whUsd: whCostUsd,
        }, fxRate, undefined, containerId)
        setSyncMsg('Djibouti costs auto-synced to expenses')
      })
      .catch((e: Error) => setSyncMsg(`Sync failed: ${e.message}`))
  }, [demurrageCostUsd, detentionCostUsd, portFeeCostUsd, whCostUsd, arrivedDate, shipmentId, containerId, fxRate])

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
              Demurrage &amp; port fee accruing — {daysAtPort - rates.dem_free_days} days overdue
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              Cost to date: {N(demurrageCostUsd + portFeeCostUsd)} USD ({N((demurrageCostUsd + portFeeCostUsd) * fxRate)} ETB) ·
              Demurrage {N(daysAtPort <= 10
                ? rates.dem_rate_day1_10_usd
                : daysAtPort <= 20
                  ? rates.dem_rate_day11_20_usd
                  : rates.dem_rate_day21_usd)}/day + Port fee {N(rates.port_rate_usd_per_day)}/day
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
              Demurrage + port fee start accruing after that.
            </p>
          </div>
        </div>
      )}

      {/* Cost summary */}
      {arrivedDjibouti && (
        <div className="grid grid-cols-4 gap-3">
          {[
            {
              label: 'Demurrage',
              cost: demurrageCostUsd,
              days: daysAtPort,
              free: rates.dem_free_days,
              color: demurrageCostUsd > 0 ? 'text-red-600' : 'text-green-600',
            },
            {
              label: 'Port fee',
              cost: portFeeCostUsd,
              days: daysAtPort,
              free: rates.port_free_days,
              color: portFeeCostUsd > 0 ? 'text-red-600' : 'text-green-600',
            },
            {
              label: 'WH (warehouse)',
              cost: whCostUsd,
              days: daysWh,
              free: rates.wh_free_days,
              color: whCostUsd > 0 ? 'text-amber-600' : 'text-green-600',
            },
            {
              label: 'Detention',
              cost: detentionCostUsd,
              days: daysDetention,
              free: rates.det_free_days,
              color: detentionCostUsd > 0 ? 'text-amber-600' : 'text-green-600',
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
          <div className="col-span-4 flex items-center justify-between pt-1">
            <p className="text-xs text-gray-400">
              Auto-synced to shipment expenses (updates existing rows, no duplicates)
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={markPaid}
                disabled={syncing}
                className="flex items-center gap-1 text-xs px-2.5 py-1 border border-green-200 text-green-700 rounded-lg hover:bg-green-50 disabled:opacity-50 transition-colors"
              >
                <Check size={11} /> Mark paid
              </button>
              <button
                onClick={syncCosts}
                disabled={syncing}
                className="flex items-center gap-1 text-xs px-2.5 py-1 border border-gray-200
                           rounded-lg hover:bg-white disabled:opacity-50 transition-colors"
              >
                <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
          </div>
          {syncMsg && (
            <p className="col-span-4 text-xs text-blue-600">{syncMsg}</p>
          )}
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
            {showRates ? 'Hide rates' : 'Edit rates'}
          </button>
        </div>

        {/* Rates editor */}
        {showRates && (
          <div className="px-4 py-4 bg-amber-50 border-b border-amber-100 space-y-4">
            <p className="text-xs font-medium text-amber-800">
              Djibouti cost rates for this shipment
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-amber-700 font-medium mb-2">
                  🏭 Demurrage (container at port — shipping line)
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
                  🛂 Port fee (container at port — port authority)
                </p>
                <div className="space-y-2">
                  {[
                    { label: 'Free days', key: 'port_free_days', type: 'int' },
                    { label: 'Rate (USD/day)', key: 'port_rate_usd_per_day', type: 'dec' },
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
              <div>
                <p className="text-xs text-amber-700 font-medium mb-2">
                  🏬 WH (Ali's warehouse, from release date)
                </p>
                <div className="space-y-2">
                  {[
                    { label: 'Free days', key: 'wh_free_days', type: 'int' },
                    { label: 'Rate (USD/day)', key: 'wh_rate_usd_per_day', type: 'dec' },
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

        {/* Connected vertical timeline */}
        <div className="relative px-4 py-3">
          <div className="absolute left-[27px] top-3 bottom-3 w-0.5 bg-gray-100" aria-hidden />
          <div className="space-y-0">
            {EVENTS.map((ev, i) => {
              const isReadOnly = !!(ev as any).readOnly
              const existing = isReadOnly ? null : events[ev.type]
              const isPast = isReadOnly ? !!releasedToAli : !!(existing?.is_actual && existing?.event_date)
              const isFreePeriodEnd = ev.type === 'FREE_PERIOD_END'
              const nextReached = i > 0 ? (() => {
                const prevEv = EVENTS[i - 1]
                if ((prevEv as any).readOnly) return !!releasedToAli
                return !!(events[prevEv.type]?.is_actual && events[prevEv.type]?.event_date)
              })() : true

              return (
                <div key={ev.type} className={`relative flex items-start gap-3 py-2.5 ${isFreePeriodEnd ? 'bg-amber-50 -mx-4 px-4' : ''}`}>
                  {/* Connector segment from previous node */}
                  {i > 0 && (
                    <div className={`absolute left-[27px] -top-2.5 h-2.5 w-0.5 ${nextReached ? 'bg-green-400' : 'bg-gray-200'}`} aria-hidden />
                  )}
                  <div className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center
                                    shrink-0 text-xs
                    ${isPast
                      ? 'bg-green-100 text-green-700'
                      : isFreePeriodEnd && isOverdue
                        ? 'bg-red-100 text-red-600'
                        : isReadOnly
                          ? 'bg-blue-50 text-blue-400'
                          : 'bg-gray-100 text-gray-400'}`}>
                    <ev.icon size={12} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-xs font-medium ${isPast ? 'text-gray-900' : 'text-gray-400'}`}>
                        {ev.label}
                      </p>
                      {isFreePeriodEnd && (
                        <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">
                          Day {rates.dem_free_days}
                        </span>
                      )}
                      {isReadOnly && (
                        <span className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded font-medium">
                          Auto-tracked
                        </span>
                      )}
                    </div>
                    {isFreePeriodEnd && arrivedDjibouti && (
                      <p className="text-xs text-amber-600 mt-0.5">
                        = Arrived ({arrivedDjibouti.toLocaleDateString()}) + {rates.dem_free_days} free days
                        · Demurrage {N(rates.dem_rate_day1_10_usd)}/day + Port fee {N(rates.port_rate_usd_per_day)}/day after this
                      </p>
                    )}
                    {isReadOnly && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {releasedToAli
                          ? `${releasedToAli.toLocaleDateString()} · WH fee accrues from here (day ${daysWh} of ${rates.wh_free_days} free)`
                          : 'Not yet released — set when the shipment status moves to "At Djibouti"'}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {ev.type === 'FREE_PERIOD_END' ? (
                      <p className="text-xs font-mono text-amber-700">
                        {freePeriodEnd?.toLocaleDateString() ?? '—'}
                      </p>
                    ) : isReadOnly ? (
                      <p className="text-xs font-mono text-blue-600">
                        {releasedToAli?.toLocaleDateString() ?? '—'}
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
              icon: '🛂',
              text: `Port fee-free period: ${rates.port_free_days} days from arrival at Djibouti port`,
              detail: `After ${rates.port_free_days} days: $${rates.port_rate_usd_per_day}/day, charged separately from demurrage by the port authority`,
            },
            {
              icon: '📦',
              text: `Container detention-free: ${rates.det_free_days} days from leaving port`,
              detail: `Return empty container within ${rates.det_free_days} days to avoid detention charges`,
            },
            {
              icon: '🏬',
              text: `Ali's warehouse (WH) free: ${rates.wh_free_days} days from release into his warehouse`,
              detail: `After ${rates.wh_free_days} days: $${rates.wh_rate_usd_per_day}/day, counted from the release date — not from arrival`,
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
