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