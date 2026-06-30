// src/components/shipments/ExpensesPanel.tsx

import { useState, useRef, useEffect } from 'react';
import {
  Pencil, Trash2, Loader2, ChevronDown,
  CheckCircle, X, AlertCircle, Plus,
} from 'lucide-react';
import { useShipmentExpenses } from '../../hooks/useShipmentExpenses';
import {
  expenseSchema,
  EXPENSE_CATEGORIES,
  SUBCATEGORIES_BY_CATEGORY,
  type ExpenseFormValues,
} from '../../lib/validators/expenseSchema';
import type { ShipmentExpense } from '../../api/expenses';
import type { CostBreakdownResult, ExpenseCategory } from '../../types/costEngine';

// ── Constants ─────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; icon: string; color: string }> = {
  CHINA_ORIGIN:     { label: 'China Origin',      icon: '🇨🇳', color: 'bg-red-50   text-red-700   border-red-200'   },
  OCEAN_FREIGHT:    { label: 'Ocean Freight',     icon: '🚢', color: 'bg-blue-50  text-blue-700  border-blue-200'  },
  DJIBOUTI_PORT:    { label: 'Djibouti Port',     icon: '⚓', color: 'bg-cyan-50  text-cyan-700  border-cyan-200'  },
  TRUCKING:         { label: 'Trucking',           icon: '🚛', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  ETHIOPIA_CUSTOMS: { label: 'Customs',            icon: '🛃', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  OTHER:            { label: 'Other',              icon: '📋', color: 'bg-gray-50  text-gray-700  border-gray-200'  },
};

const ETB = (n: number) =>
  new Intl.NumberFormat('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// ── Props ─────────────────────────────────────────────────────

interface ExpensesPanelProps {
  shipmentId: string;
  onCostsUpdated: (costs: CostBreakdownResult) => void;
  onAddExpenseClick: () => void;
}

// ── Main Component ────────────────────────────────────────────

export function ExpensesPanel({
  shipmentId,
  onCostsUpdated,
  onAddExpenseClick,
}: ExpensesPanelProps) {
  const [editingId, setEditingId]         = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [groupByCategory, setGroupByCategory] = useState(true);

  const {
    expenses,
    isLoading,
    mutatingId,
    error,
    updateExpense,
    deleteExpense,
  } = useShipmentExpenses(shipmentId);

  // ── Derived totals ─────────────────────────────────────────
  const totalEtb = expenses.reduce((s, e) => s + (e.amount_etb ?? 0), 0);

  const byCategory = EXPENSE_CATEGORIES.reduce(
    (acc, cat) => {
      acc[cat.value] = expenses.filter(e => e.category === cat.value);
      return acc;
    },
    {} as Record<string, ShipmentExpense[]>,
  );

  // ── Handlers ───────────────────────────────────────────────

  const handleUpdateSave = async (payload: ExpenseFormValues & { id: string }) => {
    await updateExpense(
      {
        id:                      payload.id,
        category:                payload.category as ExpenseCategory,
        description:             payload.description,
        amount:                  parseFloat(payload.amount),
        currency:                payload.currency as any,
        vendor_name:             payload.vendor_name || undefined,
        expense_date:            payload.expense_date,
        receipt_ref:             payload.receipt_ref || undefined,
        notes:                   payload.notes || undefined,
        exchange_rate_override:  payload.exchange_rate_override || undefined,
      },
      onCostsUpdated,
    );
    setEditingId(null);
  };

  const handleDelete = async (expenseId: string) => {
    await deleteExpense(expenseId, onCostsUpdated);
    setConfirmDeleteId(null);
  };

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col bg-white border border-gray-200 rounded-2xl
                    shadow-sm overflow-hidden h-full">

      {/* ── Panel Header ──────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Expenses</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {expenses.length} item{expenses.length !== 1 ? 's' : ''} ·{' '}
            <span className="font-medium text-gray-600">{ETB(totalEtb)} ETB</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Group toggle */}
          <button
            onClick={() => setGroupByCategory(v => !v)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors
              ${groupByCategory
                ? 'bg-gray-900 text-white border-gray-900'
                : 'text-gray-500 border-gray-200 hover:border-gray-300'
              }`}
          >
            By category
          </button>
          {/* Add button */}
          <button
            onClick={onAddExpenseClick}
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg
                       bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      </div>

      {/* ── Error Banner ──────────────────────────────────── */}
      {error && (
        <div className="mx-3 mt-3 flex items-center gap-2 p-2.5 bg-red-50
                        border border-red-200 rounded-lg text-xs text-red-700">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* ── List Body ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">

        {isLoading && (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Loading expenses…</span>
          </div>
        )}

        {!isLoading && expenses.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <p className="text-sm font-medium">No expenses yet</p>
            <p className="text-xs mt-1">Add your first cost to see landed cost calculations.</p>
            <button
              onClick={onAddExpenseClick}
              className="mt-4 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                         bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add First Expense
            </button>
          </div>
        )}

        {/* Grouped view */}
        {!isLoading && groupByCategory && (
          <>
            {EXPENSE_CATEGORIES.map(cat => {
              const rows = byCategory[cat.value];
              if (rows.length === 0) return null;
              const catTotal = rows.reduce((s, e) => s + (e.amount_etb ?? 0), 0);
              return (
                <CategoryGroup
                  key={cat.value}
                  category={cat.value}
                  label={cat.label}
                  icon={cat.icon}
                  total={catTotal}
                  expenses={rows}
                  editingId={editingId}
                  confirmDeleteId={confirmDeleteId}
                  mutatingId={mutatingId}
                  onEdit={setEditingId}
                  onCancelEdit={() => setEditingId(null)}
                  onSaveEdit={handleUpdateSave}
                  onDeleteRequest={setConfirmDeleteId}
                  onDeleteCancel={() => setConfirmDeleteId(null)}
                  onDeleteConfirm={handleDelete}
                />
              );
            })}
          </>
        )}

        {/* Flat view */}
        {!isLoading && !groupByCategory && expenses.map(expense => (
          <ExpenseRow
            key={expense.id}
            expense={expense}
            isEditing={editingId === expense.id}
            isConfirmingDelete={confirmDeleteId === expense.id}
            isMutating={mutatingId === expense.id}
            onEdit={() => setEditingId(expense.id)}
            onCancelEdit={() => setEditingId(null)}
            onSaveEdit={handleUpdateSave}
            onDeleteRequest={() => setConfirmDeleteId(expense.id)}
            onDeleteCancel={() => setConfirmDeleteId(null)}
            onDeleteConfirm={() => handleDelete(expense.id)}
          />
        ))}
      </div>

      {/* ── Panel Footer: category totals ─────────────────── */}
      {!isLoading && expenses.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/80">
          <div className="flex flex-wrap gap-2">
            {EXPENSE_CATEGORIES.map(cat => {
              const rows = byCategory[cat.value];
              if (rows.length === 0) return null;
              const catTotal = rows.reduce((s, e) => s + (e.amount_etb ?? 0), 0);
              const meta = CATEGORY_META[cat.value];
              return (
                <span
                  key={cat.value}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg
                              border text-xs font-medium ${meta.color}`}
                >
                  {cat.icon} {ETB(catTotal)}
                </span>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-gray-500">Total landed cost</span>
            <span className="text-sm font-bold text-gray-900">{ETB(totalEtb)} ETB</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Category Group ─────────────────────────────────────────────

interface CategoryGroupProps {
  category: string;
  label: string;
  icon: string;
  total: number;
  expenses: ShipmentExpense[];
  editingId: string | null;
  confirmDeleteId: string | null;
  mutatingId: string | null;
  onEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (payload: ExpenseFormValues & { id: string }) => Promise<void>;
  onDeleteRequest: (id: string) => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: (id: string) => Promise<void>;
}

function CategoryGroup({
  category, label, icon, total, expenses,
  editingId, confirmDeleteId, mutatingId,
  onEdit, onCancelEdit, onSaveEdit,
  onDeleteRequest, onDeleteCancel, onDeleteConfirm,
}: CategoryGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  const meta = CATEGORY_META[category];

  return (
    <div>
      {/* Group header */}
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2
                   bg-gray-50/70 hover:bg-gray-100/70 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${meta.color}`}>
            {label}
          </span>
          <span className="text-xs text-gray-400">{expenses.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-700">{ETB(total)} ETB</span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-gray-400 transition-transform
                        ${collapsed ? '-rotate-90' : ''}`}
          />
        </div>
      </button>

      {/* Rows */}
      {!collapsed && expenses.map(expense => (
        <ExpenseRow
          key={expense.id}
          expense={expense}
          isEditing={editingId === expense.id}
          isConfirmingDelete={confirmDeleteId === expense.id}
          isMutating={mutatingId === expense.id}
          onEdit={() => onEdit(expense.id)}
          onCancelEdit={onCancelEdit}
          onSaveEdit={onSaveEdit}
          onDeleteRequest={() => onDeleteRequest(expense.id)}
          onDeleteCancel={onDeleteCancel}
          onDeleteConfirm={() => onDeleteConfirm(expense.id)}
        />
      ))}
    </div>
  );
}

// ── Individual Expense Row ─────────────────────────────────────

interface ExpenseRowProps {
  expense: ShipmentExpense;
  isEditing: boolean;
  isConfirmingDelete: boolean;
  isMutating: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (payload: ExpenseFormValues & { id: string }) => Promise<void>;
  onDeleteRequest: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => Promise<void>;
}

function ExpenseRow({
  expense, isEditing, isConfirmingDelete, isMutating,
  onEdit, onCancelEdit, onSaveEdit,
  onDeleteRequest, onDeleteCancel, onDeleteConfirm,
}: ExpenseRowProps) {
  if (isEditing) {
    return (
      <InlineEditForm
        expense={expense}
        onSave={onSaveEdit}
        onCancel={onCancelEdit}
      />
    );
  }

  if (isConfirmingDelete) {
    return (
      <DeleteConfirmRow
        expense={expense}
        isMutating={isMutating}
        onConfirm={onDeleteConfirm}
        onCancel={onDeleteCancel}
      />
    );
  }

  const meta = CATEGORY_META[expense.category];

  return (
    <div
      className={`group flex items-start gap-3 px-4 py-3 transition-colors
                  hover:bg-gray-50/60
                  ${isMutating ? 'opacity-40 pointer-events-none' : ''}`}
    >
      {/* Category dot */}
      <span className="mt-0.5 text-sm shrink-0">{meta.icon}</span>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-gray-800 truncate leading-tight">
            {expense.description}
          </p>
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100
                          transition-opacity">
            {/* Edit */}
            <button
              onClick={onEdit}
              className="p-1 rounded-md text-gray-400 hover:text-blue-600
                         hover:bg-blue-50 transition-colors"
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            {/* Delete */}
            <button
              onClick={onDeleteRequest}
              className="p-1 rounded-md text-gray-400 hover:text-red-600
                         hover:bg-red-50 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {/* Amount */}
          <span className="text-sm font-semibold text-gray-900 tabular-nums">
            {ETB(expense.amount_etb)} ETB
          </span>
          {/* Original currency (if not ETB) */}
          {expense.currency !== 'ETB' && (
            <span className="text-xs text-gray-400 tabular-nums">
              ({expense.amount.toLocaleString()} {expense.currency}
              {expense.exchange_rate ? ` @ ${expense.exchange_rate}` : ''})
            </span>
          )}
          {/* Provisional badge */}
          {expense.cost_status === 'PROVISIONAL' && (
            <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200
                             px-1.5 py-0.5 rounded-md">
              Est.
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 flex-wrap">
          {expense.vendor_name && <span>{expense.vendor_name}</span>}
          {expense.vendor_name && expense.expense_date && <span>·</span>}
          {expense.expense_date && (
            <span>{new Date(expense.expense_date).toLocaleDateString()}</span>
          )}
          {expense.receipt_ref && (
            <><span>·</span><span className="font-mono">{expense.receipt_ref}</span></>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Inline Edit Form ───────────────────────────────────────────

interface InlineEditFormProps {
  expense: ShipmentExpense;
  onSave: (payload: ExpenseFormValues & { id: string }) => Promise<void>;
  onCancel: () => void;
}

function InlineEditForm({ expense, onSave, onCancel }: InlineEditFormProps) {
  const [form, setForm] = useState<ExpenseFormValues>({
    category:               expense.category,
    description:            expense.description,
    amount:                 String(expense.amount),
    currency:               expense.currency,
    exchange_rate_override: expense.exchange_rate ? String(expense.exchange_rate) : '',
    vendor_name:            expense.vendor_name ?? '',
    expense_date:           expense.expense_date,
    receipt_ref:            expense.receipt_ref ?? '',
    notes:                  expense.notes ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ExpenseFormValues, string>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Focus description on mount
  const descRef = useRef<HTMLInputElement>(null);
  useEffect(() => { descRef.current?.focus(); }, []);

  const set = <K extends keyof ExpenseFormValues>(k: K, v: ExpenseFormValues[K]) => {
    setForm(prev => ({ ...prev, [k]: v }));
    setErrors(prev => ({ ...prev, [k]: undefined }));
  };

  const handleSave = async () => {
    const result = expenseSchema.safeParse(form);
    if (!result.success) {
      const errs: typeof errors = {};
      result.error.errors.forEach(e => {
        errs[e.path[0] as keyof ExpenseFormValues] = e.message;
      });
      setErrors(errs);
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave({ ...form, id: expense.id });
    } catch (e: any) {
      setSaveError(e.message ?? 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  // Save on Enter, cancel on Escape
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); }
    if (e.key === 'Escape') onCancel();
  };

  const subcategories = SUBCATEGORIES_BY_CATEGORY[form.category] ?? [];
  const showRate = form.currency !== 'ETB';

  return (
    <div
      className="px-4 py-3 bg-blue-50/40 border-l-2 border-blue-400 space-y-3"
      onKeyDown={handleKeyDown}
    >
      {/* Row 1: Category + Description */}
      <div className="flex gap-2">
        <div className="relative">
          <select
            value={form.category}
            onChange={e => {
              const cat = e.target.value as ExpenseFormValues['category'];
              const subs = SUBCATEGORIES_BY_CATEGORY[cat] ?? [];
              set('category', cat);
              set('description', subs[0] ?? '');
            }}
            className={selectClass}
          >
            {EXPENSE_CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <input
            ref={descRef}
            type="text"
            value={form.description}
            onChange={e => set('description', e.target.value)}
            list="edit-desc-suggestions"
            placeholder="Description"
            className={inputClass(!!errors.description)}
          />
          <datalist id="edit-desc-suggestions">
            {subcategories.map(s => <option key={s} value={s} />)}
          </datalist>
          {errors.description && <FieldError>{errors.description}</FieldError>}
        </div>
      </div>

      {/* Row 2: Amount + Currency */}
      <div className="flex gap-2">
        <input
          type="number"
          step="0.01"
          value={form.amount}
          onChange={e => set('amount', e.target.value)}
          placeholder="Amount"
          className={`w-32 ${inputClass(!!errors.amount)}`}
        />
        <select
          value={form.currency}
          onChange={e => set('currency', e.target.value as any)}
          className={`w-28 ${selectClass}`}
        >
          {[{ value: 'ETB' }, { value: 'USD' }, { value: 'CNY' }].map(c => (
            <option key={c.value} value={c.value}>{c.value}</option>
          ))}
        </select>
        {showRate && (
          <input
            type="number"
            step="0.001"
            value={form.exchange_rate_override}
            onChange={e => set('exchange_rate_override', e.target.value)}
            placeholder="Rate (optional)"
            className={`flex-1 ${inputClass(false)}`}
          />
        )}
        {errors.amount && <FieldError>{errors.amount}</FieldError>}
      </div>

      {/* Row 3: Vendor + Date */}
      <div className="flex gap-2">
        <input
          type="text"
          value={form.vendor_name}
          onChange={e => set('vendor_name', e.target.value)}
          placeholder="Vendor (optional)"
          className={`flex-1 ${inputClass(false)}`}
        />
        <input
          type="date"
          value={form.expense_date}
          onChange={e => set('expense_date', e.target.value)}
          className={`w-40 ${inputClass(!!errors.expense_date)}`}
        />
      </div>

      {/* Row 4: Receipt ref */}
      <input
        type="text"
        value={form.receipt_ref}
        onChange={e => set('receipt_ref', e.target.value)}
        placeholder="Receipt / invoice ref (optional)"
        className={inputClass(false)}
      />

      {/* Server error */}
      {saveError && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50
                        border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {saveError}
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          disabled={isSaving}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg
                     text-gray-500 hover:bg-gray-200 transition-colors disabled:opacity-40"
        >
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg
                     bg-blue-600 text-white hover:bg-blue-700 transition-colors
                     disabled:opacity-50"
        >
          {isSaving
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
            : <><CheckCircle className="w-3.5 h-3.5" /> Save & Recalculate</>
          }
        </button>
      </div>
    </div>
  );
}

// ── Delete Confirm Row ─────────────────────────────────────────

interface DeleteConfirmRowProps {
  expense: ShipmentExpense;
  isMutating: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

function DeleteConfirmRow({ expense, isMutating, onConfirm, onCancel }: DeleteConfirmRowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-red-50/60 border-l-2 border-red-400">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-red-800 truncate">{expense.description}</p>
        <p className="text-xs text-red-500 mt-0.5">
          This will remove {ETB(expense.amount_etb)} ETB from the landed cost and
          recalculate all product unit costs.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onCancel}
          disabled={isMutating}
          className="text-xs px-3 py-1.5 rounded-lg text-gray-600
                     hover:bg-gray-200 transition-colors disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={isMutating}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg
                     bg-red-600 text-white hover:bg-red-700 transition-colors
                     disabled:opacity-50"
        >
          {isMutating
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Deleting…</>
            : <><Trash2 className="w-3.5 h-3.5" /> Confirm Delete</>
          }
        </button>
      </div>
    </div>
  );
}

// ── Shared micro-styles ────────────────────────────────────────

const inputClass = (hasError: boolean) => `
  w-full px-2.5 py-1.5 text-xs rounded-lg border transition-colors
  focus:outline-none focus:ring-1
  ${hasError
    ? 'border-red-300 focus:ring-red-400 bg-red-50'
    : 'border-gray-200 focus:ring-blue-400 bg-white'
  }
`;

const selectClass = `
  px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white
  focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors
`;

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-red-500 mt-0.5">{children}</p>;
}