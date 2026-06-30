// src/types/costEngine.ts

export type AllocationMethod = 'QUANTITY' | 'WEIGHT' | 'VOLUME' | 'VALUE';
export type CostStatus = 'PROVISIONAL' | 'FINAL';
export type ExpenseCategory =
  | 'CHINA_ORIGIN'
  | 'OCEAN_FREIGHT'
  | 'DJIBOUTI_PORT'
  | 'TRUCKING'
  | 'ETHIOPIA_CUSTOMS'
  | 'OTHER';

export interface CostBreakdownItem {
  shipment_item_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity: number;
  unit_price_usd: number;
  product_value_usd: number;
  product_value_etb: number;
  allocation_basis: number;
  allocation_share_pct: number;
  allocated_cost_etb: number;
  unit_landed_cost_etb: number;
  cost_status: CostStatus;
  is_protected: boolean; // true = FINAL, immutable
}

export interface ExpenseCategorySummary {
  category: ExpenseCategory;
  total_etb: number;
  count: number;
  has_provisional: boolean;
}

export interface CostBreakdownResult {
  shipment_id: string;
  allocation_method: AllocationMethod;
  exchange_rate: number;
  total_expenses_etb: number;
  total_basis: number;
  calculated_at: string;
  items: CostBreakdownItem[];
  expense_breakdown: ExpenseCategorySummary[];
}