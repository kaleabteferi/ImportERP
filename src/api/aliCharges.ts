// src/api/aliCharges.ts
//
// Reconciliation between what we expect to pay the Djibouti forwarder (Ali)
// for handling a container and what he actually invoices: Delivery Order,
// Declaration fee, Transfer fee, Labor, Forklift, ECTN, Service charge.
import { supabase } from '../lib/supabase'

export type AliChargeType =
  | 'DELIVERY_ORDER' | 'DECLARATION_FEE' | 'TRANSFER_FEE' | 'LABOR'
  | 'FORKLIFT' | 'ECTN' | 'SERVICE_CHARGE' | 'OTHER'

export const ALI_CHARGE_LABELS: Record<AliChargeType, string> = {
  DELIVERY_ORDER: 'Delivery Order',
  DECLARATION_FEE: 'Declaration fee',
  TRANSFER_FEE: 'Transfer fee',
  LABOR: 'Labor',
  FORKLIFT: 'Forklift',
  ECTN: 'ECTN',
  SERVICE_CHARGE: 'Service charge',
  OTHER: 'Other',
}

export const ALI_CHARGE_TYPES: AliChargeType[] = [
  'DELIVERY_ORDER', 'DECLARATION_FEE', 'TRANSFER_FEE', 'LABOR', 'FORKLIFT', 'ECTN', 'SERVICE_CHARGE',
]

export interface AliCharge {
  id: string
  shipment_id: string
  charge_type: AliChargeType
  custom_label: string | null
  expected_amount: number | null
  actual_amount: number | null
  currency: 'USD' | 'ETB' | 'CNY'
  is_reconciled: boolean
  synced_expense_id: string | null
  notes: string | null
}

export async function listAliCharges(shipmentId: string): Promise<AliCharge[]> {
  const { data, error } = await supabase
    .from('shipment_ali_charges')
    .select('*')
    .eq('shipment_id', shipmentId)
    .order('created_at')
  if (error) throw new Error(error.message)
  return data ?? []
}

export interface AliChargeInput {
  id?: string
  charge_type: AliChargeType
  custom_label?: string | null
  expected_amount?: number | null
  actual_amount?: number | null
  currency?: 'USD' | 'ETB' | 'CNY'
  is_reconciled?: boolean
  notes?: string | null
}

export async function upsertAliCharge(shipmentId: string, input: AliChargeInput): Promise<AliCharge> {
  const payload = {
    shipment_id: shipmentId,
    charge_type: input.charge_type,
    custom_label: input.custom_label ?? null,
    expected_amount: input.expected_amount ?? null,
    actual_amount: input.actual_amount ?? null,
    currency: input.currency ?? 'USD',
    is_reconciled: input.is_reconciled ?? false,
    notes: input.notes ?? null,
    updated_at: new Date().toISOString(),
  }

  if (input.id) {
    const { data, error } = await supabase
      .from('shipment_ali_charges').update(payload).eq('id', input.id).select('*').single()
    if (error) throw new Error(error.message)
    return data
  }
  const { data, error } = await supabase
    .from('shipment_ali_charges').insert(payload).select('*').single()
  if (error) throw new Error(error.message)
  return data
}

// Never cascades into shipment_expenses -- a previously-posted expense is
// real payable history and stays exactly as recorded even if the
// reconciliation row that generated it is removed.
export async function deleteAliCharge(id: string): Promise<void> {
  const { data: charge, error: fetchError } = await supabase
    .from('shipment_ali_charges')
    .select('synced_expense_id, shipment_expenses(is_paid)')
    .eq('id', id)
    .single()
  if (fetchError) throw new Error(fetchError.message)

  const linkedExpense = Array.isArray(charge?.shipment_expenses) ? charge.shipment_expenses[0] : charge?.shipment_expenses
  if (linkedExpense?.is_paid) {
    throw new Error('This charge is linked to an expense already marked paid -- cannot delete.')
  }

  const { error } = await supabase.from('shipment_ali_charges').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// Posts (or updates) one shipment_expenses row for this charge's actual
// amount. No-ops with a friendly error if there's nothing to sync yet, and
// silently does nothing further once the linked expense is already paid --
// same freeze philosophy as the rest of expenseSync.ts.
export async function syncAliChargeToExpense(charge: AliCharge, fxRate: number): Promise<void> {
  if (charge.actual_amount == null) {
    throw new Error("Enter Ali's actual invoiced amount before syncing.")
  }

  const description = charge.charge_type === 'OTHER'
    ? (charge.custom_label || 'Other Ali charge')
    : ALI_CHARGE_LABELS[charge.charge_type]
  const amountEtb = charge.currency === 'ETB' ? charge.actual_amount : charge.actual_amount * fxRate

  if (charge.synced_expense_id) {
    const { data: existing, error: fetchError } = await supabase
      .from('shipment_expenses').select('is_paid').eq('id', charge.synced_expense_id).maybeSingle()
    if (fetchError) throw new Error(fetchError.message)
    if (existing?.is_paid) return // frozen, nothing to do

    const { error } = await supabase.from('shipment_expenses').update({
      description, amount: charge.actual_amount, currency: charge.currency,
      amount_etb: Math.round(amountEtb * 100) / 100, exchange_rate: fxRate,
      updated_at: new Date().toISOString(),
    }).eq('id', charge.synced_expense_id)
    if (error) throw new Error(error.message)
    return
  }

  const { data: inserted, error: insertError } = await supabase.from('shipment_expenses').insert({
    shipment_id: charge.shipment_id,
    category: 'DJIBOUTI_PORT',
    description,
    amount: charge.actual_amount,
    currency: charge.currency,
    amount_etb: Math.round(amountEtb * 100) / 100,
    exchange_rate: fxRate,
    vendor_name: 'Ali - Djibouti Forwarder',
    notes: `AUTO_SYNC:ali_charge|${charge.charge_type}`,
    cost_status: 'PROVISIONAL',
  }).select('id').single()
  if (insertError) throw new Error(insertError.message)

  const { error: linkError } = await supabase
    .from('shipment_ali_charges').update({ synced_expense_id: inserted.id }).eq('id', charge.id)
  if (linkError) throw new Error(linkError.message)
}
