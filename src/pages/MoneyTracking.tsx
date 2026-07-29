import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { recordQuickIncome, fetchWarehousesList } from '../api/income'
import { recordCompanyExpense, fetchCompaniesList, fetchEmployeesList } from '../api/companyExpenses'
import { fetchCustomers } from '../api/customers'
import { fetchCreditAccounts, recordCreditTransaction, fetchOutstandingCreditOrders } from '../api/credit'
import type { OutstandingCreditOrder } from '../api/credit'
import { fetchSupplierPayables, recordSupplierPayment } from '../api/supplierPayables'
import type { SupplierPayableListRow } from '../api/supplierPayables'
import { fetchAccounts, fetchAccountBalances } from '../api/accounts'
import type { Account } from '../api/accounts'
import { updateTransaction, deleteTransaction } from '../api/transactions'
import { usePageState } from '../lib/pageState'
import { detectAnomalies } from '../lib/anomalyDetection'
import {
  Banknote, Loader2, ShieldAlert, ArrowDownLeft, ArrowUpRight,
  Search, Plus, X, Pencil, Trash2, Sparkles, Copy, TrendingUp, ChevronDown, ChevronRight, ArrowUpDown,
  Wallet, ChevronLeft,
} from 'lucide-react'
import { HawalaFields, emptyHawalaValue, computeHawalaAmount } from '../components/HawalaFields'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'

type Direction = 'in' | 'out'
interface Txn {
  id: string; direction: Direction; party: string; amount: number; currency: string
  method: string; date: string | null; sensitive: boolean; notes: string | null
  source: 'sale' | 'purchase' | 'credit_repayment' | 'expense' | 'shipment_expense' | 'supplier_payment'
  accountName: string | null
  // The account_id this transaction is tagged to, and how much of it actually
  // moved through that account, in the account's own currency. Usually equal
  // to `amount`, except a hawala supplier payment: `amount` is in the
  // payable's currency (USD/CNY), but the account that funded it was debited
  // in ETB (etb_amount) — the dealer, not the account, converted currencies.
  // null when this transaction doesn't affect its tagged account's balance
  // at all (currency mismatch) — mirrors fetchAccountBalances exactly, so a
  // per-account statement built from this always agrees with the balance
  // shown on the account card.
  accountId: string | null
  accountAmount: number | null
  detail?: string | null
  /** The sales_orders.id behind a 'sale' Txn -- lets the expand panel look
   * up which products were actually sold, not just the order number. */
  saleOrderId?: string | null
  /** Why the money went out -- company_expenses.category (rent/salary/...)
   * or shipment_expenses.category (OCEAN_FREIGHT/...). Only set for
   * source 'expense' / 'shipment_expense'. */
  category?: string | null
}
interface SaleLineItem { productName: string; quantity: number; unitPriceEtb: number }
interface CreditAccount { id: string; customer_id: string; customer_name: string; credit_limit: number; balance: number; due_date: string; status: string }
interface CreditTxnHistory { id: string; type: 'draw' | 'repayment'; amount: number; date: string | null; orderNumber: string | null; notes: string | null }
interface Option { id: string; name: string }

const METHOD_LABEL: Record<string, string> = { cash: 'Cash', bank_transfer: 'Transfer', credit: 'Credit', mobile_money: 'Mobile money', hawala: 'Hawala' }
const SOURCE_LABEL: Record<Txn['source'], string> = {
  sale: 'Sale payment', purchase: 'Purchase', credit_repayment: 'Credit repayment',
  expense: 'Company expense', shipment_expense: 'Shipment expense', supplier_payment: 'Supplier payment',
}
const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

// "Jul 23" for anything more than a few weeks old reads fine on a
// statement, but for anything recent -- which is most of what shows up in
// a daily-use feed -- "today"/"yesterday"/"3 days ago" is far faster to
// scan than working out a date's recency by eye. Falls back to the plain
// date (with year, if not this year) once it's far enough back that
// relative phrasing stops being useful. Accepts both a plain date
// ('YYYY-MM-DD') and a full timestamp -- sorting always uses the raw
// underlying string, this is display-only.
function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const now = new Date()
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate())
  const dayDiff = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000)
  const hasTime = /\d{2}:\d{2}/.test(dateStr)
  const time = hasTime ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null

  if (dayDiff === 0) return time ? `Today, ${time}` : 'Today'
  if (dayDiff === 1) return 'Yesterday'
  if (dayDiff > 1 && dayDiff < 7) return `${dayDiff} days ago`
  if (dayDiff >= 7 && dayDiff < 14) return 'A week ago'
  if (dayDiff >= 14 && dayDiff < 28) return `${Math.floor(dayDiff / 7)} weeks ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}
const CATEGORIES = ['rent', 'salary', 'fuel', 'supplies', 'utilities', 'maintenance', 'other']

// shipment_expenses uses an uppercase enum (see ShipmentDetail.tsx's own
// CAT_LABELS); company_expenses.category is already a plain lowercase word
// (rent, salary, ...) -- capitalized as a fallback rather than duplicating
// a second lookup table for it.
const SHIPMENT_EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  CHINA_ORIGIN: 'China Origin', OCEAN_FREIGHT: 'Ocean Freight', DJIBOUTI_PORT: 'Djibouti Port',
  TRUCKING: 'Trucking', ETHIOPIA_CUSTOMS: 'Customs', OTHER: 'Other',
}
function expenseReasonLabel(category: string): string {
  return SHIPMENT_EXPENSE_CATEGORY_LABEL[category] ?? (category.charAt(0).toUpperCase() + category.slice(1))
}

function AddIncomeForm({ customers, warehouses, creditAccounts, accounts, onDone, onCancel }: {
  customers: Option[]; warehouses: Option[]; creditAccounts: CreditAccount[]; accounts: Account[]
  onDone: () => void; onCancel: () => void
}) {
  // "Is this money against something already registered (a credit balance
  // the customer already owes), or a brand-new sale?" -- picking the wrong
  // one used to mean a disconnected transaction that never touched the
  // real outstanding balance.
  const [mode, setMode] = useState<'new_sale' | 'credit_repayment'>('new_sale')
  const [customerId, setCustomerId] = useState('')
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [creditAccountId, setCreditAccountId] = useState('')
  const [outstandingOrders, setOutstandingOrders] = useState<OutstandingCreditOrder[]>([])
  const [repaymentOrderId, setRepaymentOrderId] = useState('') // '' = general repayment
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [sensitive, setSensitive] = useState(false)
  const [notes, setNotes] = useState('')
  const [hawala, setHawala] = useState(emptyHawalaValue())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const customerCreditAccounts = creditAccounts.filter(c => c.customer_id === customerId)
  // Sales/credit-repayment amounts are always ETB (sales_payments.amount_etb,
  // credit_transactions.amount) — picking a non-ETB account would silently
  // never count toward that account's balance.
  const eligibleAccounts = useMemo(() => accounts.filter(a => a.currency === 'ETB'), [accounts])
  useEffect(() => {
    if (accountId && !eligibleAccounts.some(a => a.id === accountId)) setAccountId('')
  }, [eligibleAccounts, accountId])

  useEffect(() => {
    if (mode !== 'credit_repayment' || !creditAccountId) { setOutstandingOrders([]); return }
    fetchOutstandingCreditOrders(creditAccountId).then(setOutstandingOrders).catch(() => setOutstandingOrders([]))
  }, [mode, creditAccountId])

  function pickRepaymentOrder(orderId: string) {
    setRepaymentOrderId(orderId)
    const order = outstandingOrders.find(o => o.id === orderId)
    if (order) setAmount(String(Math.max(0, order.totalEtb - order.paidAmount)))
  }

  async function submit() {
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter an amount greater than 0.'); return }

    if (mode === 'credit_repayment') {
      if (!creditAccountId) { setError('Choose which credit account this pays down.'); return }
      if (!accountId) { setError('Choose which account received the money.'); return }
      setSaving(true); setError(null)
      try {
        await recordCreditTransaction(creditAccountId, 'repayment', amt, {
          method, sensitive, notes,
          salesOrderId: repaymentOrderId || undefined,
          accountId,
          hawalaRoute: method === 'hawala' ? hawala.route.trim() || undefined : undefined,
        })
        onDone()
      } catch (e: any) {
        setError(e?.message ?? 'Failed to record repayment.')
      } finally {
        setSaving(false)
      }
      return
    }

    // New sale -- 'credit' method finances it as a draw against a credit
    // account (no real cash account moves yet, so none is required); every
    // other method requires the account that actually received the money.
    if (!customerId) { setError('Choose a customer.'); return }
    if (!warehouseId) { setError('Choose a warehouse.'); return }
    if (method === 'credit' && !creditAccountId) { setError('Choose which credit account this draws against.'); return }
    if (method !== 'credit' && !accountId) { setError('Choose which account received the money.'); return }
    setSaving(true); setError(null)
    try {
      await recordQuickIncome({
        customerId, warehouseId, amount: amt, method: method as any,
        creditAccountId: method === 'credit' ? creditAccountId : undefined,
        accountId: method !== 'credit' ? accountId : undefined,
        sensitive, notes, date,
        hawalaRoute: method === 'hawala' ? hawala.route.trim() || undefined : undefined,
      })
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record income.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card padded className="mb-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-green-700">Add income</p>
        <div className="flex gap-1">
          {(['new_sale', 'credit_repayment'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2.5 py-1 text-xs rounded-lg border ${mode === m ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200'}`}>
              {m === 'new_sale' ? 'New sale' : 'Credit repayment'}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {mode === 'new_sale' ? (
        <>
          <div className="flex gap-2">
            <select value={customerId} onChange={e => { setCustomerId(e.target.value); setCreditAccountId('') }}
              className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
              <option value="">Which customer?</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
              className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          {method === 'credit' && (
            <select value={creditAccountId} onChange={e => setCreditAccountId(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
              <option value="">Which credit account does this draw against?</option>
              {customerCreditAccounts.map(c => (
                <option key={c.id} value={c.id}>{N(c.balance)}/{N(c.credit_limit)} ETB · due {c.due_date}</option>
              ))}
              {customerId && customerCreditAccounts.length === 0 && <option value="" disabled>No credit account for this customer — open one first</option>}
            </select>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <select value={customerId} onChange={e => { setCustomerId(e.target.value); setCreditAccountId(''); setRepaymentOrderId('') }}
            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
            <option value="">Which customer?</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={creditAccountId} onChange={e => { setCreditAccountId(e.target.value); setRepaymentOrderId('') }}
            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
            <option value="">Which credit account?</option>
            {customerCreditAccounts.map(c => (
              <option key={c.id} value={c.id}>{N(c.balance)}/{N(c.credit_limit)} ETB owed · due {c.due_date}</option>
            ))}
            {customerId && customerCreditAccounts.length === 0 && <option value="" disabled>No credit account for this customer</option>}
          </select>
          {creditAccountId && (
            <select value={repaymentOrderId} onChange={e => pickRepaymentOrder(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
              <option value="">General repayment (not tied to one order)</option>
              {outstandingOrders.map(o => (
                <option key={o.id} value={o.id}>{o.orderNumber} — {N(o.totalEtb - o.paidAmount)} ETB owed</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (ETB)"
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
        <select value={method} onChange={e => setMethod(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          {Object.entries(METHOD_LABEL).filter(([v]) => mode === 'new_sale' || v !== 'credit').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {mode === 'new_sale' && (
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
        )}
      </div>

      {(mode === 'credit_repayment' || method !== 'credit') && (
        <select value={accountId} onChange={e => setAccountId(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">{eligibleAccounts.length > 0 ? 'Which ETB account received it? *' : 'No ETB account set up yet'}</option>
          {eligibleAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}

      {method === 'hawala' && <HawalaFields value={hawala} onChange={setHawala} />}
      <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      <label className="flex items-center gap-1.5 text-xs text-gray-600">
        <input type="checkbox" checked={sensitive} onChange={e => setSensitive(e.target.checked)} />
        <ShieldAlert size={12} className="text-amber-500" /> Flag as sensitive
      </label>
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button loading={saving} className="!bg-green-600 !text-white hover:!brightness-95" onClick={submit}>
          {mode === 'credit_repayment' ? 'Record repayment' : 'Record income'}
        </Button>
      </div>
    </Card>
  )
}

interface ShipmentCostPayable {
  id: string
  shipmentId: string
  shipmentNumber: string
  category: string
  description: string
  vendorName: string | null
  currency: 'ETB' | 'USD' | 'CNY'
  amount: number
  amountEtb: number
  expenseDate: string | null
}

function AddExpenseForm({ companies, employees, accounts, suppliers, onDone, onCancel }: {
  companies: Option[]; employees: Option[]; accounts: Account[]; suppliers: Option[]; onDone: () => void; onCancel: () => void
}) {
  // "Is this a brand-new expense, paying down a payable we've already
  // registered for a supplier (goods debt), or settling one of the real
  // shipment-level costs (freight/customs/port/Ali) already sitting unpaid
  // on a shipment?" -- previously only supplier debt could be paid down
  // here; every other real payable required leaving Money Tracking
  // entirely for the separate Payables page, with no link back to which
  // shipment or cost line it actually belonged to.
  const [mode, setMode] = useState<'new_expense' | 'pay_payable' | 'pay_shipment_cost'>('new_expense')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<'ETB' | 'USD'>('ETB')
  const [method, setMethod] = useState('cash')
  const [companyId, setCompanyId] = useState('')
  const [paidBy, setPaidBy] = useState('')
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [sensitive, setSensitive] = useState(false)
  const [notes, setNotes] = useState('')
  const [hawala, setHawala] = useState(emptyHawalaValue())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isHawala = method === 'hawala'

  const [supplierId, setSupplierId] = useState('')
  const [payables, setPayables] = useState<SupplierPayableListRow[]>([])
  const [payableId, setPayableId] = useState('')
  const openPayables = payables.filter(p => p.supplierId === supplierId && p.totalAmount - p.paidAmount > 0.005)
  const selectedPayable = openPayables.find(p => p.id === payableId) ?? null

  const [shipmentCosts, setShipmentCosts] = useState<ShipmentCostPayable[]>([])
  const [costShipmentId, setCostShipmentId] = useState('')
  const [shipmentCostId, setShipmentCostId] = useState('')
  const costShipments = [...new Map(shipmentCosts.map(c => [c.shipmentId, c.shipmentNumber])).entries()]
    .map(([id, number]) => ({ id, number })).sort((a, b) => b.number.localeCompare(a.number))
  const shipmentCostsForSelected = shipmentCosts.filter(c => c.shipmentId === costShipmentId)
  const selectedShipmentCost = shipmentCostsForSelected.find(c => c.id === shipmentCostId) ?? null

  // Only offer accounts whose currency matches what actually leaves them —
  // a hawala payment debits the ETB account that paid the dealer, anything
  // else debits an account in the expense/payable's own currency. A
  // mismatched pick would silently never count toward that account's
  // balance (see fetchAccountBalances / MoneyTracking's own aggregation).
  const requiredCurrency = isHawala
    ? 'ETB'
    : mode === 'pay_payable' ? (selectedPayable?.currency ?? null)
    : mode === 'pay_shipment_cost' ? (selectedShipmentCost?.currency ?? null)
    : currency
  const eligibleAccounts = useMemo(
    () => requiredCurrency ? accounts.filter(a => a.currency === requiredCurrency) : accounts,
    [accounts, requiredCurrency],
  )
  useEffect(() => {
    if (accountId && !eligibleAccounts.some(a => a.id === accountId)) setAccountId('')
  }, [eligibleAccounts, accountId])

  useEffect(() => {
    if (mode !== 'pay_payable') return
    fetchSupplierPayables().then(setPayables).catch(() => setPayables([]))
  }, [mode])

  useEffect(() => {
    if (mode !== 'pay_shipment_cost') return
    supabase.from('shipment_expenses')
      .select('id, description, category, amount, amount_etb, currency, vendor_name, expense_date, shipment_id, shipments(shipment_number)')
      .eq('is_paid', false)
      .order('expense_date', { ascending: true })
      .then(({ data, error }) => {
        if (error) { setShipmentCosts([]); return }
        setShipmentCosts((data ?? []).map((r: any) => {
          const shipment = Array.isArray(r.shipments) ? r.shipments[0] : r.shipments
          return {
            id: r.id, shipmentId: r.shipment_id, shipmentNumber: shipment?.shipment_number ?? '—',
            category: r.category, description: r.description, vendorName: r.vendor_name,
            currency: r.currency, amount: Number(r.amount ?? 0), amountEtb: Number(r.amount_etb ?? 0),
            expenseDate: r.expense_date,
          }
        }))
      })
  }, [mode])

  function pickPayable(id: string) {
    setPayableId(id)
    const p = openPayables.find(x => x.id === id)
    if (p) { setAmount(String(p.totalAmount - p.paidAmount)); setCurrency(p.currency === 'CNY' ? 'USD' : p.currency) }
  }

  function pickShipmentCost(id: string) {
    setShipmentCostId(id)
    const c = shipmentCostsForSelected.find(x => x.id === id)
    if (c) setCurrency(c.currency === 'CNY' ? 'USD' : c.currency)
  }

  // Keep amount in sync with the hawala conversion — same fix as
  // Expenses.tsx, otherwise a stale manually-typed amount could disagree
  // with what the ETB/rate breakdown actually computes.
  useEffect(() => {
    if (!isHawala || currency === 'ETB') return
    const computed = computeHawalaAmount(hawala)
    if (computed != null) setAmount(String(computed))
  }, [isHawala, currency, hawala])

  async function submit() {
    // No partial-payment amount to validate here -- a shipment cost is
    // settled in full, same as the dedicated Payables page's "Mark as
    // paid" (there's no paid_amount ledger on shipment_expenses to
    // support paying it down incrementally).
    if (mode === 'pay_shipment_cost') {
      if (!selectedShipmentCost) { setError('Choose which shipment cost this pays.'); return }
      if (method !== 'credit' && !accountId) { setError('Choose which account paid it.'); return }
      setSaving(true); setError(null)
      try {
        const { error: updErr } = await supabase.from('shipment_expenses').update({
          is_paid: true, paid_at: new Date(date).toISOString(), payment_method: method,
          sensitive_flag: sensitive, account_id: method !== 'credit' ? accountId : null,
          hawala_route: isHawala ? (hawala.route.trim() || null) : null,
          hawala_etb_amount: isHawala && hawala.etbAmount ? Number(hawala.etbAmount) : null,
          hawala_exchange_rate: isHawala && hawala.exchangeRate ? Number(hawala.exchangeRate) : null,
        }).eq('id', selectedShipmentCost.id)
        if (updErr) throw updErr
        onDone()
      } catch (e: any) {
        setError(e?.message ?? 'Failed to record payment.')
      } finally {
        setSaving(false)
      }
      return
    }

    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter an amount greater than 0.'); return }

    if (mode === 'pay_payable') {
      if (!selectedPayable) { setError('Choose which payable this pays down.'); return }
      if (!accountId) { setError('Choose which account paid it.'); return }
      setSaving(true); setError(null)
      try {
        await recordSupplierPayment(selectedPayable.id, {
          paymentDate: date, method: method as any, amount: amt, accountId,
          sourceSalesOrderId: null, sourceNote: notes || null,
          hawalaRoute: isHawala ? hawala.route.trim() || null : null,
          etbAmount: isHawala && hawala.etbAmount ? Number(hawala.etbAmount) : null,
          exchangeRate: isHawala && hawala.exchangeRate ? Number(hawala.exchangeRate) : null,
          reference: null, notes: notes || null,
        })
        onDone()
      } catch (e: any) {
        setError(e?.message ?? 'Failed to record payment.')
      } finally {
        setSaving(false)
      }
      return
    }

    if (!description.trim()) { setError('Add a short description.'); return }
    if (method !== 'credit' && !accountId) { setError('Choose which account paid it.'); return }
    setSaving(true); setError(null)
    try {
      await recordCompanyExpense({
        companyId: companyId || undefined, category, description, amount: amt, currency,
        method: method as "cash" | "bank_transfer" | "credit" | "mobile_money" | "hawala",
        paidBy: paidBy || undefined, expenseDate: date, sensitive, notes,
        accountId: method !== 'credit' ? accountId : undefined,
        hawalaRoute: isHawala ? hawala.route.trim() || undefined : undefined,
        hawalaEtbAmount: isHawala && hawala.etbAmount ? Number(hawala.etbAmount) : undefined,
        hawalaExchangeRate: isHawala && hawala.exchangeRate ? Number(hawala.exchangeRate) : undefined,
      })
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record expense.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card padded className="mb-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-red-700">Add expense</p>
        <div className="flex gap-1">
          {(['new_expense', 'pay_payable', 'pay_shipment_cost'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2.5 py-1 text-xs rounded-lg border ${mode === m ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-200'}`}>
              {m === 'new_expense' ? 'New expense' : m === 'pay_payable' ? 'Pay a supplier' : 'Pay a shipment cost'}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {mode === 'new_expense' ? (
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What was this for?"
          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      ) : mode === 'pay_payable' ? (
        <div className="space-y-2">
          <select value={supplierId} onChange={e => { setSupplierId(e.target.value); setPayableId('') }}
            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
            <option value="">Which supplier?</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {supplierId && (
            <select value={payableId} onChange={e => pickPayable(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
              <option value="">Which payable?</option>
              {openPayables.map(p => (
                <option key={p.id} value={p.id}>
                  {p.reference || p.shipmentNumber || 'Payable'} — {N(p.totalAmount - p.paidAmount)} {p.currency} owed
                </option>
              ))}
              {openPayables.length === 0 && <option value="" disabled>No open payables for this supplier</option>}
            </select>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Real, unpaid shipment costs (freight/customs/port/Ali charges,
              not the supplier's goods debt above) -- picking a shipment
              first is what "leads back to where in the shipment this is
              needed," rather than a flat list of descriptions with no
              context. */}
          <select value={costShipmentId} onChange={e => { setCostShipmentId(e.target.value); setShipmentCostId('') }}
            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
            <option value="">Which shipment?</option>
            {costShipments.map(s => <option key={s.id} value={s.id}>{s.number}</option>)}
            {costShipments.length === 0 && <option value="" disabled>No unpaid shipment costs right now</option>}
          </select>
          {costShipmentId && (
            <>
              <select value={shipmentCostId} onChange={e => pickShipmentCost(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
                <option value="">Which cost?</option>
                {shipmentCostsForSelected.map(c => (
                  <option key={c.id} value={c.id}>
                    {expenseReasonLabel(c.category)} — {c.description}{c.vendorName ? ` · ${c.vendorName}` : ''} — {N(c.amount)} {c.currency} owed
                  </option>
                ))}
              </select>
              <Link to={`/shipments/${costShipmentId}`} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5">
                Open {costShipments.find(s => s.id === costShipmentId)?.number} <ChevronRight size={11} />
              </Link>
            </>
          )}
          {selectedShipmentCost && (
            <div className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-2.5 py-1.5">
              <span className="text-gray-400">Amount owed</span>
              <span className="font-mono font-medium text-gray-700">{N(selectedShipmentCost.amount)} {selectedShipmentCost.currency}</span>
            </div>
          )}
        </div>
      )}
      {mode !== 'pay_shipment_cost' && (
        <div className="flex gap-2">
          {mode === 'new_expense' && (
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white capitalize">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount"
            className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
          <select value={currency} onChange={e => setCurrency(e.target.value as 'ETB' | 'USD')}
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
            <option value="ETB">ETB</option><option value="USD">USD</option>
          </select>
        </div>
      )}
      <div className="flex gap-2">
        <select value={method} onChange={e => setMethod(e.target.value)}
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          {Object.entries(METHOD_LABEL).filter(([v]) => mode !== 'pay_payable' || v !== 'credit').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      </div>
      {mode === 'new_expense' && (
        <div className="flex gap-2">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)}
            className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
            <option value="">Which company?</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={paidBy} onChange={e => setPaidBy(e.target.value)}
            className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
            <option value="">Who paid?</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      )}
      {method !== 'credit' && (
        <select value={accountId} onChange={e => setAccountId(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">
            {eligibleAccounts.length > 0 ? `Which ${requiredCurrency ?? ''} account paid it? *` : `No ${requiredCurrency ?? ''} account set up yet`}
          </option>
          {eligibleAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      {isHawala && <HawalaFields value={hawala} onChange={setHawala} targetCurrency={currency} />}
      <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      <label className="flex items-center gap-1.5 text-xs text-gray-600">
        <input type="checkbox" checked={sensitive} onChange={e => setSensitive(e.target.checked)} />
        <ShieldAlert size={12} className="text-amber-500" /> Flag as sensitive
      </label>
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button loading={saving} className="!bg-red-600 !text-white hover:!brightness-95" onClick={submit}>
          {mode === 'pay_payable' || mode === 'pay_shipment_cost' ? 'Record payment' : 'Record expense'}
        </Button>
      </div>
    </Card>
  )
}

function EditTxnForm({ txn, onDone, onCancel }: { txn: Txn; onDone: () => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(String(txn.amount))
  const [method, setMethod] = useState(txn.method)
  const [notes, setNotes] = useState(txn.notes ?? '')
  const [sensitive, setSensitive] = useState(txn.sensitive)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter an amount greater than 0.'); return }
    setSaving(true); setError(null)
    try {
      await updateTransaction(txn.id, { amount: amt, method, notes, sensitive })
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save changes.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!confirm('Delete this transaction? This can\'t be undone.')) return
    setSaving(true); setError(null)
    try {
      await deleteTransaction(txn.id)
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 space-y-2.5">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
          className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
        <select value={method} onChange={e => setMethod(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
          {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
      <label className="flex items-center gap-1.5 text-xs text-gray-600">
        <input type="checkbox" checked={sensitive} onChange={e => setSensitive(e.target.checked)} />
        <ShieldAlert size={12} className="text-amber-500" /> Sensitive
      </label>
      <div className="flex gap-2 justify-between">
        <button onClick={remove} disabled={saving} className="px-3 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 flex items-center gap-1">
          <Trash2 size={12} /> Delete
        </button>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">Cancel</button>
          <button onClick={save} disabled={saving} className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Shared expand-on-click detail panel -- used both by the main transaction
// feed and by a single account's own statement, so "what was sold" / "why
// the money went out" reads identically no matter which list you're
// looking at it from.
function TxnExpandDetails({ t, saleLineItems, saleLineItemsLoading, runningBalance }: {
  t: Txn
  saleLineItems: Record<string, SaleLineItem[]>
  saleLineItemsLoading: string | null
  runningBalance: number | undefined
}) {
  return (
    <div className="px-4 py-3 bg-gray-50/50 border-t border-gray-100 text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-gray-400">Type</span>
        <span className="font-medium text-gray-700">{SOURCE_LABEL[t.source] ?? t.source}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-gray-400">{t.direction === 'in' ? 'Came from' : 'Went to'}</span>
        <span className="font-medium text-gray-700">{t.party}</span>
      </div>
      {t.detail && (
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Reference</span>
          <span className="font-medium text-gray-700">{t.detail}</span>
        </div>
      )}
      {(t.source === 'expense' || t.source === 'shipment_expense') && t.category && (
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Reason</span>
          <span className="font-medium text-gray-700">{expenseReasonLabel(t.category)}</span>
        </div>
      )}
      {t.source === 'sale' && t.saleOrderId && (
        <div className="pt-1">
          <span className="text-gray-400">Items sold</span>
          {saleLineItemsLoading === t.saleOrderId ? (
            <p className="flex items-center gap-1.5 text-gray-400 mt-1"><Loader2 size={11} className="animate-spin" /> Loading…</p>
          ) : (saleLineItems[t.saleOrderId] ?? []).length === 0 ? (
            <p className="text-gray-400 mt-1">No line items found for this order.</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {(saleLineItems[t.saleOrderId] ?? []).map((l, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span className="font-medium text-gray-700">{l.productName} × {l.quantity}</span>
                  <span className="font-mono text-gray-500">{N(l.quantity * l.unitPriceEtb)} ETB</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-gray-400">{t.direction === 'in' ? 'Deposited into' : 'Paid from'}</span>
        <span className="font-medium text-gray-700">{t.accountName ?? 'No account recorded'}</span>
      </div>
      {t.accountName && t.accountAmount != null && (
        <>
          {Math.round(t.accountAmount) !== Math.round(t.amount) && (
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Amount through account</span>
              <span className="font-mono font-medium text-gray-700">{N(t.accountAmount)}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-gray-400">{t.accountName}'s balance after this</span>
            <span className="font-mono font-medium text-gray-700">
              {Math.round(runningBalance ?? 0).toLocaleString()}
            </span>
          </div>
        </>
      )}
      {t.notes && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-gray-400 shrink-0">Notes</span>
          <span className="font-medium text-gray-700 text-right">{t.notes}</span>
        </div>
      )}
    </div>
  )
}

export function MoneyTracking() {
  const [txns, setTxns] = useState<Txn[]>([])
  const [credit, setCredit] = useState<CreditAccount[]>([])
  const [customers, setCustomers] = useState<Option[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [companies, setCompanies] = useState<Option[]>([])
  const [employees, setEmployees] = useState<Option[]>([])
  const [suppliers, setSuppliers] = useState<Option[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({})
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [direction, setDirection] = usePageState<'all' | Direction>('moneyTracking.direction', 'all')
  const [query, setQuery] = usePageState('moneyTracking.query', '')
  const [dateFrom, setDateFrom] = usePageState('moneyTracking.dateFrom', '')
  const [dateTo, setDateTo] = usePageState('moneyTracking.dateTo', '')
  const [dateSort, setDateSort] = usePageState<'newest' | 'oldest'>('moneyTracking.dateSort', 'newest')
  const [methodFilter, setMethodFilter] = usePageState('moneyTracking.methodFilter', '')
  const [activeForm, setActiveForm] = useState<'income' | 'expense' | null>(null)
  const [editingTxnId, setEditingTxnId] = useState<string | null>(null)
  const [insightsOpen, setInsightsOpen] = usePageState('moneyTracking.insightsOpen', false)
  const [expandedTxnId, setExpandedTxnId] = useState<string | null>(null)
  const [saleLineItems, setSaleLineItems] = useState<Record<string, SaleLineItem[]>>({})
  const [saleLineItemsLoading, setSaleLineItemsLoading] = useState<string | null>(null)
  const [expandedCreditId, setExpandedCreditId] = useState<string | null>(null)
  const [creditHistory, setCreditHistory] = useState<Record<string, CreditTxnHistory[]>>({})
  const [creditHistoryLoading, setCreditHistoryLoading] = useState(false)

  const one = <T,>(v: T | T[] | null | undefined): T | null => Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [salesRes, supplierPayRes, creditTxRes, expenseRes, shipExpRes, creditAcctRows, customerRows, warehouseRows, companyRows, employeeRows, accountRows, supplierRows] =
        await Promise.all([
          supabase.from('sales_payments').select('id, amount_etb, method, sensitive_flag, notes, payment_date, account_id, sales_orders(id, order_number, customers(name))').order('payment_date', { ascending: false }).limit(200),
          // Replaces purchase_order_payments — nothing in the app has ever
          // created a purchase_orders row, so that table was always empty.
          // supplier_payments is the real "money paid to a supplier" ledger,
          // including hawala (route/rate carried in hawala_route).
          supabase.from('supplier_payments').select('id, amount, method, sensitive_flag, notes, payment_date, account_id, hawala_route, supplier_payables(reference, currency, suppliers(name))').order('payment_date', { ascending: false }).limit(200),
          supabase.from('credit_transactions').select('id, type, amount, method, sensitive_flag, notes, transaction_date, account_id, sales_orders(order_number), credit_accounts(customer_id, customers(name))').eq('type', 'repayment').order('transaction_date', { ascending: false }).limit(200),
          supabase.from('company_expenses').select('id, description, amount, currency, method, sensitive_flag, notes, expense_date, vendor_name, account_id, category').order('expense_date', { ascending: false }).limit(200),
          // Shipment expenses paid via Payables -> "Mark as paid" — otherwise
          // invisible here even though real cash left the business. Selects
          // the native `amount`/`currency`, not `amount_etb` — a shipment
          // expense paid in USD should show and count as USD, the same way
          // a supplier payment already does, not get silently ETB-converted.
          supabase.from('shipment_expenses').select('id, description, amount, amount_etb, currency, payment_method, hawala_etb_amount, sensitive_flag, notes, expense_date, vendor_name, account_id, paid_at, category').eq('is_paid', true).order('paid_at', { ascending: false }).limit(200),
          fetchCreditAccounts(),
          fetchCustomers(),
          fetchWarehousesList(),
          fetchCompaniesList(),
          fetchEmployeesList(),
          fetchAccounts(),
          supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
        ])

      if (salesRes.error) throw salesRes.error
      if (supplierPayRes.error) throw supplierPayRes.error
      if (creditTxRes.error) throw creditTxRes.error
      if (expenseRes.error) throw expenseRes.error
      if (shipExpRes.error) throw shipExpRes.error

      const accountNameById = new Map(accountRows.map(a => [a.id, a.name]))
      const accountCurrencyById = new Map(accountRows.map(a => [a.id, a.currency]))

      const salesTxns: Txn[] = (salesRes.data ?? []).map((r: any) => {
        const order = one(r.sales_orders); const customer = order ? one(order.customers) : null
        const amt = Number(r.amount_etb ?? 0)
        return {
          id: `sale-${r.id}`, direction: 'in', party: customer?.name ?? 'Unknown customer', amount: amt, currency: 'ETB', method: r.method ?? 'cash', date: r.payment_date, sensitive: !!r.sensitive_flag, notes: r.notes ?? null, source: 'sale', accountName: accountNameById.get(r.account_id) ?? null,
          accountId: r.account_id ?? null, accountAmount: accountCurrencyById.get(r.account_id) === 'ETB' ? amt : null,
          detail: order?.order_number ? `Order ${order.order_number}` : null,
          saleOrderId: order?.id ?? null,
        } as Txn
      })
      const supplierPayTxns: Txn[] = (supplierPayRes.data ?? []).map((r: any) => {
        const payable = one(r.supplier_payables); const supplier = payable ? one(payable.suppliers) : null
        const acctCurrency = accountCurrencyById.get(r.account_id)
        const isHawala = r.method === 'hawala' && r.etb_amount != null
        const accountAmount = isHawala
          ? (acctCurrency === 'ETB' ? Number(r.etb_amount) : null)
          : (acctCurrency && acctCurrency === (payable?.currency ?? null) ? Number(r.amount ?? 0) : null)
        return {
          id: `supplierpay-${r.id}`, direction: 'out', party: supplier?.name ?? 'Unknown supplier',
          amount: Number(r.amount ?? 0), currency: payable?.currency ?? 'USD', method: r.method ?? 'cash',
          date: r.payment_date, sensitive: !!r.sensitive_flag, notes: r.notes ?? null, source: 'supplier_payment',
          accountName: accountNameById.get(r.account_id) ?? null, accountId: r.account_id ?? null, accountAmount,
          detail: r.hawala_route ?? payable?.reference ?? null,
        } as Txn
      })
      const creditTxns: Txn[] = (creditTxRes.data ?? []).map((r: any) => {
        const account = one(r.credit_accounts); const customer = account ? one(account.customers) : null
        const order = one(r.sales_orders)
        const amt = Number(r.amount ?? 0)
        return {
          id: `credit-${r.id}`, direction: 'in', party: customer?.name ?? 'Unknown customer', amount: amt, currency: 'ETB', method: r.method ?? 'cash', date: r.transaction_date, sensitive: !!r.sensitive_flag, notes: r.notes ?? null, source: 'credit_repayment', accountName: accountNameById.get(r.account_id) ?? null,
          accountId: r.account_id ?? null, accountAmount: accountCurrencyById.get(r.account_id) === 'ETB' ? amt : null,
          detail: order?.order_number ? `Order ${order.order_number}` : 'General repayment',
        } as Txn
      })
      // party is vendor_name when there is one, description otherwise — so
      // only surface description separately (what the money was actually
      // for) when it isn't already doing double duty as the party name.
      const expenseTxns: Txn[] = (expenseRes.data ?? []).map((r: any) => {
        const amt = Number(r.amount ?? 0)
        const currency = r.currency ?? 'ETB'
        return {
          id: `expense-${r.id}`, direction: 'out', party: r.vendor_name ?? r.description, amount: amt, currency, method: r.method ?? 'cash', date: r.expense_date, sensitive: !!r.sensitive_flag, notes: r.notes ?? null, source: 'expense', accountName: accountNameById.get(r.account_id) ?? null,
          accountId: r.account_id ?? null, accountAmount: accountCurrencyById.get(r.account_id) === currency ? amt : null,
          detail: r.vendor_name ? r.description : null, category: r.category ?? null,
        } as Txn
      })
      const shipExpTxns: Txn[] = (shipExpRes.data ?? []).map((r: any) => {
        const amt = Number(r.amount ?? 0)
        const currency = r.currency ?? 'ETB'
        // Same hawala carve-out as supplier payments: a hawala-paid expense
        // debits the ETB account that paid the dealer, not the expense's own
        // (often foreign) currency.
        const isHawala = r.payment_method === 'hawala' && r.hawala_etb_amount != null
        const acctCurrency = accountCurrencyById.get(r.account_id)
        const accountAmount = isHawala
          ? (acctCurrency === 'ETB' ? Number(r.hawala_etb_amount) : null)
          : (acctCurrency === currency ? amt : null)
        return {
          id: `shipexp-${r.id}`, direction: 'out', party: r.vendor_name ?? r.description, amount: amt, currency, method: r.payment_method ?? 'cash', date: r.paid_at ?? r.expense_date, sensitive: !!r.sensitive_flag, notes: r.notes ?? null, source: 'shipment_expense', accountName: accountNameById.get(r.account_id) ?? null,
          accountId: r.account_id ?? null, accountAmount,
          detail: r.vendor_name ? r.description : null, category: r.category ?? null,
        } as Txn
      })

      setTxns([...salesTxns, ...supplierPayTxns, ...creditTxns, ...expenseTxns, ...shipExpTxns].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')))
      setCredit((creditAcctRows ?? []).map((r: any) => ({
        id: r.id, customer_id: one(r.customers)?.id ?? '', customer_name: one(r.customers)?.name ?? 'Unknown',
        credit_limit: Number(r.credit_limit ?? 0), balance: Number(r.balance ?? 0), due_date: r.due_date, status: r.status,
      })))
      setCustomers((customerRows ?? []).map((c: any) => ({ id: c.id, name: c.name })))
      setWarehouses((warehouseRows ?? []).map((w: any) => ({ id: w.id, name: w.name })))
      setAccounts(accountRows)
      fetchAccountBalances(accountRows).then(setAccountBalances).catch(() => setAccountBalances({}))
      setCompanies((companyRows ?? []).map((c: any) => ({ id: c.id, name: c.name })))
      setEmployees((employeeRows ?? []).map((e: any) => ({ id: e.id, name: e.full_name })))
      setSuppliers((supplierRows.data ?? []).map((s: any) => ({ id: s.id, name: s.name })))
    } catch (e: any) {
      console.error(e)
      setError(e?.message ?? 'Unable to load money tracking data.')
      setTxns([]); setCredit([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => txns
    .filter(t => direction === 'all' || t.direction === direction)
    .filter(t => !methodFilter || t.method === methodFilter)
    .filter(t => !dateFrom || (t.date ?? '').slice(0, 10) >= dateFrom)
    .filter(t => !dateTo || (t.date ?? '').slice(0, 10) <= dateTo)
    .filter(t => t.party.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => dateSort === 'newest' ? (b.date ?? '').localeCompare(a.date ?? '') : (a.date ?? '').localeCompare(b.date ?? '')),
    [txns, direction, query, methodFilter, dateFrom, dateTo, dateSort])
  const hasListFilters = !!(query || methodFilter || dateFrom || dateTo || direction !== 'all')

  const selectedAccount = accounts.find(a => a.id === selectedAccountId) ?? null

  // A single account's statement: every transaction tagged to it (using
  // accountAmount, not amount — see the Txn comment) walked chronologically
  // to build a running balance, then reversed so the newest entry — and its
  // balance, which is the account's current balance — reads first, matching
  // how the rest of this page already orders things.
  const accountLedger = useMemo(() => {
    if (!selectedAccountId) return []
    const rows = txns
      .filter(t => t.accountId === selectedAccountId && t.accountAmount != null)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id))
    let running = 0
    const withBalance = rows.map(t => {
      running += t.direction === 'in' ? (t.accountAmount as number) : -(t.accountAmount as number)
      return { ...t, runningBalance: running }
    })
    return withBalance.reverse()
  }, [txns, selectedAccountId])

  // Same running-balance computation as accountLedger, but for every account
  // at once and keyed by transaction id — powers the "where it went" expand
  // on each row in the main feed without requiring the user to first click
  // into that specific account's statement.
  const runningBalanceByTxnId = useMemo(() => {
    const byAccount = new Map<string, Txn[]>()
    for (const t of txns) {
      if (!t.accountId || t.accountAmount == null) continue
      if (!byAccount.has(t.accountId)) byAccount.set(t.accountId, [])
      byAccount.get(t.accountId)!.push(t)
    }
    const result = new Map<string, number>()
    for (const rows of byAccount.values()) {
      const sorted = [...rows].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id))
      let running = 0
      for (const t of sorted) {
        running += t.direction === 'in' ? (t.accountAmount as number) : -(t.accountAmount as number)
        result.set(t.id, running)
      }
    }
    return result
  }, [txns])

  // Last 14 days, net cash per day — a quick "is the trend healthy" glance
  // without leaving the page.
  const dailyTrend = useMemo(() => {
    const days: { date: string; net: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const iso = d.toISOString().slice(0, 10)
      const dayTxns = txns.filter(t => t.currency === 'ETB' && (t.date ?? '').slice(0, 10) === iso)
      const net = dayTxns.reduce((s, t) => s + (t.direction === 'in' ? t.amount : -t.amount), 0)
      days.push({ date: iso, net })
    }
    return days
  }, [txns])

  // Lazy-loads which products a sale actually contained the first time its
  // row is expanded (not eagerly for all 200 rows up front) -- a Txn only
  // carries the order number today, not what was sold.
  async function toggleTxnExpand(t: Txn) {
    if (expandedTxnId === t.id) { setExpandedTxnId(null); return }
    setExpandedTxnId(t.id)
    if (t.source !== 'sale' || !t.saleOrderId || saleLineItems[t.saleOrderId]) return
    setSaleLineItemsLoading(t.saleOrderId)
    try {
      const { data } = await supabase
        .from('sales_order_lines')
        .select('quantity, unit_price_etb, products(name)')
        .eq('sales_order_id', t.saleOrderId)
      const lines: SaleLineItem[] = (data ?? []).map((l: any) => ({
        productName: one(l.products)?.name ?? 'Unknown product',
        quantity: Number(l.quantity ?? 0),
        unitPriceEtb: Number(l.unit_price_etb ?? 0),
      }))
      setSaleLineItems(prev => ({ ...prev, [t.saleOrderId as string]: lines }))
    } catch {
      setSaleLineItems(prev => ({ ...prev, [t.saleOrderId as string]: [] }))
    } finally {
      setSaleLineItemsLoading(null)
    }
  }

  async function toggleCreditHistory(accountId: string) {
    if (expandedCreditId === accountId) { setExpandedCreditId(null); return }
    setExpandedCreditId(accountId)
    if (creditHistory[accountId]) return
    setCreditHistoryLoading(true)
    try {
      const { data } = await supabase
        .from('credit_transactions')
        .select('id, type, amount, transaction_date, notes, sales_orders(order_number)')
        .eq('credit_account_id', accountId)
        .order('transaction_date', { ascending: false })
      const rows: CreditTxnHistory[] = (data ?? []).map((r: any) => ({
        id: r.id, type: r.type, amount: Number(r.amount ?? 0), date: r.transaction_date,
        orderNumber: one(r.sales_orders)?.order_number ?? null, notes: r.notes,
      }))
      setCreditHistory(prev => ({ ...prev, [accountId]: rows }))
    } catch {
      setCreditHistory(prev => ({ ...prev, [accountId]: [] }))
    } finally {
      setCreditHistoryLoading(false)
    }
  }

  const totals = useMemo(() => {
    const inEtb = txns.filter(t => t.direction === 'in' && t.currency === 'ETB').reduce((s, t) => s + t.amount, 0)
    const outEtb = txns.filter(t => t.direction === 'out' && t.currency === 'ETB').reduce((s, t) => s + t.amount, 0)
    const outUsd = txns.filter(t => t.direction === 'out' && t.currency === 'USD').reduce((s, t) => s + t.amount, 0)
    // CNY payments (rare, but a real supplier-payment currency) were silently
    // dropped from every KPI tile before — they still appeared in the list
    // below, just uncounted anywhere in the summary.
    const outCny = txns.filter(t => t.direction === 'out' && t.currency === 'CNY').reduce((s, t) => s + t.amount, 0)
    const sensitiveCount = txns.filter(t => t.sensitive).length
    const outstandingCredit = credit.reduce((s, c) => s + c.balance, 0)
    return { inEtb, outEtb, outUsd, outCny, sensitiveCount, outstandingCredit }
  }, [txns, credit])

  // Statistical anomaly checks (amount outliers + possible duplicates) — no
  // external API, just runs against the transactions already loaded above.
  const anomalies = useMemo(() => detectAnomalies(txns), [txns])
  const anomaliesByTxnId = useMemo(() => {
    const map = new Map<string, typeof anomalies>()
    for (const a of anomalies) {
      if (!map.has(a.txnId)) map.set(a.txnId, [])
      map.get(a.txnId)!.push(a)
    }
    return map
  }, [anomalies])
  const highSeverityCount = anomalies.filter(a => a.severity === 'high').length

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <PageHeader
        icon={<Banknote size={18} />}
        title="Money tracking"
        subtitle="Every payment in and out — who, how much, how, and why"
        actions={<>
          <Button className="!bg-green-600 !text-white hover:!brightness-95" icon={activeForm === 'income' ? <X size={12} /> : <Plus size={12} />}
            onClick={() => setActiveForm(activeForm === 'income' ? null : 'income')}>Add income</Button>
          <Button className="!bg-red-600 !text-white hover:!brightness-95" icon={activeForm === 'expense' ? <X size={12} /> : <Plus size={12} />}
            onClick={() => setActiveForm(activeForm === 'expense' ? null : 'expense')}>Add expense</Button>
        </>}
      />

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

      {activeForm === 'income' && (
        <AddIncomeForm customers={customers} warehouses={warehouses} creditAccounts={credit} accounts={accounts}
          onCancel={() => setActiveForm(null)} onDone={() => { setActiveForm(null); load() }} />
      )}
      {activeForm === 'expense' && (
        <AddExpenseForm companies={companies} employees={employees} accounts={accounts} suppliers={suppliers}
          onCancel={() => setActiveForm(null)} onDone={() => { setActiveForm(null); load() }} />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <StatCard label="Received (ETB)" value={<span className="text-green-700">{N(totals.inEtb)}</span>} />
            <StatCard label="Paid out" value={<span className="text-red-700">{N(totals.outEtb)} ETB</span>}
              hint={[totals.outUsd > 0 ? `$${N(totals.outUsd)}` : null, totals.outCny > 0 ? `¥${N(totals.outCny)}` : null].filter(Boolean).join(' · ') || undefined} />
            <StatCard label="Credit outstanding" value={<span className="text-amber-700">{N(totals.outstandingCredit)}</span>} />
            <StatCard label="Sensitive flagged" value={<span className="text-amber-700">{totals.sensitiveCount}</span>} />
          </div>

          {accounts.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-medium text-gray-500 mb-2">Accounts — who's holding what, and where it came from</p>
              <div className="flex gap-2.5 overflow-x-auto pb-1">
                {accounts.map(a => {
                  const bal = accountBalances[a.id] ?? 0
                  const selected = selectedAccountId === a.id
                  return (
                    <button key={a.id} onClick={() => setSelectedAccountId(selected ? null : a.id)}
                      className={`shrink-0 w-44 text-left px-3.5 py-3 rounded-card border transition-colors shadow-[var(--shadow-card-sm)] ${
                        selected ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${a.type === 'cash' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                          <Wallet size={13} />
                        </div>
                        <p className="text-xs font-medium truncate">{a.name}</p>
                      </div>
                      <p className={`text-sm font-mono font-medium ${bal < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                        {Math.round(bal).toLocaleString()} {a.currency}
                      </p>
                      <p className="text-[10px] text-gray-400 capitalize">{a.type} · tap for statement</p>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {anomalies.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-card overflow-hidden mb-5">
              <button onClick={() => setInsightsOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-left">
                <span className="flex items-center gap-2 text-sm font-medium text-amber-800">
                  <Sparkles size={14} className="text-amber-500" />
                  {anomalies.length} unusual transaction{anomalies.length > 1 ? 's' : ''} flagged
                  {highSeverityCount > 0 && <span className="text-xs font-normal text-red-600">· {highSeverityCount} high</span>}
                </span>
                {insightsOpen ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
              </button>
              {insightsOpen && (
                <div className="border-t border-amber-100 divide-y divide-amber-50">
                  {anomalies.slice(0, 20).map((a, i) => {
                    const t = txns.find(x => x.id === a.txnId)
                    return (
                      <div key={`${a.txnId}-${a.type}-${i}`} className="flex items-start gap-2.5 px-4 py-2.5 text-xs bg-amber-50/40">
                        {a.type === 'possible_duplicate'
                          ? <Copy size={13} className={`shrink-0 mt-0.5 ${a.severity === 'high' ? 'text-red-500' : 'text-amber-500'}`} />
                          : <TrendingUp size={13} className={`shrink-0 mt-0.5 ${a.severity === 'high' ? 'text-red-500' : 'text-amber-500'}`} />}
                        <div className="min-w-0">
                          <p className="text-gray-700">{a.reason}</p>
                          {t && <p className="text-gray-400 mt-0.5">{t.party} · {formatRelativeDate(t.date)}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-card p-4 mb-5">
            <p className="text-xs font-medium text-gray-500 mb-3">Net cash, last 14 days</p>
            <div className="flex items-end gap-1.5" style={{ height: 64 }}>
              {(() => {
                const maxAbs = Math.max(...dailyTrend.map(d => Math.abs(d.net)), 1)
                return dailyTrend.map(d => {
                  const h = Math.max(3, (Math.abs(d.net) / maxAbs) * 56)
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.date}: ${d.net >= 0 ? '+' : ''}${N(d.net)} ETB`}>
                      <div className={`w-full rounded-sm ${d.net >= 0 ? 'bg-green-500' : 'bg-red-400'}`} style={{ height: h }} />
                    </div>
                  )
                })
              })()}
            </div>
          </div>

          {selectedAccount ? (
            <>
              <button onClick={() => setSelectedAccountId(null)}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-2">
                <ChevronLeft size={13} /> All transactions
              </button>
              <div className="bg-white border border-gray-200 rounded-card overflow-hidden mb-6">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{selectedAccount.name}</p>
                    <p className="text-xs text-gray-400 capitalize">{selectedAccount.type} · {selectedAccount.currency} · money in from sales, money out to expenses</p>
                  </div>
                  <p className={`text-lg font-mono font-medium ${(accountBalances[selectedAccount.id] ?? 0) < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                    {Math.round(accountBalances[selectedAccount.id] ?? 0).toLocaleString()} {selectedAccount.currency}
                  </p>
                </div>
                {accountLedger.length === 0 ? (
                  <p className="px-4 py-8 text-xs text-gray-400 text-center">Nothing has moved through this account yet.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-4 py-2 bg-gray-50/60 border-b border-gray-100 text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                      <div className="w-3" />
                      <div>What happened</div>
                      <div className="text-right w-20">In</div>
                      <div className="text-right w-20">Out</div>
                      <div className="text-right w-24">Balance</div>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {accountLedger.map(t => (
                        <div key={t.id}>
                          <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 items-center px-4 py-2.5 text-xs cursor-pointer hover:bg-gray-50/70"
                            onClick={() => toggleTxnExpand(t)}>
                            {expandedTxnId === t.id ? <ChevronDown size={12} className="text-gray-300 shrink-0" /> : <ChevronRight size={12} className="text-gray-300 shrink-0" />}
                            <div className="min-w-0">
                              <p className="font-medium truncate flex items-center gap-1.5">
                                {t.party}
                                {t.sensitive && <ShieldAlert size={11} className="text-amber-500 shrink-0" aria-label="Sensitive" />}
                              </p>
                              <p className="text-gray-400 truncate">
                                {formatRelativeDate(t.date)}
                                {t.detail && ` · ${t.detail}`}
                                {(t.source === 'expense' || t.source === 'shipment_expense') && t.category && ` · ${expenseReasonLabel(t.category)}`}
                                {t.notes && ` · ${t.notes}`}
                              </p>
                            </div>
                            <div className="font-mono text-green-700 w-20 text-right">
                              {t.direction === 'in' ? N(t.accountAmount as number) : ''}
                            </div>
                            <div className="font-mono text-red-600 w-20 text-right">
                              {t.direction === 'out' ? N(t.accountAmount as number) : ''}
                            </div>
                            <div className={`font-mono font-medium w-24 text-right ${t.runningBalance < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                              {Math.round(t.runningBalance).toLocaleString()}
                            </div>
                          </div>
                          {expandedTxnId === t.id && (
                            <TxnExpandDetails t={t} saleLineItems={saleLineItems} saleLineItemsLoading={saleLineItemsLoading}
                              runningBalance={t.runningBalance} />
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <div className="text-xs font-medium text-gray-500">Transactions</div>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={methodFilter} onChange={e => setMethodFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value="">All methods</option>
                {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
                <span>–</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
              </div>
              <button
                onClick={() => setDateSort(s => s === 'newest' ? 'oldest' : 'newest')}
                title="Sort by date"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                <ArrowUpDown size={12} className={dateSort === 'oldest' ? 'rotate-180' : ''} /> {dateSort === 'newest' ? 'Newest first' : 'Oldest first'}
              </button>
              {hasListFilters && (
                <button onClick={() => { setQuery(''); setMethodFilter(''); setDateFrom(''); setDateTo(''); setDirection('all') }}
                  className="text-xs text-blue-600 hover:underline">Clear filters</button>
              )}
              <div className="flex gap-1">
                {(['all', 'in', 'out'] as const).map(d => (
                  <button key={d} onClick={() => setDirection(d)}
                    className={`px-2.5 py-1 text-xs rounded-lg border capitalize ${direction === d ? 'bg-accent text-accent-foreground border-accent font-medium' : 'bg-white text-gray-600 border-gray-200'}`}>
                    {d === 'all' ? 'All' : d === 'in' ? 'In' : 'Out'}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-2.5 text-gray-400" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name"
                  className="pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg w-32" />
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-card overflow-hidden mb-6">
            {filtered.length === 0 ? (
              <p className="px-4 py-8 text-xs text-gray-400 text-center">No transactions found. Use "Add income" or "Add expense" above to record one.</p>
            ) : filtered.slice(0, 50).map((t, i, arr) => (
              <div key={t.id} className={`border-l-[3px] ${t.direction === 'in' ? 'border-l-green-400' : 'border-l-red-400'} ${i < arr.length - 1 ? 'border-b border-gray-50' : ''}`}>
                <div className="flex items-center gap-3 px-4 py-2.5 text-xs cursor-pointer hover:bg-gray-50/70"
                  onClick={() => toggleTxnExpand(t)}>
                  {expandedTxnId === t.id ? <ChevronDown size={12} className="text-gray-300 shrink-0" /> : <ChevronRight size={12} className="text-gray-300 shrink-0" />}
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${t.direction === 'in' ? 'bg-green-50' : 'bg-red-50'}`}>
                    {t.direction === 'in' ? <ArrowDownLeft size={12} className="text-green-600" /> : <ArrowUpRight size={12} className="text-red-500" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate flex items-center gap-1.5">
                      {t.party}
                      {t.sensitive && <Badge variant="warning" icon={<ShieldAlert size={9} />}>Sensitive</Badge>}
                      {anomaliesByTxnId.has(t.id) && (
                        <Sparkles size={11} className={`shrink-0 ${anomaliesByTxnId.get(t.id)!.some(a => a.severity === 'high') ? 'text-red-500' : 'text-amber-500'}`}
                          aria-label="Flagged as unusual" />
                      )}
                    </p>
                    <p className="text-gray-400 truncate">
                      {formatRelativeDate(t.date)} · {METHOD_LABEL[t.method] ?? t.method}{t.detail && ` · ${t.detail}`}{t.accountName && ` · ${t.accountName}`}
                    </p>
                  </div>
                  <div className={`font-mono font-medium shrink-0 ${t.direction === 'in' ? 'text-green-700' : 'text-red-600'}`}>
                    {t.direction === 'in' ? '+' : '−'}{N(t.amount)} {t.currency}
                  </div>
                  {/* shipment_expense and supplier_payment are managed on
                      their own pages (Payables / Supplier Payments) — editing
                      amount here wouldn't touch their hawala breakdown or
                      the payable's balance sync correctly, so they're
                      read-only in this feed. */}
                  {t.source !== 'shipment_expense' && t.source !== 'supplier_payment' && (
                    <button onClick={e => { e.stopPropagation(); setEditingTxnId(editingTxnId === t.id ? null : t.id) }}
                      className="p-1 text-gray-300 hover:text-blue-600 shrink-0">
                      <Pencil size={12} />
                    </button>
                  )}
                </div>
                {expandedTxnId === t.id && (
                  <TxnExpandDetails t={t} saleLineItems={saleLineItems} saleLineItemsLoading={saleLineItemsLoading}
                    runningBalance={runningBalanceByTxnId.get(t.id)} />
                )}
                {editingTxnId === t.id && (
                  <EditTxnForm txn={t} onCancel={() => setEditingTxnId(null)} onDone={() => { setEditingTxnId(null); load() }} />
                )}
              </div>
            ))}
          </div>
            </>
          )}

          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-gray-500">Credit — what's owed, and by whom</div>
            <Link to="/credit-accounts" className="text-xs text-blue-600 hover:underline flex items-center gap-0.5">
              Record a repayment <ChevronRight size={12} />
            </Link>
          </div>
          <div className="bg-white border border-gray-200 rounded-card overflow-hidden">
            {credit.length === 0 ? (
              <p className="px-4 py-8 text-xs text-gray-400 text-center">No open credit accounts.</p>
            ) : credit.map((c, i, arr) => (
              <div key={c.id} className={i < arr.length - 1 ? 'border-b border-gray-50' : ''}>
                <div className="flex items-center gap-3 px-4 py-2.5 text-xs cursor-pointer hover:bg-gray-50/70" onClick={() => toggleCreditHistory(c.id)}>
                  {expandedCreditId === c.id ? <ChevronDown size={12} className="text-gray-300 shrink-0" /> : <ChevronRight size={12} className="text-gray-300 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{c.customer_name}</p>
                    <p className="text-gray-400">Due {c.due_date} · limit {N(c.credit_limit)} ETB</p>
                  </div>
                  {(() => {
                    const overpaid = c.status === 'settled' && c.balance < 0
                    const label = overpaid ? 'overpaid' : c.status
                    const cls = overpaid ? 'bg-violet-50 text-violet-700' : c.status === 'overdue' ? 'bg-red-50 text-red-700' : c.status === 'settled' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'
                    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>
                  })()}
                  <div className={`font-mono font-medium w-24 text-right ${c.balance < 0 ? 'text-violet-700' : ''}`}>
                    {c.balance < 0 ? `+${N(-c.balance)}` : N(c.balance)} ETB
                  </div>
                </div>
                {expandedCreditId === c.id && (
                  <div className="px-4 pb-3 bg-gray-50/50 border-t border-gray-100">
                    {creditHistoryLoading && !creditHistory[c.id] ? (
                      <div className="flex items-center gap-1.5 text-xs text-gray-400 py-3"><Loader2 size={12} className="animate-spin" /> Loading history…</div>
                    ) : (creditHistory[c.id] ?? []).length === 0 ? (
                      <p className="text-xs text-gray-400 py-3">No transactions on this account yet.</p>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {(creditHistory[c.id] ?? []).map(h => (
                          <div key={h.id} className="flex items-center gap-3 py-2 text-xs">
                            {h.type === 'draw' ? <ArrowUpRight size={12} className="text-amber-500 shrink-0" /> : <ArrowDownLeft size={12} className="text-green-600 shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className="text-gray-600 capitalize">{h.type}{h.orderNumber && ` · ${h.orderNumber}`}</p>
                              <p className="text-gray-400">{formatRelativeDate(h.date)}{h.notes && ` · ${h.notes}`}</p>
                            </div>
                            <span className={`font-mono font-medium ${h.type === 'draw' ? 'text-amber-700' : 'text-green-700'}`}>
                              {h.type === 'draw' ? '+' : '−'}{N(h.amount)} ETB
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}