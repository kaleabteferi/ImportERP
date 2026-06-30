// src/hooks/useShipmentCostBreakdown.ts

import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

import type {
  CostBreakdownResult,
  AllocationMethod,
} from '../types/costEngine';

interface UseShipmentCostBreakdownOptions {
  shipmentId: string;
  /** Auto-fetch on mount. Default: true */
  autoFetch?: boolean;
}

interface UseShipmentCostBreakdownReturn {
  data: CostBreakdownResult | null;
  isLoading: boolean;
  isRecalculating: boolean;
  error: string | null;
  /** Fetch current saved costs without recalculating */
  refresh: () => Promise<void>;
  /** Trigger a full recalculation via the PostgreSQL function */
  recalculate: (opts?: RecalculateOptions) => Promise<void>;
  /** Change the allocation method and immediately recalculate */
  changeAllocationMethod: (method: AllocationMethod) => Promise<void>;
  lastUpdated: Date | null;
}

interface RecalculateOptions {
  exchangeRate?: number;     // override forex rate
  silent?: boolean;          // don't set isRecalculating (for background refresh)
}

export function useShipmentCostBreakdown(
  options: UseShipmentCostBreakdownOptions,
): UseShipmentCostBreakdownReturn {
  const { shipmentId, autoFetch = true } = options;

  const [data, setData] = useState<CostBreakdownResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Prevent stale closures on rapid re-calls
  const abortRef = useRef<AbortController | null>(null);

  // ── Fetch current costs from DB (no recalculation) ───────
  const refresh = useCallback(async () => {
    if (!shipmentId) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setIsLoading(true);
    setError(null);

    try {
      const { data: items, error: itemsError } = await supabase
        .from('shipment_items')
        .select(`
          id,
          product_id,
          quantity,
          unit_price_usd,
          weight_kg_total,
          volume_m3_total,
          allocated_cost_etb,
          unit_landed_cost_etb,
          cost_status,
          cost_calculated_at,
          products (
            name,
            sku
          )
        `)
        .eq('shipment_id', shipmentId)
        .order('products(name)');

      if (itemsError) throw itemsError;

      const { data: shipment, error: shipmentError } = await supabase
        .from('shipments')
        .select('id, allocation_method')
        .eq('id', shipmentId)
        .single();

      if (shipmentError) throw shipmentError;

      const { data: expenses, error: expensesError } = await supabase
        .from('shipment_expenses')
        .select('category, amount_etb, cost_status')
        .eq('shipment_id', shipmentId);

      if (expensesError) throw expensesError;

      // Reconstruct the shape matching CostBreakdownResult
      const expenseByCategory = expenses?.reduce(
        (acc, e) => {
          const key = e.category as string;
          if (!acc[key]) {
            acc[key] = { category: e.category, total_etb: 0, count: 0, has_provisional: false };
          }
          acc[key].total_etb += e.amount_etb ?? 0;
          acc[key].count += 1;
          acc[key].has_provisional = acc[key].has_provisional || e.cost_status === 'PROVISIONAL';
          return acc;
        },
        {} as Record<string, CostBreakdownResult['expense_breakdown'][number]>,
      );

      const totalExpenses = expenses?.reduce((s, e) => s + (e.amount_etb ?? 0), 0) ?? 0;

      setData({
        shipment_id: shipmentId,
        allocation_method: shipment.allocation_method,
        exchange_rate: 0, // not stored separately; recalculate to get it
        total_expenses_etb: totalExpenses,
        total_basis: 0,
        calculated_at: new Date().toISOString(),
        items: (items ?? []).map(item => ({
          shipment_item_id: item.id,
          product_id: item.product_id,
          product_name: (item.products as any)?.name ?? '—',
          product_sku: (item.products as any)?.sku ?? '—',
          quantity: item.quantity,
          unit_price_usd: item.unit_price_usd,
          product_value_usd: item.quantity * item.unit_price_usd,
          product_value_etb: 0,
          allocation_basis: 0,
          allocation_share_pct: 0,
          allocated_cost_etb: item.allocated_cost_etb ?? 0,
          unit_landed_cost_etb: item.unit_landed_cost_etb ?? 0,
          cost_status: item.cost_status,
          is_protected: item.cost_status === 'FINAL',
        })),
        expense_breakdown: Object.values(expenseByCategory ?? {}),
      });

      setLastUpdated(new Date());
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message ?? 'Failed to load cost data.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [shipmentId]);

  // ── Trigger full recalculation via PostgreSQL function ────
  const recalculate = useCallback(
    async (opts: RecalculateOptions = {}) => {
      if (!shipmentId) return;

      if (!opts.silent) setIsRecalculating(true);
      setError(null);

      try {
        const { data: result, error: rpcError } = await supabase.rpc(
          'recalculate_shipment_costs',
          {
            p_shipment_id: shipmentId,
            p_usd_to_etb: opts.exchangeRate ?? null,
          },
        );

        if (rpcError) throw rpcError;

        // RPC returns the full payload — set directly, no second fetch needed
        setData(result as CostBreakdownResult);
        setLastUpdated(new Date());
      } catch (err: any) {
        setError(err.message ?? 'Recalculation failed.');
      } finally {
        if (!opts.silent) setIsRecalculating(false);
      }
    },
    [shipmentId],
  );

  // ── Change allocation method + recalculate ────────────────
  const changeAllocationMethod = useCallback(
    async (method: AllocationMethod) => {
      if (!shipmentId) return;

      setIsRecalculating(true);
      setError(null);

      try {
        // 1. Persist the method change first
        const { error: updateError } = await supabase
          .from('shipments')
          .update({ allocation_method: method, updated_at: new Date().toISOString() })
          .eq('id', shipmentId);

        if (updateError) throw updateError;

        // 2. Then recalculate with the new method (silent=true since we handle loading state)
        await recalculate({ silent: true });
      } catch (err: any) {
        setError(err.message ?? 'Failed to change allocation method.');
      } finally {
        setIsRecalculating(false);
      }
    },
    [shipmentId, recalculate],
  );

  // ── Auto-fetch on mount ───────────────────────────────────
  useEffect(() => {
    if (autoFetch) {
      refresh();
    }
  }, [autoFetch, refresh]);

  // ── Real-time subscription: update when expenses change ───
  useEffect(() => {
    if (!shipmentId) return;

    const channel = supabase
      .channel(`shipment-costs-${shipmentId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shipment_expenses',
          filter: `shipment_id=eq.${shipmentId}`,
        },
        () => {
          // Background recalculate when another user adds an expense
          recalculate({ silent: true });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [shipmentId, recalculate]);

  return {
    data,
    isLoading,
    isRecalculating,
    error,
    refresh,
    recalculate,
    changeAllocationMethod,
    lastUpdated,
  };
}