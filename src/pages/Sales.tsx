import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { createSalesOrder, fetchOrdersWithMargins, recordPayment } from '../api/sales'
import { fetchCustomers, createCustomer } from '../api/customers'
import { fetchWarehousesList } from '../api/income'
import { fetchAccounts } from '../api/accounts'
import { recordCreditTransaction, openCreditAccount } from '../api/credit'
import type { Account } from '../api/accounts'
import { usePageState } from '../lib/pageState'
import {
  ShoppingCart, Loader2, Plus, X, Check, AlertTriangle, CheckCircle2,
  Package, Minus, Trash2, TrendingUp, Search,
} from 'lucide-react'

interface Customer { id: string; name: string; type: string | null; outstanding_etb: number }
interface Product { id: string; name: string; sku: string; image_url: string | null }
interface Option { id: string; name: string }
interface CreditAcct { id: string; customer_id: string; credit_limit: number; balance: number; due_date: string; status: string }
interface CartLine { productId: string; quantity: number; unitPriceEtb: number }

interface OrderRow {
  id: string; order_number: string; invoice_number: string | null; sale_date: string; status: string
  total_etb: number; paid_amount: number; gross_profit_etb: number | null; gross_margin_pct: number | null
  customers: { name: string } | { name: string }[] | null
}

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))
const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Transfer' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'credit', label: 'Credit' },
]

const STATUS_CLS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600', CONFIRMED: 'bg-blue-50 text-blue-700',
  INVOICED: 'bg-amber-50 text-amber-700', PARTIAL: 'bg-amber-50 text-amber-700',
  PAID: 'bg-green-50 text-green-700', CANCELLED: 'bg-red-50 text-red-700',
}

function oneName(c: OrderRow['customers']): string {
  if (!c) return '—'
  return Array.isArray(c) ? (c[0]?.name ?? '—') : c.name
}

export function Sales() {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [lastPriceByProduct, setLastPriceByProduct] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [customerId, setCustomerId] = usePageState('sales.customerId', '')
  const [warehouseId, setWarehouseId] = usePageState('sales.warehouseId', '')
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0])
  const [cart, setCart] = useState<CartLine[]>([])
  const [itemQuery, setItemQuery] = useState('')
  const [payNow, setPayNow] = useState(true)
  const [method, setMethod] = useState<'cash' | 'bank_transfer' | 'mobile_money' | 'credit'>('cash')
  const [accountId, setAccountId] = useState('')
  const [creditAccountId, setCreditAccountId] = useState('')
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [justCreatedCustomerId, setJustCreatedCustomerId] = useState<string | null>(null)
  const [stockByProduct, setStockByProduct] = useState<Record<string, number>>({})
  const [listSearch, setListSearch] = usePageState('sales.listSearch', '')
  const [statusFilter, setStatusFilter] = usePageState('sales.statusFilter', '')
  const [customerFilter, setCustomerFilter] = usePageState('sales.customerFilter', '')
  const [dateFrom, setDateFrom] = usePageState('sales.dateFrom', '')
  const [dateTo, setDateTo] = usePageState('sales.dateTo', '')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [orderRows, customerRows, productRows, warehouseRows, accountRows, lineRows] = await Promise.all([
        fetchOrdersWithMargins(50),
        fetchCustomers(),
        supabase.from('products').select('id, name, sku, image_url').eq('is_active', true).order('name'),
        fetchWarehousesList(),
        fetchAccounts(),
        // sales_order_lines has no created_at of its own — order by the
        // parent order's created_at instead to get the most recent price per product.
        supabase.from('sales_order_lines')
          .select('product_id, unit_price_etb, sales_orders!inner(created_at)')
          .order('created_at', { referencedTable: 'sales_orders', ascending: false })
          .limit(300),
      ])
      setOrders((orderRows ?? []) as any)
      setCustomers((customerRows ?? []).map((c: any) => ({ id: c.id, name: c.name, type: c.type, outstanding_etb: Number(c.outstanding_etb ?? 0) })))
      setProducts((productRows.data ?? []).map((p: any) => ({ id: p.id, name: p.name, sku: p.sku, image_url: p.image_url })))
      setWarehouses((warehouseRows ?? []).map((w: any) => ({ id: w.id, name: w.name })))
      setAccounts(accountRows)
      const priceMap: Record<string, number> = {}
      for (const l of (lineRows.data ?? []) as any[]) {
        if (!(l.product_id in priceMap)) priceMap[l.product_id] = Number(l.unit_price_etb ?? 0)
      }
      setLastPriceByProduct(priceMap)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load sales data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // credit_accounts query doesn't reliably expose customer_id when joined —
  // refetch it plainly scoped to the selected customer instead of trusting the map above.
  const [customerCreditAccounts, setCustomerCreditAccounts] = useState<CreditAcct[]>([])
  useEffect(() => {
    if (!customerId) { setCustomerCreditAccounts([]); return }
    supabase.from('credit_accounts').select('id, credit_limit, balance, due_date, status')
      .eq('customer_id', customerId).eq('status', 'active')
      .then(({ data }) => setCustomerCreditAccounts((data ?? []).map((c: any) => ({ ...c, customer_id: customerId }))))
  }, [customerId])

  // Available stock at the selected warehouse — shown per product so a
  // sale doesn't get built against stock that isn't actually there, only
  // to fail with an opaque RPC error on submit.
  useEffect(() => {
    if (!warehouseId) { setStockByProduct({}); return }
    supabase.from('current_inventory').select('product_id, quantity_on_hand')
      .eq('warehouse_id', warehouseId)
      .then(({ data }) => {
        const map: Record<string, number> = {}
        for (const row of (data ?? []) as any[]) map[row.product_id] = Number(row.quantity_on_hand ?? 0)
        setStockByProduct(map)
      })
  }, [warehouseId])

  function addToCart(productId: string) {
    if (cart.some(l => l.productId === productId)) return
    setCart(c => [...c, { productId, quantity: 1, unitPriceEtb: lastPriceByProduct[productId] ?? 0 }])
  }
  function updateCartLine(productId: string, patch: Partial<CartLine>) {
    setCart(c => c.map(l => l.productId === productId ? { ...l, ...patch } : l))
  }
  function removeCartLine(productId: string) {
    setCart(c => c.filter(l => l.productId !== productId))
  }

  const cartTotal = useMemo(() => cart.reduce((s, l) => s + l.quantity * l.unitPriceEtb, 0), [cart])

  function resetForm() {
    setCart([])
    setPayNow(true)
    setMethod('cash')
    setAccountId('')
    setCreditAccountId('')
    setJustCreatedCustomerId(null)
    setSaleDate(new Date().toISOString().split('T')[0])
  }

  async function addCustomer() {
    if (!newCustomerName.trim()) return
    const id = await createCustomer({ name: newCustomerName })
    setNewCustomerName('')
    setShowNewCustomer(false)
    await load()
    setCustomerId(id)
    setJustCreatedCustomerId(id)
  }

  async function submit() {
    if (!customerId) { setError('Choose a customer.'); return }
    if (!warehouseId) { setError('Choose a warehouse.'); return }
    if (cart.length === 0) { setError('Add at least one item.'); return }
    if (cart.some(l => l.quantity <= 0 || l.unitPriceEtb <= 0)) { setError('Every line needs a quantity and price greater than 0.'); return }
    if (payNow && method !== 'credit' && !accountId) { setError('Choose which account received the money.'); return }
    const shortLine = cart.find(l => l.quantity > (stockByProduct[l.productId] ?? 0))
    if (shortLine) {
      const p = products.find(x => x.id === shortLine.productId)
      setError(`Not enough stock at this warehouse for ${p?.name ?? 'this product'} — ${stockByProduct[shortLine.productId] ?? 0} available, ${shortLine.quantity} requested.`)
      return
    }

    setSaving(true); setError(null); setSuccess(null)
    try {
      // A customer created inline on this page can't have picked a credit
      // account yet (none exist). Open one automatically instead of
      // blocking the sale, sized to cover this order.
      let creditAcctId = creditAccountId
      if (payNow && method === 'credit' && !creditAcctId) {
        if (customerId === justCreatedCustomerId && customerCreditAccounts.length === 0) {
          const dueDate = new Date(saleDate)
          dueDate.setDate(dueDate.getDate() + 30)
          creditAcctId = await openCreditAccount(customerId, cartTotal, dueDate.toISOString().split('T')[0])
          setCreditAccountId(creditAcctId)
        } else {
          throw new Error('Choose which credit account this draws against, or open one for this customer first.')
        }
      }

      const result = await createSalesOrder({
        customer_id: customerId,
        warehouse_id: warehouseId,
        sale_date: saleDate,
        payment_terms: payNow && method !== 'credit' ? 'Immediate' : 'Credit',
        lines: cart.map(l => ({ product_id: l.productId, quantity: l.quantity, unit_price_etb: l.unitPriceEtb })),
      })

      // The order (and its stock deduction) is now committed. If the payment
      // step below fails, the order still exists — reporting a generic
      // "failed to record sale" and leaving the same cart on screen would
      // invite the user to resubmit and create a second, duplicate order.
      // Treat a payment failure as its own outcome: the order stands, close
      // the form, and point at Receivables to record payment manually.
      if (payNow) {
        try {
          if (method === 'credit') {
            await recordCreditTransaction(creditAcctId, 'draw', result.total_etb, {
              method, salesOrderId: result.order_id,
            })
          } else {
            await recordPayment(result.order_id, result.total_etb, method, { accountId })
          }
        } catch (payErr: any) {
          setError(`${result.order_number} was recorded, but the payment failed: ${payErr?.message ?? 'unknown error'}. Go to Receivables to record it — don't resubmit this sale.`)
          setOpen(false)
          resetForm()
          load()
          return
        }
      }

      setSuccess(`${result.order_number} recorded — ${N(result.total_etb)} ETB, margin ${result.gross_margin_pct?.toFixed(1) ?? '—'}%`)
      setOpen(false)
      resetForm()
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record sale.')
    } finally {
      setSaving(false)
    }
  }

  const selectedCustomer = customers.find(c => c.id === customerId)

  const orderStatuses = useMemo(() => [...new Set(orders.map(o => o.status))].sort(), [orders])
  const filteredOrders = useMemo(() => orders
    .filter(o => !statusFilter || o.status === statusFilter)
    .filter(o => !customerFilter || oneName(o.customers) === customerFilter)
    .filter(o => !dateFrom || o.sale_date >= dateFrom)
    .filter(o => !dateTo || o.sale_date <= dateTo)
    .filter(o => {
      if (!listSearch.trim()) return true
      const q = listSearch.trim().toLowerCase()
      return o.order_number.toLowerCase().includes(q)
        || (o.invoice_number ?? '').toLowerCase().includes(q)
        || oneName(o.customers).toLowerCase().includes(q)
    }),
    [orders, statusFilter, customerFilter, dateFrom, dateTo, listSearch])
  const hasListFilters = !!(listSearch || statusFilter || customerFilter || dateFrom || dateTo)
  function clearListFilters() {
    setListSearch(''); setStatusFilter(''); setCustomerFilter(''); setDateFrom(''); setDateTo('')
  }

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium flex items-center gap-2"><ShoppingCart size={18} /> Sales</h1>
          <p className="text-xs text-gray-400 mt-0.5">Record a sale — stock, payment, and customer credit update automatically</p>
        </div>
        <button
          onClick={() => { setOpen(true); setError(null); setSuccess(null) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={13} /> New sale
        </button>
      </div>

      {!open && error && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <AlertTriangle size={12} /> {error}
        </div>
      )}
      {success && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
          <CheckCircle2 size={12} /> {success}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16">
          <ShoppingCart size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No sales yet</p>
          <p className="text-xs text-gray-400">Record your first sale to start tracking revenue, margin, and stock.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input value={listSearch} onChange={e => setListSearch(e.target.value)}
                placeholder="Search order, invoice, customer"
                className="pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg w-52
                           focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white
                         focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">All statuses</option>
              {orderStatuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white
                         focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">All customers</option>
              {customers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
              <span>–</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
            </div>
            {hasListFilters && (
              <button onClick={clearListFilters} className="text-xs text-blue-600 hover:underline">Clear filters</button>
            )}
          </div>
          {filteredOrders.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No orders match this filter.</div>
          ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-3 px-4 py-2.5
                          bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">
            <div>Order</div>
            <div>Customer</div>
            <div>Date</div>
            <div className="text-right">Total</div>
            <div className="text-right">Margin</div>
            <div>Status</div>
          </div>
          {filteredOrders.map((o, i) => (
            <div key={o.id} className={`grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3 items-center text-sm ${i < filteredOrders.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <div>
                <p className="font-medium">{o.order_number}</p>
                {o.invoice_number && <p className="text-xs text-gray-400">{o.invoice_number}</p>}
              </div>
              <div className="text-xs text-gray-600">{oneName(o.customers)}</div>
              <div className="text-xs text-gray-500">{o.sale_date}</div>
              <div className="text-right font-mono text-xs">
                {N(o.total_etb)} ETB
                {o.paid_amount < o.total_etb && <p className="text-amber-600">{N(o.total_etb - o.paid_amount)} owed</p>}
              </div>
              <div className="text-right font-mono text-xs flex items-center justify-end gap-1">
                {o.gross_margin_pct !== null && (
                  <>
                    <TrendingUp size={10} className={o.gross_margin_pct >= 20 ? 'text-green-600' : 'text-amber-600'} />
                    {o.gross_margin_pct.toFixed(0)}%
                  </>
                )}
              </div>
              <div>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLS[o.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {o.status}
                </span>
              </div>
            </div>
          ))}
        </div>
          )}
        </>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-auto shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-medium">New sale</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Customer</label>
                  {showNewCustomer ? (
                    <div className="flex gap-1.5">
                      <input value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)}
                        placeholder="Customer name" autoFocus
                        className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      <button onClick={addCustomer} className="px-2.5 py-2 bg-blue-600 text-white rounded-lg text-xs"><Check size={14} /></button>
                      <button onClick={() => setShowNewCustomer(false)} className="px-2.5 py-2 border border-gray-200 rounded-lg text-xs"><X size={14} /></button>
                    </div>
                  ) : (
                    <div className="flex gap-1.5">
                      <select value={customerId} onChange={e => setCustomerId(e.target.value)}
                        className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                        <option value="">Select…</option>
                        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <button onClick={() => setShowNewCustomer(true)} title="New customer"
                        className="px-2.5 py-2 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50"><Plus size={14} /></button>
                    </div>
                  )}
                  {selectedCustomer && selectedCustomer.outstanding_etb > 0 && (
                    <p className="text-xs text-amber-600 mt-1">Already owes {N(selectedCustomer.outstanding_etb)} ETB</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Warehouse</label>
                  <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="">Select…</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Date</label>
                <input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Items</label>
                {!warehouseId && (
                  <p className="text-xs text-amber-600 mb-1.5">Choose a warehouse to see available stock.</p>
                )}
                <div className="relative mb-1.5">
                  <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={itemQuery} onChange={e => setItemQuery(e.target.value)} placeholder="Search products…"
                    className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
                </div>
                <div className="grid grid-cols-5 gap-2 max-h-32 overflow-y-auto p-1 mb-2 border border-gray-100 rounded-lg">
                  {products.filter(p => p.name.toLowerCase().includes(itemQuery.toLowerCase()) || p.sku?.toLowerCase().includes(itemQuery.toLowerCase())).map(p => {
                    const stock = stockByProduct[p.id] ?? 0
                    const outOfStock = !!warehouseId && stock <= 0
                    return (
                      <button key={p.id} type="button" onClick={() => addToCart(p.id)}
                        disabled={cart.some(l => l.productId === p.id) || outOfStock}
                        title={outOfStock ? 'Out of stock at this warehouse' : undefined}
                        className="flex flex-col items-center gap-1 p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 text-center">
                        <div className="w-9 h-9 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center">
                          {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <Package size={14} className="text-gray-300" />}
                        </div>
                        <span className="text-[10px] leading-tight line-clamp-2">{p.name}</span>
                        {warehouseId && (
                          <span className={`text-[9px] font-mono ${outOfStock ? 'text-red-500' : stock < 20 ? 'text-amber-600' : 'text-gray-400'}`}>
                            {outOfStock ? 'Out of stock' : `${N(stock)} in stock`}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>

                {cart.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-3">Tap items above to add them</p>
                ) : (
                  <div className="space-y-2">
                    {cart.map(line => {
                      const p = products.find(x => x.id === line.productId)
                      const available = stockByProduct[line.productId] ?? 0
                      const exceeds = line.quantity > available
                      return (
                        <div key={line.productId} className="bg-gray-50 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="flex-1 text-xs font-medium truncate">{p?.name ?? '—'}</span>
                            <button onClick={() => updateCartLine(line.productId, { quantity: Math.max(1, line.quantity - 1) })}
                              className="p-1 text-gray-400 hover:text-gray-600"><Minus size={12} /></button>
                            <input type="number" value={line.quantity} min={1}
                              onChange={e => updateCartLine(line.productId, { quantity: Math.max(1, Number(e.target.value)) })}
                              className={`w-12 px-1 py-1 text-xs font-mono border rounded text-center ${exceeds ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200'}`} />
                            <button onClick={() => updateCartLine(line.productId, { quantity: line.quantity + 1 })}
                              className="p-1 text-gray-400 hover:text-gray-600"><Plus size={12} /></button>
                            <span className="text-xs text-gray-400">×</span>
                            <input type="number" value={line.unitPriceEtb} min={0}
                              onChange={e => updateCartLine(line.productId, { unitPriceEtb: Number(e.target.value) })}
                              className="w-20 px-1.5 py-1 text-xs font-mono border border-gray-200 rounded" placeholder="Price" />
                            <span className="text-xs font-mono w-16 text-right">{N(line.quantity * line.unitPriceEtb)}</span>
                            <button onClick={() => removeCartLine(line.productId)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                          </div>
                          {exceeds && warehouseId && (
                            <p className="text-xs text-red-600 mt-1">Only {N(available)} available at this warehouse.</p>
                          )}
                        </div>
                      )
                    })}
                    <div className="flex justify-end px-3 pt-1">
                      <span className="text-sm font-medium">Total: <span className="font-mono text-blue-700">{N(cartTotal)} ETB</span></span>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-gray-100 pt-3">
                <label className="flex items-center gap-2 text-sm text-gray-700 mb-2">
                  <input type="checkbox" checked={payNow} onChange={e => setPayNow(e.target.checked)} />
                  Payment received now
                </label>
                {payNow ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Method</label>
                      <select value={method} onChange={e => setMethod(e.target.value as any)}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                        {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </div>
                    {method === 'credit' ? (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Credit account</label>
                        <select value={creditAccountId} onChange={e => setCreditAccountId(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                          <option value="">Select…</option>
                          {customerCreditAccounts.map(c => (
                            <option key={c.id} value={c.id}>{N(c.balance)}/{N(c.credit_limit)} ETB · due {c.due_date}</option>
                          ))}
                        </select>
                        {customerId && customerCreditAccounts.length === 0 && (
                          customerId === justCreatedCustomerId ? (
                            <p className="text-xs text-blue-600 mt-1">A credit account will be opened automatically for this new customer.</p>
                          ) : (
                            <p className="text-xs text-amber-600 mt-1">No credit account for this customer — open one in Credit Accounts first.</p>
                          )
                        )}
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Account received</label>
                        <select value={accountId} onChange={e => setAccountId(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                          <option value="">Select…</option>
                          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">Sale will be invoiced and left unpaid — record payment later from Receivables.</p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={submit} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 min-w-[130px] justify-center">
                {saving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : `Record sale · ${N(cartTotal)} ETB`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
