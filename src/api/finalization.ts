// src/api/finalization.ts

import { supabase } from '../lib/supabase'

export interface ExpenseForReview {
  id: string
  category: string
  description: string
  amount: number
  currency: string
  amount_etb: number
  cost_status: 'PROVISIONAL' | 'FINAL'
  vendor_name: string | null
  expense_date: string
  receipt_ref: string | null
}

export interface ItemForReview {
  id: string
  product_id: string
  product_name: string
  product_sku: string
  quantity: number
  unit_price_usd: number
  weight_kg_total: number | null
  volume_m3_total: number | null
  unit_landed_cost_etb: number | null
  cost_status: string
}

export interface CostImpact {
  product_name: string
  old_unit_cost: number
  new_unit_cost: number
  change_per_unit: number
  qty_on_hand: number
  qty_already_sold: number
  inventory_adjustment: number
}

export interface FinalizationResult {
  shipment_id: string
  finalized_at: string
  total_overhead: number
  exchange_rate: number
  method: string
  items: CostImpact[]
}

// Fetch everything needed for the review step
export async function fetchFinalizationData(shipmentId: string) {
  const [expRes, itemRes, fxRes] = await Promise.all([
    supabase
      .from('shipment_expenses')
      .select('id, category, description, amount, currency, amount_etb, cost_status, vendor_name, expense_date, receipt_ref')
      .eq('shipment_id', shipmentId)
      .order('category')
      .order('expense_date'),

    supabase
      .from('shipment_items')
      .select('id, product_id, quantity, unit_price_usd, weight_kg_total, volume_m3_total, unit_landed_cost_etb, cost_status, products(name, sku)')
      .eq('shipment_id', shipmentId)
      .eq('cost_status', 'PROVISIONAL'),

    supabase
      .from('forex_rates')
      .select('rate')
      .eq('from_currency', 'USD')
      .eq('to_currency', 'ETB')
      .eq('rate_type', 'CUSTOMS')
      .order('effective_date', { ascending: false })
      .limit(1)
      .single(),
  ])

  const items: ItemForReview[] = (itemRes.data ?? []).map((row: any) => ({
    id:                   row.id,
    product_id:           row.product_id,
    product_name:         row.products?.name ?? '—',
    product_sku:          row.products?.sku  ?? '—',
    quantity:             row.quantity,
    unit_price_usd:       row.unit_price_usd,
    weight_kg_total:      row.weight_kg_total,
    volume_m3_total:      row.volume_m3_total,
    unit_landed_cost_etb: row.unit_landed_cost_etb,
    cost_status:          row.cost_status,
  }))

  return {
    expenses:     (expRes.data ?? []) as ExpenseForReview[],
    items,
    latestFxRate: fxRes.data?.rate ?? 131.20,
  }
}

// Update a single expense amount before finalizing
export async function updateExpenseAmount(
  expenseId: string,
  newAmount: number,
  currency: string,
  fxRate: number,
) {
  const amountEtb = currency === 'ETB' ? newAmount
    : currency === 'USD' ? newAmount * fxRate
    : newAmount * (fxRate / 7.2)

  const { error } = await supabase
    .from('shipment_expenses')
    .update({
      amount:        newAmount,
      amount_etb:    Math.round(amountEtb * 100) / 100,
      exchange_rate: fxRate,
      updated_at:    new Date().toISOString(),
    })
    .eq('id', expenseId)

  if (error) throw new Error(error.message)
}

// Calculate cost preview (pure JS, no DB write)
export function calculateCostPreview(
  items:         ItemForReview[],
  totalOverhead: number,
  fxRate:        number,
  method:        'QUANTITY' | 'WEIGHT' | 'VOLUME' | 'VALUE',
): CostImpact[] {
  const getBasis = (item: ItemForReview) => {
    switch (method) {
      case 'WEIGHT': return item.weight_kg_total ?? item.quantity
      case 'VOLUME': return item.volume_m3_total ?? item.quantity
      case 'VALUE':  return item.quantity * item.unit_price_usd * fxRate
      default:       return item.quantity
    }
  }

  const bases      = items.map(getBasis)
  const totalBasis = bases.reduce((s, b) => s + b, 0)

  return items.map((item, i) => {
    const share       = totalBasis > 0 ? bases[i] / totalBasis : 1 / items.length
    const overhead    = totalOverhead * share
    const newCost     = Math.round(item.unit_price_usd * fxRate + overhead / item.quantity)
    const oldCost     = item.unit_landed_cost_etb ?? 0

    return {
      product_name:         item.product_name,
      old_unit_cost:        oldCost,
      new_unit_cost:        newCost,
      change_per_unit:      newCost - oldCost,
      qty_on_hand:          0,  // fetched separately in real app
      qty_already_sold:     0,
      inventory_adjustment: 0,
    }
  })
}

// Run the finalization — calls the PostgreSQL function
export async function runFinalization(
  shipmentId: string,
  fxRate:     number,
  method:     'QUANTITY' | 'WEIGHT' | 'VOLUME' | 'VALUE',
): Promise<FinalizationResult> {
  const { data, error } = await supabase.rpc('finalize_shipment_costs', {
    p_shipment_id: shipmentId,
    p_usd_to_etb:  fxRate,
    p_method:      method,
  })

  if (error) throw new Error(error.message)
  return data as FinalizationResult
}