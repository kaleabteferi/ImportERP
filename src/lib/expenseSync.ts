import { supabase } from './supabase'

/** Machine-readable tag stored in shipment_expenses.notes for auto-synced rows */
export const AUTO_SYNC_PREFIX = 'AUTO_SYNC:'

export type AutoExpenseSource =
  | 'demurrage'
  | 'detention'
  | 'storage'
  | 'customs_duty'
  | 'customs_excise'
  | 'customs_surtax'
  | 'customs_vat'
  | 'customs_wht'
  | 'customs_clearing'

export interface AutoExpenseInput {
  shipmentId: string
  source: AutoExpenseSource
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

function autoTag(source: AutoExpenseSource) {
  return `${AUTO_SYNC_PREFIX}${source}`
}

export async function findAutoExpense(shipmentId: string, source: AutoExpenseSource) {
  const { data } = await supabase
    .from('shipment_expenses')
    .select('id, amount, amount_etb, cost_status')
    .eq('shipment_id', shipmentId)
    .eq('notes', autoTag(source))
    .maybeSingle()
  return data
}

/** Upsert or remove a single auto-synced expense. Zero amount removes the row. */
export async function upsertAutoExpense(input: AutoExpenseInput): Promise<void> {
  const tag = autoTag(input.source)
  const existing = await findAutoExpense(input.shipmentId, input.source)

  if (input.amountEtb <= 0 && input.amount <= 0) {
    if (existing) {
      await supabase.from('shipment_expenses').delete().eq('id', existing.id)
    }
    return
  }

  const payload = {
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
  }

  if (existing) {
    const { error } = await supabase
      .from('shipment_expenses')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase
      .from('shipment_expenses')
      .insert({ ...payload, shipment_id: input.shipmentId })
    if (error) throw new Error(error.message)
  }
}

/** Replace a batch of auto-synced customs lines (deletes old, inserts new). */
export async function replaceAutoExpenses(
  shipmentId: string,
  sourcePrefix: string,
  rows: Omit<AutoExpenseInput, 'shipmentId'>[],
): Promise<void> {
  const { data: existing } = await supabase
    .from('shipment_expenses')
    .select('id, notes')
    .eq('shipment_id', shipmentId)
    .like('notes', `${AUTO_SYNC_PREFIX}${sourcePrefix}%`)

  if (existing?.length) {
    await supabase
      .from('shipment_expenses')
      .delete()
      .in('id', existing.map(e => e.id))
  }

  const toInsert = rows
    .filter(r => r.amountEtb > 0)
    .map(r => ({
      shipment_id:   shipmentId,
      category:      r.category,
      description:   r.description,
      amount:        r.amount,
      currency:      r.currency,
      amount_etb:    Math.round(r.amountEtb * 100) / 100,
      exchange_rate: r.fxRate,
      vendor_name:   r.vendorName ?? null,
      expense_date:  r.expenseDate ?? new Date().toISOString().split('T')[0],
      receipt_ref:   null,
      notes:         r.detailNote ? `${autoTag(r.source)}|${r.detailNote}` : autoTag(r.source),
      cost_status:   'PROVISIONAL',
    }))

  if (toInsert.length) {
    const { error } = await supabase.from('shipment_expenses').insert(toInsert)
    if (error) throw new Error(error.message)
  }
}

export interface DemurrageCosts {
  demurrageUsd: number
  detentionUsd: number
  storageEtb: number
}

export async function syncDemurrageExpenses(
  shipmentId: string,
  costs: DemurrageCosts,
  fxRate: number,
  expenseDate?: string,
): Promise<void> {
  const date = expenseDate ?? new Date().toISOString().split('T')[0]

  await Promise.all([
    upsertAutoExpense({
      shipmentId,
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
    upsertAutoExpense({
      shipmentId,
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
    }),
  ])
}
