// src/api/customers.ts
import { supabase } from '../lib/supabase'

export async function fetchCustomers() {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, type, phone, address, is_active, outstanding_etb, discount_pct, created_at')
    .order('name')
  if (error) throw new Error(error.message)
  return data
}

export async function fetchCustomerHistory(customerId: string) {
  const [ordersRes, creditRes] = await Promise.all([
    supabase
      .from('sales_orders')
      .select('id, order_number, sale_date, total_etb, paid_amount, status')
      .eq('customer_id', customerId)
      .order('sale_date', { ascending: false }),
    supabase
      .from('credit_accounts')
      .select('id, credit_limit, balance, due_date, status')
      .eq('customer_id', customerId),
  ])
  if (ordersRes.error) throw new Error(ordersRes.error.message)
  if (creditRes.error) throw new Error(creditRes.error.message)
  return { orders: ordersRes.data ?? [], creditAccounts: creditRes.data ?? [] }
}

export async function createCustomer(input: {
  name: string
  type?: string
  phone?: string
  address?: string
}) {
  const { data, error } = await supabase
    .from('customers')
    .insert({
      name: input.name,
      type: input.type ?? null,
      phone: input.phone ?? null,
      address: input.address ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id as string
}