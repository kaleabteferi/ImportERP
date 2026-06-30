// src/hooks/useShipmentExpenses.ts

import { useState, useCallback, useEffect } from 'react';
import {
  fetchShipmentExpenses,
  updateExpenseAndRecalculate,
  deleteExpenseAndRecalculate,
  type ShipmentExpense,
  type UpdateExpensePayload,
} from '../api/expenses';
import type { CostBreakdownResult } from '../types/costEngine';

interface UseShipmentExpensesReturn {
  expenses: ShipmentExpense[];
  isLoading: boolean;
  /** ID of the expense currently being mutated (for per-row spinners) */
  mutatingId: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  updateExpense: (
    payload: UpdateExpensePayload,
    onCostsUpdated: (costs: CostBreakdownResult) => void,
  ) => Promise<void>;
  deleteExpense: (
    expenseId: string,
    onCostsUpdated: (costs: CostBreakdownResult) => void,
  ) => Promise<void>;
  /** Called by AddExpenseModal to splice the new row in without a refetch */
  appendExpense: (expense: ShipmentExpense) => void;
}

export function useShipmentExpenses(
  shipmentId: string,
): UseShipmentExpensesReturn {
  const [expenses, setExpenses]   = useState<ShipmentExpense[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchShipmentExpenses(shipmentId);
      setExpenses(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => { refresh(); }, [refresh]);

  const updateExpense = useCallback(async (
    payload: UpdateExpensePayload,
    onCostsUpdated: (costs: CostBreakdownResult) => void,
  ) => {
    setMutatingId(payload.id);
    setError(null);
    try {
      const result = await updateExpenseAndRecalculate(payload);
      // Splice updated row into local state — no refetch
      setExpenses(prev =>
        prev.map(e =>
          e.id === payload.id
            ? {
                ...e,
                category:     payload.category as any,
                description:  payload.description,
                amount:       payload.amount,
                currency:     payload.currency as any,
                vendor_name:  payload.vendor_name ?? null,
                expense_date: payload.expense_date,
                receipt_ref:  payload.receipt_ref  ?? null,
                notes:        payload.notes        ?? null,
                updated_at:   new Date().toISOString(),
              }
            : e,
        ),
      );
      onCostsUpdated(result.updated_costs);
    } catch (e: any) {
      setError(e.message);
      throw e; // re-throw so the edit form can show the error
    } finally {
      setMutatingId(null);
    }
  }, []);

  const deleteExpense = useCallback(async (
    expenseId: string,
    onCostsUpdated: (costs: CostBreakdownResult) => void,
  ) => {
    // Optimistic: remove from list immediately for snappy UX
    setExpenses(prev => prev.filter(e => e.id !== expenseId));
    setMutatingId(expenseId);
    setError(null);
    try {
      const result = await deleteExpenseAndRecalculate(expenseId);
      onCostsUpdated(result.updated_costs);
    } catch (e: any) {
      // Rollback optimistic removal on failure
      setError(e.message);
      await refresh();
      throw e;
    } finally {
      setMutatingId(null);
    }
  }, [refresh]);

  const appendExpense = useCallback((expense: ShipmentExpense) => {
    setExpenses(prev => [...prev, expense]);
  }, []);

  return {
    expenses,
    isLoading,
    mutatingId,
    error,
    refresh,
    updateExpense,
    deleteExpense,
    appendExpense,
  };
}