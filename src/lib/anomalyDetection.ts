// src/lib/anomalyDetection.ts — lightweight, non-LLM anomaly checks over the
// unified transaction list (same shape Money Tracking already builds from
// sales_payments, supplier_payments, credit_transactions, company_expenses,
// and shipment_expenses). Pure statistics: outlier amounts within a peer group,
// and same-party/same-amount pairs close together in time (possible duplicate
// entry — the exact failure mode a duplicate-order resubmit or a double-paid
// invoice would produce).

export interface AnomalyTxn {
  id: string
  direction: 'in' | 'out'
  party: string
  amount: number
  currency: string
  date: string | null
  source: string
}

export interface Anomaly {
  txnId: string
  type: 'amount_outlier' | 'possible_duplicate'
  severity: 'high' | 'medium'
  reason: string
}

const MIN_PEER_GROUP = 5
const OUTLIER_MULTIPLE = 4
const HIGH_SEVERITY_MULTIPLE = 8
const DUPLICATE_WINDOW_DAYS = 3

const fmt = (n: number) => Math.round(n).toLocaleString('en-ET')
const sourceLabel = (s: string) => s.replace(/_/g, ' ')

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Flags amounts far above the typical amount for the same source/currency/
// direction — e.g. a supplier payment 6x the usual size for that payment type.
// Needs a minimum peer-group size so a single early transaction of a new kind
// isn't flagged against itself.
export function detectAmountOutliers(txns: AnomalyTxn[]): Anomaly[] {
  const anomalies: Anomaly[] = []
  const groups = new Map<string, AnomalyTxn[]>()
  for (const t of txns) {
    if (t.amount <= 0) continue
    const key = `${t.source}:${t.currency}:${t.direction}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(t)
  }

  for (const group of groups.values()) {
    if (group.length < MIN_PEER_GROUP) continue
    const med = median(group.map(t => t.amount))
    if (med <= 0) continue
    for (const t of group) {
      if (t.amount >= med * OUTLIER_MULTIPLE) {
        anomalies.push({
          txnId: t.id,
          type: 'amount_outlier',
          severity: t.amount >= med * HIGH_SEVERITY_MULTIPLE ? 'high' : 'medium',
          reason: `${fmt(t.amount)} ${t.currency} is ${(t.amount / med).toFixed(1)}x the typical ${sourceLabel(t.source)} amount (median ${fmt(med)} ${t.currency}).`,
        })
      }
    }
  }
  return anomalies
}

// Flags same party + same amount + same currency + same direction within a
// short window — the signature of a duplicate entry (paid twice, or a
// resubmitted sale/order recorded a second time).
export function detectPossibleDuplicates(txns: AnomalyTxn[]): Anomaly[] {
  const anomalies: Anomaly[] = []
  const groups = new Map<string, AnomalyTxn[]>()
  for (const t of txns) {
    if (!t.date || t.amount <= 0 || !t.party) continue
    const key = `${t.party.trim().toLowerCase()}:${t.amount}:${t.currency}:${t.direction}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(t)
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    for (let i = 1; i < sorted.length; i++) {
      const days = Math.abs(
        (new Date(sorted[i].date!).getTime() - new Date(sorted[i - 1].date!).getTime()) / 86_400_000,
      )
      if (days <= DUPLICATE_WINDOW_DAYS) {
        anomalies.push({
          txnId: sorted[i].id,
          type: 'possible_duplicate',
          severity: days === 0 ? 'high' : 'medium',
          reason: `Same amount (${fmt(sorted[i].amount)} ${sorted[i].currency}) ${sorted[i].direction === 'in' ? 'from' : 'to'} ${sorted[i].party} as another transaction ${days === 0 ? 'the same day' : `${Math.round(days)}d apart`} — check it isn't a duplicate.`,
        })
      }
    }
  }
  return anomalies
}

export function detectAnomalies(txns: AnomalyTxn[]): Anomaly[] {
  return [...detectPossibleDuplicates(txns), ...detectAmountOutliers(txns)]
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1))
}
