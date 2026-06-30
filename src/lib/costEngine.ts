// src/lib/costEngine.ts  (updated)

import type { AllocationMethod } from '../types/costEngine';

export interface PLItem {
  id: string;
  pi_item_id: string;
  item_description: string;
  hs_code: string;
  carton_qty: number;
  units_per_carton: number;
  total_units: number;           // carton_qty × units_per_carton
  unit_price_foreign: number;    // from PI
  total_gross_kg: number | null;
  total_volume_m3: number | null;
  cost_status: 'PROVISIONAL' | 'FINAL';
}

export interface ContainerExpenses {
  container_id: string;
  expenses: Array<{
    id: string;
    category: string;
    amount_etb: number;
    cost_status: 'PROVISIONAL' | 'FINAL';
  }>;
}

export interface AllocatedPLItem extends PLItem {
  // Product cost (ex-factory value in ETB)
  product_cost_etb: number;          // unit_price_foreign × rate × units
  unit_product_cost_etb: number;     // per unit

  // Allocated overhead (freight, customs, port, etc.)
  allocated_overhead_etb: number;    // total overhead share for this line
  unit_overhead_etb: number;         // per unit

  // Final landed costs
  unit_landed_cost_etb: number;      // unit_product_cost + unit_overhead
  batch_landed_cost_etb: number;     // × total_units
  allocation_share_pct: number;

  // Carton-level pricing
  batch_price_foreign: number;       // carton_qty × units_per_carton × unit_price_foreign
  unit_price_etb: number;            // product cost only (no overhead) per unit
}

export interface LandedCostResult {
  method: AllocationMethod;
  exchange_rate: number;
  total_product_value_usd: number;
  total_product_value_etb: number;
  total_overhead_etb: number;
  total_landed_cost_etb: number;
  items: AllocatedPLItem[];
  calculated_at: string;
}

export function calculateLandedCosts(
  plItems: PLItem[],
  expenses: ContainerExpenses[],
  method: AllocationMethod,
  usdToEtb: number,
): LandedCostResult {
  if (plItems.length === 0) throw new Error('No packing list items provided.');
  if (usdToEtb <= 0) throw new Error('Exchange rate must be positive.');

  // 1. Total overhead across all containers
  const totalOverheadEtb = expenses
    .flatMap(c => c.expenses)
    .reduce((sum, e) => sum + e.amount_etb, 0);

  // 2. Total product value (for VALUE method + reporting)
  const totalProductValueUsd = plItems.reduce(
    (sum, i) => sum + i.unit_price_foreign * i.total_units, 0,
  );

  // 3. Allocation basis per line
  const bases = plItems.map(item => getAllocationBasis(item, method, usdToEtb));
  const totalBasis = bases.reduce((s, b) => s + b, 0);

  if (totalBasis === 0) throw new Error(`All items have zero basis for method ${method}.`);

  // 4. Allocate overhead + calculate per-unit costs
  const rawAllocations = plItems.map((item, i) => {
    const share = bases[i] / totalBasis;
    const allocatedOverhead = totalOverheadEtb * share;
    const productCostEtb = item.unit_price_foreign * usdToEtb * item.total_units;
    const unitProductCost = productCostEtb / item.total_units;
    const unitOverhead = allocatedOverhead / item.total_units;
    const unitLanded = unitProductCost + unitOverhead;

    return {
      ...item,
      product_cost_etb:          round4(productCostEtb),
      unit_product_cost_etb:     round4(unitProductCost),
      unit_price_etb:            round4(unitProductCost),      // alias for clarity
      allocated_overhead_etb:    round4(allocatedOverhead),
      unit_overhead_etb:         round4(unitOverhead),
      unit_landed_cost_etb:      round4(unitLanded),
      batch_landed_cost_etb:     round4(unitLanded * item.total_units),
      batch_price_foreign:       round4(item.unit_price_foreign * item.total_units),
      allocation_share_pct:      round4(share * 100),
    };
  });

  // 5. Apply largest-remainder rounding to overhead allocation
  const adjusted = applyLargestRemainder(rawAllocations, totalOverheadEtb);

  return {
    method,
    exchange_rate:             usdToEtb,
    total_product_value_usd:   round4(totalProductValueUsd),
    total_product_value_etb:   round4(totalProductValueUsd * usdToEtb),
    total_overhead_etb:        round4(totalOverheadEtb),
    total_landed_cost_etb:     round4(totalProductValueUsd * usdToEtb + totalOverheadEtb),
    items:                     adjusted,
    calculated_at:             new Date().toISOString(),
  };
}

function getAllocationBasis(
  item: PLItem,
  method: AllocationMethod,
  usdToEtb: number,
): number {
  switch (method) {
    case 'QUANTITY': return item.total_units;
    case 'WEIGHT':
      if (!item.total_gross_kg) throw new Error(`${item.item_description} has no weight.`);
      return item.total_gross_kg;
    case 'VOLUME':
      if (!item.total_volume_m3) throw new Error(`${item.item_description} has no volume.`);
      return item.total_volume_m3;
    case 'VALUE':
      return item.unit_price_foreign * item.total_units * usdToEtb;
    default:
      return item.total_units;
  }
}

function applyLargestRemainder<T extends { allocated_overhead_etb: number }>(
  items: T[], total: number,
): T[] {
  const factor = 10000;
  const floored = items.map(i => ({
    ...i,
    allocated_overhead_etb: Math.floor(i.allocated_overhead_etb * factor) / factor,
    _rem: (i.allocated_overhead_etb * factor) % 1,
  }));

  const diff = Math.round(
    (total - floored.reduce((s, i) => s + i.allocated_overhead_etb, 0)) * factor,
  );

  const sorted = [...floored].map((i, idx) => ({ idx, rem: i._rem }))
    .sort((a, b) => b.rem - a.rem);

  for (let n = 0; n < diff; n++) {
    floored[sorted[n % sorted.length].idx].allocated_overhead_etb += 1 / factor;
  }

  return floored.map(({ _rem, ...i }) => i as unknown as T);
}

function round4(n: number) { return Math.round(n * 10000) / 10000; }