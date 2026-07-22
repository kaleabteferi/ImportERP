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

export interface SalesOrderForEdit {
  id: string; customer_id: string; warehouse_id: string; sale_date: string
  lines: SalesOrderLine[]
}

export async function fetchSalesOrderForEdit(orderId: string): Promise<SalesOrderForEdit> {
  const { data, error } = await supabase
    .from('sales_orders')
    .select('id, customer_id, warehouse_id, sale_date, sales_order_lines(product_id, quantity, unit_price_etb)')
    .eq('id', orderId)
    .single();
  if (error) throw new Error(error.message);
  return {
    id: data.id, customer_id: data.customer_id, warehouse_id: data.warehouse_id, sale_date: data.sale_date,
    lines: ((data as any).sales_order_lines ?? []).map((l: any) => ({
      product_id: l.product_id, quantity: Number(l.quantity), unit_price_etb: Number(l.unit_price_etb),
    })),
  };
}

// Only safe to call on an order with nothing riding on it yet — no cash
// payment and no credit draw. Both update this order's paid_amount /
// the customer's credit exposure independently of sales_orders itself, so
// deleting the order out from under either would leave stale money owed
// pointing at a row that no longer exists. Restores the stock the sale
// took out via an ADJUSTMENT ledger entry per line (same convention
// damage reports and stock corrections already use), then removes the
// order.
export async function deleteSalesOrder(orderId: string): Promise<void> {
  const { data: order, error: orderErr } = await supabase
    .from('sales_orders')
    .select('id, order_number, warehouse_id, paid_amount, sales_order_lines(product_id, quantity)')
    .eq('id', orderId)
    .single();
  if (orderErr) throw new Error(orderErr.message);
  if (Number(order.paid_amount ?? 0) > 0) {
    throw new Error('This order already has a payment recorded — delete the payment in Receivables first, or void it there instead.');
  }

  const { count, error: creditErr } = await supabase
    .from('credit_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('sales_order_id', orderId);
  if (creditErr) throw new Error(creditErr.message);
  if ((count ?? 0) > 0) {
    throw new Error('This order was funded by a credit draw — settle it in Credit Accounts before deleting.');
  }

  const lines = ((order as any).sales_order_lines ?? []) as { product_id: string; quantity: number }[];
  for (const line of lines) {
    const { error: ledgerErr } = await supabase.from('inventory_ledger').insert({
      product_id: line.product_id,
      quantity: Math.abs(Number(line.quantity)),
      movement_type: 'ADJUSTMENT',
      movement_date: new Date().toISOString().split('T')[0],
      warehouse_id: order.warehouse_id,
      notes: `Sale ${order.order_number} deleted — stock restored`,
    });
    if (ledgerErr) throw new Error(ledgerErr.message);
  }

  const { error: linesErr } = await supabase.from('sales_order_lines').delete().eq('sales_order_id', orderId);
  if (linesErr) throw new Error(linesErr.message);
  const { error: deleteErr } = await supabase.from('sales_orders').delete().eq('id', orderId);
  if (deleteErr) throw new Error(deleteErr.message);
}

export async function recordPayment(
  orderId: string,
  amountEtb: number,
  method: string,
  options?: { reference?: string; sensitive?: boolean; notes?: string; accountId?: string; hawalaRoute?: string },
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
      hawala_route:   method === 'hawala' ? (options?.hawalaRoute ?? null) : null,
    });

  if (error) throw new Error(error.message);

  // Update outstanding on customer record — the payment row above is already
  // committed at this point, so a failure here must surface loudly rather
  // than leave customers.outstanding_etb silently stale (it feeds the
  // Dashboard, Reports, and the "already owes" banner on this page).
  const { error: outstandingError } = await supabase.rpc('update_customer_outstanding', { p_order_id: orderId });
  if (outstandingError) throw new Error(outstandingError.message);
}