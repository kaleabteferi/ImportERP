// src/api/credit.ts
import { supabase } from '../lib/supabase';

export async function openCreditAccount(
  customerId: string,
  creditLimit: number,
  dueDate: string,
  notes?: string,
) {
  const { data, error } = await supabase
    .from('credit_accounts')
    .insert({
      customer_id:  customerId,
      credit_limit: creditLimit,
      due_date:     dueDate,
      notes:        notes ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function recordCreditTransaction(
  creditAccountId: string,
  type: 'draw' | 'repayment',
  amount: number,
  options?: { method?: string; salesOrderId?: string; sensitive?: boolean; notes?: string; accountId?: string },
) {
  const { error } = await supabase
    .from('credit_transactions')
    .insert({
      credit_account_id: creditAccountId,
      type,
      amount,
      method:          options?.method ?? null,
      sales_order_id:  options?.salesOrderId ?? null,
      sensitive_flag:  options?.sensitive ?? false,
      notes:           options?.notes ?? null,
      account_id:      options?.accountId ?? null,
    });

  if (error) throw new Error(error.message);
  // credit_accounts.balance and .status update automatically via
  // trg_sync_credit_balance (see 20260710_verified_fixes.sql).
}

export async function fetchCreditAccounts() {
  const { data, error } = await supabase
    .from('credit_accounts')
    .select('id, credit_limit, balance, due_date, status, notes, customers(id, name)')
    .order('due_date', { ascending: true });

  if (error) throw new Error(error.message);
  return data;
}

export async function fetchCustomersForCredit() {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name')
    .order('name');

  if (error) throw new Error(error.message);
  return data;
}

export interface OutstandingCreditOrder { id: string; orderNumber: string; totalEtb: number; paidAmount: number }

// Orders that were funded by a draw on this credit account and still have
// a balance owed — so a repayment can be linked to one via sales_order_id,
// which keeps the order's own paid_amount/status in sync (see the
// credit_repayment_syncs_order migration). A repayment left unlinked still
// behaves exactly as before: it only reduces the account's revolving
// balance, not any specific order.
export async function fetchOutstandingCreditOrders(creditAccountId: string): Promise<OutstandingCreditOrder[]> {
  const { data: draws, error: drawsError } = await supabase
    .from('credit_transactions')
    .select('sales_order_id')
    .eq('credit_account_id', creditAccountId)
    .eq('type', 'draw')
    .not('sales_order_id', 'is', null);
  if (drawsError) throw new Error(drawsError.message);

  const orderIds = [...new Set((draws ?? []).map((d: any) => d.sales_order_id))];
  if (orderIds.length === 0) return [];

  const { data: orders, error: ordersError } = await supabase
    .from('sales_orders')
    .select('id, order_number, total_etb, paid_amount, status')
    .in('id', orderIds)
    .in('status', ['INVOICED', 'PARTIAL']);
  if (ordersError) throw new Error(ordersError.message);

  return (orders ?? []).map((o: any) => ({
    id: o.id, orderNumber: o.order_number, totalEtb: Number(o.total_etb ?? 0), paidAmount: Number(o.paid_amount ?? 0),
  }));
}