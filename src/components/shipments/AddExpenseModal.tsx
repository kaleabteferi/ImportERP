// src/components/shipments/AddExpenseModal.tsx

import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Loader2, CheckCircle, ChevronDown, AlertCircle } from 'lucide-react';
import { addExpenseAndRecalculate } from '../../api/expenses';
import {
  expenseSchema,
  EXPENSE_CATEGORIES,
  SUBCATEGORIES_BY_CATEGORY,
  type ExpenseFormValues,
} from '../../lib/validators/expenseSchema';
import type { CostBreakdownResult, ExpenseCategory } from '../../types/costEngine';

// ── Types ─────────────────────────────────────────────────────

interface AddExpenseModalProps {
  isOpen: boolean;
  shipmentId: string;
  shipmentNumber: string;
  onClose: () => void;
  /** Called with the fresh cost breakdown after a successful save */
  onExpenseAdded: (updatedCosts: CostBreakdownResult) => void;
}

type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

const CURRENCIES = [
  { value: 'ETB', label: 'ETB — Birr' },
  { value: 'USD', label: 'USD — Dollar' },
  { value: 'CNY', label: 'CNY — Yuan' },
];

const today = () => new Date().toISOString().split('T')[0];

const EMPTY_FORM: ExpenseFormValues = {
  category:                'CHINA_ORIGIN',
  description:             '',
  amount:                  '',
  currency:                'USD',
  exchange_rate_override:  '',
  vendor_name:             '',
  expense_date:            today(),
  receipt_ref:             '',
  notes:                   '',
};

// ── Component ─────────────────────────────────────────────────

export function AddExpenseModal({
  isOpen,
  shipmentId,
  shipmentNumber,
  onClose,
  onExpenseAdded,
}: AddExpenseModalProps) {
  const [form, setForm] = useState<ExpenseFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof ExpenseFormValues, string>>>({});
  const [status, setStatus] = useState<FormStatus>('idle');
  const [serverError, setServerError] = useState<string | null>(null);
  const [addAnother, setAddAnother] = useState(false);

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setForm({ ...EMPTY_FORM, expense_date: today() });
      setErrors({});
      setStatus('idle');
      setServerError(null);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && status !== 'submitting') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, status, onClose]);

  // ── Field change helpers ───────────────────────────────────

  const set = useCallback(
    <K extends keyof ExpenseFormValues>(field: K, value: ExpenseFormValues[K]) => {
      setForm(prev => ({ ...prev, [field]: value }));
      setErrors(prev => ({ ...prev, [field]: undefined })); // clear field error on change
    },
    [],
  );

  // When category changes, reset description to first subcategory suggestion
  const handleCategoryChange = (cat: ExpenseFormValues['category']) => {
    const subs = SUBCATEGORIES_BY_CATEGORY[cat] ?? [];
    set('category', cat);
    set('description', subs[0] ?? '');
  };

  // ── Validation ─────────────────────────────────────────────

  const validate = (): boolean => {
    const result = expenseSchema.safeParse(form);
    if (result.success) {
      setErrors({});
      return true;
    }
    const fieldErrors: typeof errors = {};
    result.error.issues.forEach(e => {
      const field = e.path[0] as keyof ExpenseFormValues;
      fieldErrors[field] = e.message;
    });
    setErrors(fieldErrors);
    return false;
  };

  // ── Submit ─────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!validate()) return;

    setStatus('submitting');
    setServerError(null);

    try {
      const result = await addExpenseAndRecalculate({
        shipment_id:             shipmentId,
        category:                form.category as ExpenseCategory,
        description:             form.description,
        amount:                  parseFloat(form.amount),
        currency:                form.currency as any,
        vendor_name:             form.vendor_name || undefined,
        expense_date:            form.expense_date,
        receipt_ref:             form.receipt_ref || undefined,
        notes:                   form.notes || undefined,
        exchange_rate_override:  form.exchange_rate_override
          ? parseFloat(form.exchange_rate_override)
          : undefined,
      });

      // Fire callback — parent's useShipmentCostBreakdown.setData() will update immediately
      onExpenseAdded(result.updated_costs);
      setStatus('success');

      if (addAnother) {
        // Keep category + currency, reset amounts
        setTimeout(() => {
          setForm(prev => ({
            ...prev,
            description: '',
            amount: '',
            vendor_name: '',
            receipt_ref: '',
            notes: '',
          }));
          setStatus('idle');
        }, 800);
      } else {
        setTimeout(onClose, 1200);
      }
    } catch (err: any) {
      setStatus('error');
      setServerError(err.message ?? 'Something went wrong. Please try again.');
    }
  };

  if (!isOpen) return null;

  const subcategories = SUBCATEGORIES_BY_CATEGORY[form.category] ?? [];
  const isSubmitting  = status === 'submitting';
  const isSuccess     = status === 'success';
  const showRateField = form.currency !== 'ETB';

  // ── Render ─────────────────────────────────────────────────

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget && !isSubmitting) onClose(); }}
    >
      {/* Panel */}
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl
                      flex flex-col max-h-[92vh] overflow-hidden">

        {/* ── Header ──────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Add Expense</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              Shipment {shipmentNumber} · costs recalculate automatically on save
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600
                       hover:bg-gray-100 transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Scrollable Body ──────────────────────────────── */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* Category Picker — visual button grid */}
          <div>
            <Label>Category <Required /></Label>
            <div className="grid grid-cols-3 gap-2 mt-1.5">
              {EXPENSE_CATEGORIES.map(cat => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => handleCategoryChange(cat.value as ExpenseFormValues['category'])}
                  className={`
                    flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium
                    transition-all text-left
                    ${form.category === cat.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-400'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }
                  `}
                >
                  <span className="text-base">{cat.icon}</span>
                  <span className="leading-tight">{cat.label}</span>
                </button>
              ))}
            </div>
            {errors.category && <FieldError>{errors.category}</FieldError>}
          </div>

          {/* Description — smart dropdown based on category */}
          <div>
            <Label>Description <Required /></Label>
            <div className="relative mt-1.5">
              <input
                type="text"
                value={form.description}
                onChange={e => set('description', e.target.value)}
                placeholder="e.g. Customs Duty Payment"
                list="description-suggestions"
                className={inputClass(!!errors.description)}
              />
              <datalist id="description-suggestions">
                {subcategories.map(s => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            {errors.description
              ? <FieldError>{errors.description}</FieldError>
              : <Hint>Type or select from common {EXPENSE_CATEGORIES.find(c => c.value === form.category)?.label} expenses</Hint>
            }
          </div>

          {/* Amount + Currency — side by side */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Amount <Required /></Label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={e => set('amount', e.target.value)}
                placeholder="0.00"
                className={`mt-1.5 ${inputClass(!!errors.amount)}`}
              />
              {errors.amount && <FieldError>{errors.amount}</FieldError>}
            </div>

            <div>
              <Label>Currency <Required /></Label>
              <div className="relative mt-1.5">
                <select
                  value={form.currency}
                  onChange={e => set('currency', e.target.value as any)}
                  className={`appearance-none pr-8 ${inputClass(false)}`}
                >
                  {CURRENCIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Exchange Rate Override — only shown for non-ETB currencies */}
          {showRateField && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <Label className="text-amber-800">
                Exchange Rate Override
                <span className="ml-2 text-xs font-normal text-amber-600">
                  (leave blank to use latest customs rate)
                </span>
              </Label>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-sm text-amber-700 whitespace-nowrap">
                  1 {form.currency} =
                </span>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={form.exchange_rate_override}
                  onChange={e => set('exchange_rate_override', e.target.value)}
                  placeholder="e.g. 131.50"
                  className={`flex-1 ${inputClass(!!errors.exchange_rate_override)} bg-white`}
                />
                <span className="text-sm text-amber-700">ETB</span>
              </div>
              {errors.exchange_rate_override && (
                <FieldError>{errors.exchange_rate_override}</FieldError>
              )}
            </div>
          )}

          {/* Vendor + Date — side by side */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Vendor / Paid To</Label>
              <input
                type="text"
                value={form.vendor_name}
                onChange={e => set('vendor_name', e.target.value)}
                placeholder="e.g. Ethiopian Customs"
                className={`mt-1.5 ${inputClass(false)}`}
              />
            </div>

            <div>
              <Label>Expense Date <Required /></Label>
              <input
                type="date"
                value={form.expense_date}
                onChange={e => set('expense_date', e.target.value)}
                className={`mt-1.5 ${inputClass(!!errors.expense_date)}`}
              />
              {errors.expense_date && <FieldError>{errors.expense_date}</FieldError>}
            </div>
          </div>

          {/* Receipt Reference */}
          <div>
            <Label>Receipt / Invoice Reference</Label>
            <input
              type="text"
              value={form.receipt_ref}
              onChange={e => set('receipt_ref', e.target.value)}
              placeholder="e.g. INV-2026-0045"
              className={`mt-1.5 ${inputClass(false)}`}
            />
          </div>

          {/* Notes */}
          <div>
            <Label>Notes</Label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Any additional context about this expense…"
              className={`mt-1.5 resize-none ${inputClass(false)}`}
            />
          </div>

          {/* Server Error */}
          {status === 'error' && serverError && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{serverError}</p>
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/80
                        flex items-center justify-between gap-4">
          {/* Add another toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => setAddAnother(v => !v)}
              className={`
                relative w-9 h-5 rounded-full transition-colors
                ${addAnother ? 'bg-blue-600' : 'bg-gray-300'}
              `}
            >
              <div className={`
                absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform
                ${addAnother ? 'translate-x-4' : 'translate-x-0.5'}
              `} />
            </div>
            <span className="text-sm text-gray-600">Add another after saving</span>
          </label>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-gray-600 rounded-lg
                         hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || isSuccess}
              className={`
                flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg
                transition-all min-w-[140px] justify-center
                ${isSuccess
                  ? 'bg-green-500 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50'
                }
              `}
            >
              {isSubmitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              ) : isSuccess ? (
                <><CheckCircle className="w-4 h-4" /> Saved & Recalculated</>
              ) : (
                <><Plus className="w-4 h-4" /> Add Expense</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Small shared sub-components ───────────────────────────────

function Label({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-sm font-medium text-gray-700 ${className}`}>{children}</p>
  );
}

function Required() {
  return <span className="text-red-400 ml-0.5">*</span>;
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-red-500 mt-1">{children}</p>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-400 mt-1">{children}</p>;
}

function inputClass(hasError: boolean) {
  return `
    w-full px-3 py-2 text-sm rounded-lg border transition-colors
    focus:outline-none focus:ring-2
    ${hasError
      ? 'border-red-300 focus:ring-red-400 bg-red-50'
      : 'border-gray-300 focus:ring-blue-400 focus:border-blue-400 bg-white'
    }
  `;
}