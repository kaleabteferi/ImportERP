// src/hooks/useSalesOrder.ts

import { useState, useCallback } from 'react';
import { createSalesOrder, type CreateOrderPayload, type SalesOrderResult } from '../api/sales';

interface LineItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_etb: number;
  unit_cost_etb: number;     // from inventory (landed cost)
  cost_source: 'PROVISIONAL' | 'FINAL';
  stock_available: number;
}

interface OrderTotals {
  subtotal_etb: number;
  discount_etb: number;
  total_etb: number;
  total_cogs_etb: number;
  gross_profit_etb: number;
  gross_margin_pct: number;
}

export function useSalesOrder() {
  const [lines, setLines]         = useState<LineItem[]>([]);
  const [isSubmitting, setSubmitting] = useState(false);
  const [result, setResult]       = useState<SalesOrderResult | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const addLine = useCallback((line: Omit<LineItem, 'id'>) => {
    setLines(prev => [...prev, { ...line, id: crypto.randomUUID() }]);
  }, []);

  const updateLine = useCallback((id: string, updates: Partial<LineItem>) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  }, []);

  const removeLine = useCallback((id: string) => {
    setLines(prev => prev.filter(l => l.id !== id));
  }, []);

  // Recalculate totals whenever lines change — pure derivation, no DB call
  const totals: OrderTotals = lines.reduce((acc, line) => {
    const lineTotal = line.quantity * line.unit_price_etb;
    const lineCost  = line.quantity * line.unit_cost_etb;
    acc.subtotal_etb   += lineTotal;
    acc.total_cogs_etb += lineCost;
    return acc;
  }, { subtotal_etb: 0, discount_etb: 0, total_etb: 0, total_cogs_etb: 0, gross_profit_etb: 0, gross_margin_pct: 0 });

  totals.total_etb        = totals.subtotal_etb - totals.discount_etb;
  totals.gross_profit_etb = totals.total_etb - totals.total_cogs_etb;
  totals.gross_margin_pct = totals.total_etb > 0
    ? (totals.gross_profit_etb / totals.total_etb) * 100
    : 0;

  const submitOrder = useCallback(async (payload: Omit<CreateOrderPayload, 'lines'>) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await createSalesOrder({
        ...payload,
        lines: lines.map(l => ({
          product_id:     l.product_id,
          quantity:       l.quantity,
          unit_price_etb: l.unit_price_etb,
        })),
      });
      setResult(res);
      return res;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setSubmitting(false);
    }
  }, [lines]);

  return { lines, totals, addLine, updateLine, removeLine, submitOrder, isSubmitting, result, error };
}