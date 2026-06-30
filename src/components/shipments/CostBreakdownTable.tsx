// src/components/shipments/CostBreakdownTable.tsx

import { useState } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle, Lock, ChevronDown } from 'lucide-react';
import { useShipmentCostBreakdown } from '../../hooks/useShipmentCostBreakdown';
import type { AllocationMethod, ExpenseCategory } from '../../types/costEngine';

const ALLOCATION_METHODS: { value: AllocationMethod; label: string }[] = [
  { value: 'QUANTITY', label: 'By Quantity (Units)' },
  { value: 'WEIGHT',   label: 'By Weight (KG)' },
  { value: 'VOLUME',   label: 'By Volume (M³)' },
  { value: 'VALUE',    label: 'By Product Value (USD)' },
];

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  CHINA_ORIGIN:     'China Origin',
  OCEAN_FREIGHT:    'Ocean Freight',
  DJIBOUTI_PORT:    'Djibouti Port',
  TRUCKING:         'Trucking',
  ETHIOPIA_CUSTOMS: 'Ethiopian Customs',
  OTHER:            'Other',
};

const ETB = (n: number) =>
  new Intl.NumberFormat('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const USD = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

interface Props {
  shipmentId: string;
  shipmentNumber: string;
}

export function CostBreakdownTable({ shipmentId, shipmentNumber }: Props) {
  const [exchangeRateInput, setExchangeRateInput] = useState('');

  const {
    data,
    isLoading,
    isRecalculating,
    error,
    recalculate,
    changeAllocationMethod,
    lastUpdated,
  } = useShipmentCostBreakdown({ shipmentId });

  const handleRecalculate = () => {
    const rate = parseFloat(exchangeRateInput);
    recalculate({ exchangeRate: isNaN(rate) ? undefined : rate });
  };

  const isBusy = isLoading || isRecalculating;

  return (
    <div className="space-y-6">

      {/* ── Header Bar ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            Landed Cost Breakdown
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Shipment {shipmentNumber}
            {lastUpdated && (
              <span className="ml-2 text-gray-400">
                · Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Exchange Rate Override */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 whitespace-nowrap">USD → ETB</label>
            <input
              type="number"
              step="0.01"
              min="1"
              value={exchangeRateInput}
              onChange={e => setExchangeRateInput(e.target.value)}
              placeholder={data ? String(data.exchange_rate) : 'Auto'}
              className="w-28 px-3 py-1.5 text-sm border border-gray-300 rounded-lg
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Allocation Method Picker */}
          {data && (
            <div className="relative">
              <select
                value={data.allocation_method}
                onChange={e => changeAllocationMethod(e.target.value as AllocationMethod)}
                disabled={isBusy}
                className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-gray-300
                           rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500
                           disabled:opacity-50 cursor-pointer"
              >
                {ALLOCATION_METHODS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          )}

          {/* Recalculate Button */}
          <button
            onClick={handleRecalculate}
            disabled={isBusy}
            className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium
                       bg-blue-600 text-white rounded-lg hover:bg-blue-700
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isRecalculating ? 'animate-spin' : ''}`} />
            {isRecalculating ? 'Calculating…' : 'Recalculate'}
          </button>
        </div>
      </div>

      {/* ── Error Banner ────────────────────────────────────── */}
      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">Calculation Error</p>
            <p className="text-sm text-red-600 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* ── Expense Summary Cards ───────────────────────────── */}
      {data && data.expense_breakdown.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {data.expense_breakdown.map(cat => (
            <div
              key={cat.category}
              className="bg-white border border-gray-200 rounded-lg p-3 space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 font-medium">
                  {CATEGORY_LABELS[cat.category]}
                </span>
                {cat.has_provisional && (
                  <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                    Est.
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-gray-900">
                {ETB(cat.total_etb)} <span className="text-xs font-normal text-gray-400">ETB</span>
              </p>
              <p className="text-xs text-gray-400">{cat.count} expense{cat.count !== 1 ? 's' : ''}</p>
            </div>
          ))}

          {/* Total card */}
          <div className="bg-blue-600 rounded-lg p-3 space-y-1">
            <span className="text-xs text-blue-200 font-medium">Total Landed Cost</span>
            <p className="text-sm font-bold text-white">
              {ETB(data.total_expenses_etb)}
            </p>
            <p className="text-xs text-blue-200">ETB</p>
          </div>
        </div>
      )}

      {/* ── Main Cost Breakdown Table ───────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-48">Product</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Qty</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Unit Price</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Product Value</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Share %</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Allocated Cost</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 bg-blue-50">
                  Unit Landed Cost
                </th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100">
              {isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading cost data…
                  </td>
                </tr>
              )}

              {!isLoading && (!data || data.items.length === 0) && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400">
                    No items found for this shipment.
                  </td>
                </tr>
              )}

              {data?.items.map(item => (
                <tr
                  key={item.shipment_item_id}
                  className={`
                    transition-colors
                    ${isRecalculating ? 'opacity-50' : 'opacity-100'}
                    ${item.is_protected ? 'bg-gray-50' : 'hover:bg-blue-50/30'}
                  `}
                >
                  {/* Product */}
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 truncate max-w-[180px]">
                      {item.product_name}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{item.product_sku}</div>
                  </td>

                  {/* Quantity */}
                  <td className="px-4 py-3 text-right text-gray-700 tabular-nums">
                    {item.quantity.toLocaleString()}
                  </td>

                  {/* Unit Price USD */}
                  <td className="px-4 py-3 text-right text-gray-700 tabular-nums">
                    {USD(item.unit_price_usd)}
                  </td>

                  {/* Total Product Value ETB */}
                  <td className="px-4 py-3 text-right text-gray-700 tabular-nums">
                    {item.product_value_etb > 0
                      ? <>{ETB(item.product_value_etb)} <span className="text-xs text-gray-400">ETB</span></>
                      : <span className="text-gray-300">—</span>
                    }
                  </td>

                  {/* Allocation Share */}
                  <td className="px-4 py-3 text-right tabular-nums">
                    <div className="inline-flex items-center gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(item.allocation_share_pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-gray-700 text-xs w-10 text-right">
                        {item.allocation_share_pct}%
                      </span>
                    </div>
                  </td>

                  {/* Allocated Cost */}
                  <td className="px-4 py-3 text-right text-gray-700 tabular-nums">
                    {ETB(item.allocated_cost_etb)}{' '}
                    <span className="text-xs text-gray-400">ETB</span>
                  </td>

                  {/* Unit Landed Cost — highlighted */}
                  <td className="px-4 py-3 text-right bg-blue-50/60 tabular-nums">
                    <span className="font-semibold text-blue-700">
                      {ETB(item.unit_landed_cost_etb)}
                    </span>
                    <span className="text-xs text-blue-400 ml-1">ETB</span>
                  </td>

                  {/* Status Badge */}
                  <td className="px-4 py-3 text-center">
                    {item.is_protected ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full
                                       text-xs font-medium bg-gray-100 text-gray-600">
                        <Lock className="w-3 h-3" /> Final
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full
                                       text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                        <AlertTriangle className="w-3 h-3" /> Provisional
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>

            {/* Summary Footer */}
            {data && data.items.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200 font-medium">
                  <td className="px-4 py-3 text-gray-700">
                    {data.items.length} products
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 tabular-nums">
                    {data.items.reduce((s, i) => s + i.quantity, 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right text-gray-700 tabular-nums">
                    {ETB(data.items.reduce((s, i) => s + i.product_value_etb, 0))}{' '}
                    <span className="text-xs font-normal text-gray-400">ETB</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">100%</td>
                  <td className="px-4 py-3 text-right text-gray-700 tabular-nums">
                    {ETB(data.total_expenses_etb)}{' '}
                    <span className="text-xs font-normal text-gray-400">ETB</span>
                  </td>
                  <td className="px-4 py-3 bg-blue-50/60" />
                  <td className="px-4 py-3 text-center">
                    {data.items.every(i => i.is_protected) ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700">
                        <CheckCircle className="w-3.5 h-3.5" /> All Final
                      </span>
                    ) : (
                      <span className="text-xs text-amber-600">
                        {data.items.filter(i => !i.is_protected).length} provisional
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Rate display footer */}
        {data && (
          <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center gap-4
                          text-xs text-gray-500">
            <span>Rate: <strong className="text-gray-700">1 USD = {data.exchange_rate} ETB</strong></span>
            <span>·</span>
            <span>Method: <strong className="text-gray-700">{data.allocation_method}</strong></span>
            <span>·</span>
            <span>Calculated: <strong className="text-gray-700">
              {new Date(data.calculated_at).toLocaleString()}
            </strong></span>
          </div>
        )}
      </div>
    </div>
  );
}
