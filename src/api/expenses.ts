// src/api/expenses.ts

import { supabase } from '../lib/supabase';
import type { ExpenseCategory, CostBreakdownResult } from '../types/costEngine';

export type CurrencyCode = 'USD' | 'ETB' | 'CNY';

export interface NewExpensePayload {
  shipment_id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  currency: CurrencyCode;
  vendor_name?: string;
  expense_date: string;       // ISO date string 'YYYY-MM-DD'
  receipt_ref?: string;
  notes?: string;
  exchange_rate_override?: number; // optional: force a specific USD→ETB rate
}

export interface AddExpenseResult {
  expense_id: string;
  updated_costs: CostBreakdownResult;
}

/**
 * Inserts a new expense and immediately triggers cost recalculation.
 * Uses a PostgreSQL function so both operations are atomic.
 */
export async function addExpenseAndRecalculate(
  payload: NewExpensePayload,
): Promise<AddExpenseResult> {
  const { data, error } = await supabase.rpc('add_expense_and_recalculate', {
    p_shipment_id:    payload.shipment_id,
    p_category:       payload.category,
    p_description:    payload.description,
    p_amount:         payload.amount,
    p_currency:       payload.currency,
    p_vendor_name:    payload.vendor_name    ?? null,
    p_expense_date:   payload.expense_date,
    p_receipt_ref:    payload.receipt_ref    ?? null,
    p_notes:          payload.notes          ?? null,
    p_usd_to_etb:     payload.exchange_rate_override ?? null,
  });

  if (error) throw new Error(error.message);
  return data as AddExpenseResult;
}

// src/api/expenses.ts  (additions to the existing file)

export interface ShipmentExpense {
  id: string;
  shipment_id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  currency: CurrencyCode;
  exchange_rate: number | null;
  amount_etb: number;
  cost_status: 'PROVISIONAL' | 'FINAL';
  vendor_name: string | null;
  expense_date: string;
  receipt_ref: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Fetch all expenses for a shipment — used to hydrate the panel on mount */
export async function fetchShipmentExpenses(
  shipmentId: string,
): Promise<ShipmentExpense[]> {
  const { data, error } = await supabase
    .from('shipment_expenses')
    .select('*')
    .eq('shipment_id', shipmentId)
    .order('expense_date', { ascending: true })
    .order('created_at',   { ascending: true });

  if (error) throw new Error(error.message);
  return data as ShipmentExpense[];
}

export interface MutateExpenseResult {
  expense_id: string;
  updated_costs: CostBreakdownResult;
}

export interface UpdateExpensePayload extends Omit<NewExpensePayload, 'shipment_id'> {
  id: string;
}

export async function updateExpenseAndRecalculate(
  payload: UpdateExpensePayload,
): Promise<MutateExpenseResult> {
  const { data, error } = await supabase.rpc('update_expense_and_recalculate', {
    p_expense_id:   payload.id,
    p_category:     payload.category,
    p_description:  payload.description,
    p_amount:       payload.amount,
    p_currency:     payload.currency,
    p_vendor_name:  payload.vendor_name   ?? null,
    p_expense_date: payload.expense_date,
    p_receipt_ref:  payload.receipt_ref   ?? null,
    p_notes:        payload.notes         ?? null,
    p_usd_to_etb:   payload.exchange_rate_override
      ? parseFloat(String(payload.exchange_rate_override))
      : null,
  });

  if (error) throw new Error(error.message);
  return data as MutateExpenseResult;
}

export async function deleteExpenseAndRecalculate(
  expenseId: string,
): Promise<MutateExpenseResult & { deleted_expense_id: string }> {
  const { data, error } = await supabase.rpc('delete_expense_and_recalculate', {
    p_expense_id: expenseId,
  });

  if (error) throw new Error(error.message);
  return data;
}