// src/api/income.ts — lets Money Tracking register income directly,
// without going through the full multi-line sales order flow.
import { supabase } from '../lib/supabase'

export async function recordQuickIncome(input: {
  customerId: string
  warehouseId: string
  amount: number
  method: 'cash' | 'bank_transfer' | 'credit' | 'mobile_money'
  creditAccountId?: string   // required when method === 'credit'
  reference?: string
  sensitive?: boolean
  notes?: string
  date: string
}) {
  const isCredit = input.method === 'credit'
  const orderNumber = `MISC-${Date.now()}`

  const { data: order, error: orderError } = await supabase
    .from('sales_orders')
    .insert({
      order_number: orderNumber,
      customer_id: input.customerId,
      warehouse_id: input.warehouseId,
      sale_date: input.date,
      total_etb: input.amount,
      status: isCredit ? 'INVOICED' : 'PAID',
      notes: input.notes ?? null,
    })
    .select('id')
    .single()

  if (orderError) throw new Error(orderError.message)

  if (isCredit) {
    if (!input.creditAccountId) throw new Error('Select which credit account this draws against.')
    const { error } = await supabase.from('credit_transactions').insert({
      credit_account_id: input.creditAccountId,
      type: 'draw',
      amount: input.amount,
      method: 'credit',
      sales_order_id: order.id,
      sensitive_flag: input.sensitive ?? false,
      notes: input.notes ?? null,
    })
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase.from('sales_payments').insert({
      sales_order_id: order.id,
      amount_etb: input.amount,
      method: input.method,
      reference: input.reference ?? null,
      sensitive_flag: input.sensitive ?? false,
      notes: input.notes ?? null,
    })
    if (error) throw new Error(error.message)
    await supabase.rpc('update_customer_outstanding', { p_order_id: order.id })
  }
}

export async function fetchWarehousesList() {
  const { data, error } = await supabase.from('warehouses').select('id, name').order('name')
  if (error) throw new Error(error.message)
  return data
}