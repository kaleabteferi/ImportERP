// src/api/purchases.ts
import { supabase } from '../lib/supabase';

export async function recordPurchasePayment(
  purchaseOrderId: string,
  amount: number,
  currency: 'USD' | 'ETB',
  method: string,
  options?: { reference?: string; sensitive?: boolean; notes?: string; accountId?: string },
) {
  const { error } = await supabase
    .from('purchase_order_payments')
    .insert({
      purchase_order_id: purchaseOrderId,
      amount,
      currency,
      method,
      reference:      options?.reference ?? null,
      sensitive_flag: options?.sensitive ?? false,
      notes:          options?.notes ?? null,
      account_id:     options?.accountId ?? null,
    });

  if (error) throw new Error(error.message);
  // paid_amount on purchase_orders updates automatically via
  // trg_sync_po_paid_amount (see 20260710_verified_fixes.sql).
}