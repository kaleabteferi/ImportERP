// src/hooks/useDemurrage.ts

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface DemurrageData {
  dem_days: number;
  det_days: number;
  stor_days: number;
  dem_usd: number;
  det_usd: number;
  stor_etb: number;
  total_usd: number;
  total_etb: number;
  fx_rate: number;
}

export function useDemurrage(containerId: string) {
  const [data, setData]       = useState<DemurrageData | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const calculate = useCallback(async () => {
    setLoading(true);
    try {
      const { data: result, error: err } = await supabase
        .rpc('calculate_demurrage', { p_container_id: containerId });
      if (err) throw err;
      setData(result as DemurrageData);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [containerId]);

  // Recalculate every 60 seconds so the live cost is always current
  useEffect(() => {
    calculate();
    const interval = setInterval(calculate, 60_000);
    return () => clearInterval(interval);
  }, [calculate]);

  // Update a key date (e.g. when container leaves port)
  const updateDate = useCallback(async (
    field: 'arrived_djibouti' | 'left_djibouti' | 'arrived_addis' | 'empty_returned',
    date: Date,
  ) => {
    await supabase
      .from('demurrage_events')
      .update({ [field]: date.toISOString(), updated_at: new Date().toISOString() })
      .eq('container_id', containerId);
    await calculate(); // recalculate immediately after date update
  }, [containerId, calculate]);

  return { data, isLoading, error, calculate, updateDate };
}