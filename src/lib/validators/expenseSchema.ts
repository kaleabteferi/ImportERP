// src/lib/validators/expenseSchema.ts

import { z } from 'zod';

export const EXPENSE_CATEGORIES = [
  { value: 'CHINA_ORIGIN',     label: 'China Origin',        icon: '🇨🇳' },
  { value: 'OCEAN_FREIGHT',    label: 'Ocean Freight',       icon: '🚢' },
  { value: 'DJIBOUTI_PORT',    label: 'Djibouti Port',       icon: '⚓' },
  { value: 'TRUCKING',         label: 'Trucking',            icon: '🚛' },
  { value: 'ETHIOPIA_CUSTOMS', label: 'Ethiopian Customs',   icon: '🛃' },
  { value: 'OTHER',            label: 'Other',               icon: '📋' },
] as const;

export const CHINA_ORIGIN_SUBCATEGORIES = [
  'Factory Loading', 'Export Documentation',
  'Inspection Fee', 'Banking Charges', 'Supplier Fee',
];

export const OCEAN_FREIGHT_SUBCATEGORIES = [
  'Ocean Freight', 'Insurance', 'Container Charges', 'BL Fee',
];

export const DJIBOUTI_PORT_SUBCATEGORIES = [
  'Warehouse Storage', 'Offloading', 'Reloading',
  'Clearing Fees', 'Documentation', 'Handling Charges',
];

export const TRUCKING_SUBCATEGORIES = [
  'Truck Fee', 'Fuel', 'Driver Costs', 'Security', 'Road Toll',
];

export const ETHIOPIA_CUSTOMS_SUBCATEGORIES = [
  'Customs Duty', 'VAT', 'Surtax', 'Withholding Tax',
  'Excise Tax', 'Clearing Agent Fee', 'Port Handling',
];

export const OTHER_SUBCATEGORIES = [
  'Demurrage', 'Penalty', 'Currency Loss', 'Bank Charge', 'Other',
];

export const SUBCATEGORIES_BY_CATEGORY: Record<string, string[]> = {
  CHINA_ORIGIN:     CHINA_ORIGIN_SUBCATEGORIES,
  OCEAN_FREIGHT:    OCEAN_FREIGHT_SUBCATEGORIES,
  DJIBOUTI_PORT:    DJIBOUTI_PORT_SUBCATEGORIES,
  TRUCKING:         TRUCKING_SUBCATEGORIES,
  ETHIOPIA_CUSTOMS: ETHIOPIA_CUSTOMS_SUBCATEGORIES,
  OTHER:            OTHER_SUBCATEGORIES,
};

export const expenseSchema = z.object({
  category: z.enum([
    'CHINA_ORIGIN', 'OCEAN_FREIGHT', 'DJIBOUTI_PORT',
    'TRUCKING', 'ETHIOPIA_CUSTOMS', 'OTHER',
  ], { required_error: 'Select a category' }),

  description: z.string()
    .min(2, 'Description is too short')
    .max(200, 'Description is too long'),

  amount: z.string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Enter a valid amount')
    .refine(v => parseFloat(v) > 0, 'Amount must be greater than 0'),

  currency: z.enum(['USD', 'ETB', 'CNY']),

  exchange_rate_override: z.string()
    .optional()
    .refine(v => !v || /^\d+(\.\d{1,6})?$/.test(v), 'Enter a valid rate'),

  vendor_name: z.string().max(100).optional(),
  expense_date: z.string().min(1, 'Date is required'),
  receipt_ref:  z.string().max(100).optional(),
  notes:        z.string().max(500).optional(),
});

export type ExpenseFormValues = z.infer<typeof expenseSchema>;
