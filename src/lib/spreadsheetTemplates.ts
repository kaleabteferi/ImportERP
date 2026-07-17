import type { CellMap } from './spreadsheet'

export interface SheetTemplate {
  id: string
  label: string
  description: string
  cells: CellMap
}

export const SHEET_TEMPLATES: SheetTemplate[] = [
  {
    id: 'landed-cost',
    label: 'Landed cost',
    description: 'FOB price through customs to a per-unit landed cost in ETB',
    cells: {
      A1: 'Landed Cost Calculator', A2: 'FOB price (USD)', A3: 'Freight (USD)', A4: 'Insurance (USD)',
      A5: 'CIF (USD)', A6: 'Exchange rate (ETB/USD)', A7: 'CIF (ETB)', A8: 'Customs duty %',
      A9: 'Duty (ETB)', A10: 'VAT %', A11: 'VAT (ETB)', A12: 'Other clearing fees (ETB)',
      A13: 'Total landed cost (ETB)', A14: 'Quantity (units)', A15: 'Landed cost per unit (ETB)',
      B2: '1000', B3: '200', B4: '20', B5: '=SUM(B2:B4)', B6: '131',
      B7: '=B5*B6', B8: '15', B9: '=B7*B8/100', B10: '15', B11: '=(B7+B9)*B10/100',
      B12: '5000', B13: '=B7+B9+B11+B12', B14: '100', B15: '=ROUND(B13/B14,2)',
    },
  },
  {
    id: 'margin-pricing',
    label: 'Margin & pricing',
    description: 'Cost + target margin -> selling price, profit, and totals',
    cells: {
      A1: 'Margin & Pricing Calculator', A2: 'Unit cost (ETB)', A3: 'Target margin %',
      A4: 'Selling price (ETB)', A5: 'Profit per unit (ETB)', A6: 'Units sold',
      A7: 'Total revenue (ETB)', A8: 'Total profit (ETB)',
      B2: '500', B3: '30', B4: '=ROUND(B2/(1-B3/100),2)', B5: '=B4-B2',
      B6: '50', B7: '=B4*B6', B8: '=B5*B6',
    },
  },
  {
    id: 'currency-conversion',
    label: 'Currency conversion',
    description: 'Convert USD/CNY amounts to ETB at your own rates and total them',
    cells: {
      A1: 'Currency Conversion', A2: 'USD amount', A3: 'USD -> ETB rate', A4: 'ETB from USD',
      A5: 'CNY amount', A6: 'CNY -> ETB rate', A7: 'ETB from CNY', A8: 'Total ETB',
      B2: '1000', B3: '131', B4: '=B2*B3', B5: '5000', B6: '18', B7: '=B5*B6', B8: '=B4+B7',
    },
  },
]
