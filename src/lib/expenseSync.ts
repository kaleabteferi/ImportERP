import { supabase } from './supabase'

/** Machine-readable tag stored in shipment_expenses.notes for auto-synced rows */
export const AUTO_SYNC_PREFIX = 'AUTO_SYNC:'

export type AutoExpenseSource =
  | 'demurrage'
  | 'detention'
  | 'storage'
  | 'port_fee'
  | 'wh_fee'
  | 'customs_duty'
  | 'customs_excise'
  | 'customs_surtax'
  | 'customs_vat'
  | 'customs_wht'
  | 'customs_clearing'
  | 'customs_fob_uplift'

export interface AutoExpenseInput {
  shipmentId: string
  source: AutoExpenseSource
  /** Which container this cost belongs to, when a shipment has more than
   * one. Omitted (or undefined) for the shipment-wide/container-less case
   * -- e.g. demurrage on a manual, PI-less shipment, or Ali's combined
   * forwarder invoice, which is billed once per shipment regardless of how
   * many containers it holds. */
  containerId?: string | null
  /** Distinguishes multiple rows that legitimately share one `source` --
   * e.g. CustomsTab's FOB-uplift rows (Insurance/Freight/Handling/...) all
   * use source='customs_fob_uplift', so without a per-row subKey they'd
   * collide on the same auto_sync_key and a single batch insert of more
   * than one would violate the unique constraint outright. */
  subKey?: string
  category: string
  description: string
  amount: number
  currency: 'ETB' | 'USD' | 'CNY'
  amountEtb: number
  fxRate: number
  vendorName?: string
  expenseDate?: string
  detailNote?: string
}

// Untagged (no :container:<id> / :row:<key> suffix) is reserved for the
// simple single-row case, so existing pre-this-change rows keep matching
// exactly as before -- this is what makes both the per-container split and
// the per-row subKey backward compatible.
function autoTag(source: AutoExpenseSource, containerId?: string | null, subKey?: string) {
  let tag = AUTO_SYNC_PREFIX + source
  if (containerId) tag += `:container:${containerId}`
  if (subKey) tag += `:row:${subKey}`
  return tag
}

export async function findAutoExpense(shipmentId: string, source: AutoExpenseSource, containerId?: string | null, subKey?: string) {
  const { data } = await supabase
    .from('shipment_expenses')
    .select('id, amount, amount_etb, cost_status, is_paid, paid_at')
    .eq('shipment_id', shipmentId)
    .eq('auto_sync_key', autoTag(source, containerId, subKey))
    .maybeSingle()
  return data
}

export async function markAutoExpensesPaid(shipmentId: string, sources: AutoExpenseSource[] = ['demurrage', 'detention', 'storage'], containerId?: string | null) {
  const tags = sources.map(source => autoTag(source, containerId))
  const { data, error } = await supabase
    .from('shipment_expenses')
    .select('id')
    .eq('shipment_id', shipmentId)
    .in('auto_sync_key', tags)

  if (error) throw new Error(error.message)

  if (!data?.length) return

  const { error: updateError } = await supabase
    .from('shipment_expenses')
    .update({ is_paid: true, paid_at: new Date().toISOString() })
    .in('id', data.map(item => item.id))

  if (updateError) throw new Error(updateError.message)
}

export async function hasPaidAutoExpense(shipmentId: string, source: AutoExpenseSource, containerId?: string | null) {
  const record = await findAutoExpense(shipmentId, source, containerId)
  return Boolean(record?.is_paid)
}

/**
 * Upsert or remove a single auto-synced expense. Zero amount removes the row.
 *
 * Uses a real DB-level upsert keyed on (shipment_id, auto_sync_key) --
 * previously this SELECTed for an existing row and then INSERTed if not
 * found, which is a check-then-act race: two near-simultaneous callers
 * (the auto-sync effect racing a manual "Sync now" click, or rapid
 * container-tab switching remounting TimelinePanel) could both see "not
 * found" and both insert, producing duplicate expense rows. The unique
 * index on shipment_expenses(shipment_id, auto_sync_key) makes this upsert
 * atomic at the database level instead.
 */
export async function upsertAutoExpense(input: AutoExpenseInput): Promise<void> {
  const tag = autoTag(input.source, input.containerId, input.subKey)
  const existing = await findAutoExpense(input.shipmentId, input.source, input.containerId, input.subKey)

  if (existing?.is_paid) {
    return
  }

  if (input.amountEtb <= 0 && input.amount <= 0) {
    if (existing) {
      await supabase.from('shipment_expenses').delete().eq('id', existing.id)
    }
    return
  }

  const payload = {
    shipment_id:   input.shipmentId,
    auto_sync_key: tag,
    category:      input.category,
    description:   input.description,
    amount:        input.amount,
    currency:      input.currency,
    amount_etb:    Math.round(input.amountEtb * 100) / 100,
    exchange_rate: input.fxRate,
    vendor_name:   input.vendorName ?? null,
    expense_date:  input.expenseDate ?? new Date().toISOString().split('T')[0],
    receipt_ref:   null,
    notes:         input.detailNote ? `${tag}|${input.detailNote}` : tag,
    cost_status:   'PROVISIONAL' as const,
    updated_at:    new Date().toISOString(),
  }

  const { error } = await supabase
    .from('shipment_expenses')
    .upsert(payload, { onConflict: 'shipment_id,auto_sync_key' })

  if (!error) return

  // A concurrent caller's INSERT can still land between our SELECT above and
  // this upsert -- ON CONFLICT DO UPDATE handles that in the common case,
  // but under REST (one HTTP request = one transaction), the loser of a
  // true simultaneous insert can still surface as a raw 23505 duplicate-key
  // error rather than resolving to the update. If so, the row now
  // definitely exists (that's what the error means) -- fall back to
  // updating it directly by its unique key instead of failing the sync.
  if (error.code === '23505') {
    const { shipment_id, auto_sync_key, ...rest } = payload
    const { error: updateError } = await supabase
      .from('shipment_expenses')
      .update(rest)
      .eq('shipment_id', shipment_id)
      .eq('auto_sync_key', auto_sync_key)
    if (updateError) throw new Error(updateError.message)
    return
  }

  throw new Error(error.message)
}

/** Replace a batch of auto-synced customs lines (deletes old, inserts new). */
export async function replaceAutoExpenses(
  shipmentId: string,
  sourcePrefix: string,
  rows: Omit<AutoExpenseInput, 'shipmentId'>[],
): Promise<void> {
  const { data: existing } = await supabase
    .from('shipment_expenses')
    .select('id')
    .eq('shipment_id', shipmentId)
    .like('auto_sync_key', `${AUTO_SYNC_PREFIX}${sourcePrefix}%`)

  if (existing?.length) {
    await supabase
      .from('shipment_expenses')
      .delete()
      .in('id', existing.map(e => e.id))
  }

  const toInsert = rows
    .filter(r => r.amountEtb > 0)
    .map(r => {
      const tag = autoTag(r.source, r.containerId, r.subKey)
      return {
        shipment_id:   shipmentId,
        auto_sync_key: tag,
        category:      r.category,
        description:   r.description,
        amount:        r.amount,
        currency:      r.currency,
        amount_etb:    Math.round(r.amountEtb * 100) / 100,
        exchange_rate: r.fxRate,
        vendor_name:   r.vendorName ?? null,
        expense_date:  r.expenseDate ?? new Date().toISOString().split('T')[0],
        receipt_ref:   null,
        notes:         r.detailNote ? `${tag}|${r.detailNote}` : tag,
        cost_status:   'PROVISIONAL',
      }
    })

  if (toInsert.length) {
    const { error } = await supabase.from('shipment_expenses').insert(toInsert)
    if (error) throw new Error(error.message)
  }
}

export interface DemurrageCosts {
  demurrageUsd: number
  detentionUsd: number
  /** @deprecated superseded by whUsd -- kept optional so callers can stop
   * passing it without triggering the delete-on-zero branch in
   * upsertAutoExpense against a historical/possibly-paid storage row. */
  storageEtb?: number
  portFeeUsd?: number
  whUsd?: number
}

export async function syncDemurrageExpenses(
  shipmentId: string,
  costs: DemurrageCosts,
  fxRate: number,
  expenseDate?: string,
  containerId?: string | null,
): Promise<void> {
  const date = expenseDate ?? new Date().toISOString().split('T')[0]

  const syncs: Promise<void>[] = [
    upsertAutoExpense({
      shipmentId,
      containerId,
      source: 'demurrage',
      category: 'OTHER',
      description: 'Demurrage (auto-calculated)',
      amount: costs.demurrageUsd,
      currency: 'USD',
      amountEtb: costs.demurrageUsd * fxRate,
      fxRate,
      vendorName: 'Port / Line',
      expenseDate: date,
      detailNote: 'Synced from timeline demurrage calculator',
    }),
    upsertAutoExpense({
      shipmentId,
      containerId,
      source: 'detention',
      category: 'OTHER',
      description: 'Container detention (auto-calculated)',
      amount: costs.detentionUsd,
      currency: 'USD',
      amountEtb: costs.detentionUsd * fxRate,
      fxRate,
      vendorName: 'Port / Line',
      expenseDate: date,
      detailNote: 'Synced from timeline detention calculator',
    }),
  ]

  // storageEtb is intentionally only synced when a caller still passes it --
  // the current TimelinePanel no longer computes it (replaced by whUsd), and
  // passing 0 here would delete any pre-existing AUTO_SYNC:storage row via
  // upsertAutoExpense's zero-amount-removes-the-row rule.
  if (typeof costs.storageEtb === 'number') {
    syncs.push(upsertAutoExpense({
      shipmentId,
      containerId,
      source: 'storage',
      category: 'DJIBOUTI_PORT',
      description: 'Warehouse storage (auto-calculated)',
      amount: costs.storageEtb,
      currency: 'ETB',
      amountEtb: costs.storageEtb,
      fxRate,
      vendorName: 'Djibouti warehouse',
      expenseDate: date,
      detailNote: 'Synced from timeline storage calculator',
    }))
  }

  if (typeof costs.portFeeUsd === 'number') {
    syncs.push(upsertAutoExpense({
      shipmentId,
      containerId,
      source: 'port_fee',
      category: 'DJIBOUTI_PORT',
      description: 'Port fee (auto-calculated)',
      amount: costs.portFeeUsd,
      currency: 'USD',
      amountEtb: costs.portFeeUsd * fxRate,
      fxRate,
      vendorName: 'Djibouti Port Authority',
      expenseDate: date,
      detailNote: 'Synced from timeline port fee calculator',
    }))
  }

  if (typeof costs.whUsd === 'number') {
    syncs.push(upsertAutoExpense({
      shipmentId,
      containerId,
      source: 'wh_fee',
      category: 'DJIBOUTI_PORT',
      description: 'Warehouse (WH) fee (auto-calculated)',
      amount: costs.whUsd,
      currency: 'USD',
      amountEtb: costs.whUsd * fxRate,
      fxRate,
      vendorName: 'Ali - Djibouti Forwarder',
      expenseDate: date,
      detailNote: 'Synced from timeline WH fee calculator',
    }))
  }

  await Promise.all(syncs)
}
