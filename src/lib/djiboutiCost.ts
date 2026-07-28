// src/lib/djiboutiCost.ts
//
// Shared demurrage/port-fee/detention/WH math, extracted out of
// TimelinePanel so the per-shipment "Expected total owed" summary can
// compute the exact same numbers per container without duplicating (and
// risking drifting from) the logic that drives each container's own cards.
export interface DemurrageRates {
  dem_free_days: number
  dem_rate_day1_10_usd: number
  dem_rate_day11_20_usd: number
  dem_rate_day21_usd: number
  det_free_days: number
  det_rate_day1_7_usd: number
  det_rate_day8_14_usd: number
  det_rate_day15_usd: number
  port_free_days: number
  port_rate_usd_per_day: number
  wh_free_days: number
  wh_rate_usd_per_day: number
}

export const DEFAULT_DEMURRAGE_RATES: DemurrageRates = {
  dem_free_days: 5, dem_rate_day1_10_usd: 70,
  dem_rate_day11_20_usd: 70, dem_rate_day21_usd: 70,
  det_free_days: 7, det_rate_day1_7_usd: 40,
  det_rate_day8_14_usd: 60, det_rate_day15_usd: 80,
  port_free_days: 7, port_rate_usd_per_day: 20,
  wh_free_days: 0, wh_rate_usd_per_day: 15,
}

export interface TimelineEventLike { event_type: string; event_date: string | null; is_actual: boolean }

export interface DjiboutiCosts {
  daysAtPort: number
  daysDetention: number
  daysWh: number
  demurrageCostUsd: number
  detentionCostUsd: number
  portFeeCostUsd: number
  whCostUsd: number
  arrivedDjibouti: Date | null
  freePeriodEnd: Date | null
  isOverdue: boolean
}

function daysBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / 86400000)
}

function getDemurrageCost(daysAtPort: number, rates: DemurrageRates): number {
  if (daysAtPort <= rates.dem_free_days) return 0
  let cost = 0
  for (let d = rates.dem_free_days + 1; d <= daysAtPort; d++) {
    if (d <= 10) cost += rates.dem_rate_day1_10_usd
    else if (d <= 20) cost += rates.dem_rate_day11_20_usd
    else cost += rates.dem_rate_day21_usd
  }
  return cost
}

function getDetentionCost(daysOut: number, rates: DemurrageRates): number {
  if (daysOut <= rates.det_free_days) return 0
  let cost = 0
  for (let d = rates.det_free_days + 1; d <= daysOut; d++) {
    if (d <= 7) cost += rates.det_rate_day1_7_usd
    else if (d <= 14) cost += rates.det_rate_day8_14_usd
    else cost += rates.det_rate_day15_usd
  }
  return cost
}

function getFlatCost(days: number, freeDays: number, ratePerDay: number): number {
  return Math.max(0, days - freeDays) * ratePerDay
}

export function computeDjiboutiCosts(
  events: Record<string, TimelineEventLike>,
  rates: DemurrageRates,
  djiboutiReceivedAt: string | null | undefined,
  asOf: Date = new Date(),
): DjiboutiCosts {
  const arrivedDate = events['ARRIVED_DJIBOUTI']?.event_date ?? null
  const arrivedDjibouti = arrivedDate ? new Date(arrivedDate) : null
  const leftPort = events['LEFT_PORT']?.event_date ? new Date(events['LEFT_PORT'].event_date) : null
  const emptyReturned = events['EMPTY_RETURNED']?.event_date ? new Date(events['EMPTY_RETURNED'].event_date) : null
  const releasedToAli = djiboutiReceivedAt ? new Date(djiboutiReceivedAt) : null

  const daysAtPort = arrivedDjibouti ? daysBetween(arrivedDjibouti, leftPort ?? asOf) : 0
  const daysDetention = leftPort ? daysBetween(leftPort, emptyReturned ?? asOf) : 0
  const daysWh = releasedToAli ? daysBetween(releasedToAli, leftPort ?? asOf) : 0

  const demurrageCostUsd = getDemurrageCost(daysAtPort, rates)
  const detentionCostUsd = getDetentionCost(daysDetention, rates)
  const portFeeCostUsd = getFlatCost(daysAtPort, rates.port_free_days, rates.port_rate_usd_per_day)
  const whCostUsd = getFlatCost(daysWh, rates.wh_free_days, rates.wh_rate_usd_per_day)

  const freePeriodEnd = arrivedDjibouti
    ? new Date(arrivedDjibouti.getTime() + rates.dem_free_days * 86400000)
    : null
  const isOverdue = daysAtPort > rates.dem_free_days && !leftPort

  return {
    daysAtPort, daysDetention, daysWh,
    demurrageCostUsd, detentionCostUsd, portFeeCostUsd, whCostUsd,
    arrivedDjibouti, freePeriodEnd, isOverdue,
  }
}
