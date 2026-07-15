// src/api/sales.ts

import { supabase } from '../lib/supabase';

export interface SalesOrderLine {
  product_id: string;
  quantity: number;
  unit_price_etb: number;
}

export interface CreateOrderPayload {
  customer_id: string;
  warehouse_id: string;
  sale_date: string;
  payment_terms: string;
  notes?: string;
  lines: SalesOrderLine[];
}

export interface SalesOrderResult {
  order_id: string;
  order_number: string;
  invoice_number: string;
  total_etb: number;
  total_cogs_etb: number;
  gross_profit_etb: number;
  gross_margin_pct: number;
}

export async function createSalesOrder(
  payload: CreateOrderPayload,
): Promise<SalesOrderResult> {
  const { data, error } = await supabase.rpc('create_sales_order', {
    p_customer_id:   payload.customer_id,
    p_warehouse_id:  payload.warehouse_id,
    p_sale_date:     payload.sale_date,
    p_payment_terms: payload.payment_terms,
    p_notes:         payload.notes ?? null,
    p_lines:         payload.lines,
  });

  if (error) throw new Error(error.message);
  return data as SalesOrderResult;
}

export async function fetchOrdersWithMargins(limit = 50) {
  const { data, error } = await supabase
    .from('sales_orders')
    .select(`
      id, order_number, invoice_number, sale_date, status,
      total_etb, paid_amount, gross_profit_etb, gross_margin_pct,
      customers ( name, type ),
      sales_order_lines (
        product_id, quantity, unit_price_etb,
        unit_cost_etb_snapshot, gross_profit_etb, cost_source,
        products ( name, sku )
      )
    `)
    .order('sale_date', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data;
}

export async function recordPayment(
  orderId: string,
  amountEtb: number,
  method: string,
  options?: { reference?: string; sensitive?: boolean; notes?: string; accountId?: string },
) {
  const { error } = await supabase
    .from('sales_payments')
    .insert({
      sales_order_id: orderId,
      amount_etb:     amountEtb,
      method,
      reference:      options?.reference ?? null,
      sensitive_flag: options?.sensitive ?? false,
      notes:          options?.notes ?? null,
      account_id:     options?.accountId ?? null,
    });

  if (error) throw new Error(error.message);

  // Update outstanding on customer record
  await supabase.rpc('update_customer_outstanding', { p_order_id: orderId });
}