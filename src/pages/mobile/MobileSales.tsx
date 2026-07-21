import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { createSalesOrder, fetchOrdersWithMargins, recordPayment } from '../../api/sales'
import { fetchCustomers, createCustomer } from '../../api/customers'
import { fetchWarehousesList } from '../../api/income'
import { fetchAccounts } from '../../api/accounts'
import { recordCreditTransaction, openCreditAccount } from '../../api/credit'
import type { Account } from '../../api/accounts'
import {
  ShoppingCart, Plus, X, Loader2, Package, Minus, Trash2, ChevronLeft, Check, Search,
} from 'lucide-react'
import { HawalaFields, emptyHawalaValue } from '../../components/HawalaFields'

interface Customer { id: string; name: string }
interface Product { id: string; name: string; sku: string; image_url: string | null }
interface Option { id: string; name: string }
interface CartLine { productId: string; quantity: number; unitPriceEtb: number }
interface OrderRow { id: string; order_number: string; sale_date: string; status: string; total_etb: number; paid_amount: number; customers: { name: string } | { name: string }[] | null }

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))
const STATUS_CLS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600', CONFIRMED: 'bg-blue-50 text-blue-700',
  INVOICED: 'bg-amber-50 text-amber-700', PARTIAL: 'bg-amber-50 text-amber-700',
  PAID: 'bg-green-50 text-green-700', CANCELLED: 'bg-red-50 text-red-700',
}

function oneName(c: OrderRow['customers']): string {
  if (!c) return '—'
  return Array.isArray(c) ? (c[0]?.name ?? '—') : c.name
}

export function MobileSales() {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [customerId, setCustomerId] = useState('')
  const [newCustomerName, setNewCustomerName] = useState('')
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [warehouseId, setWarehouseId] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [itemQuery, setItemQuery] = useState('')
  const [stockByProduct, setStockByProduct] = useState<Record<string, number>>({})
  const [method, setMethod] = useState<'cash' | 'bank_transfer' | 'mobile_money' | 'credit' | 'hawala'>('cash')
  const [hawala, setHawala] = useState(emptyHawalaValue())
  const [accountId, setAccountId] = useState('')
  const [creditAccountId, setCreditAccountId] = useState('')
  const [customerCredit, setCustomerCredit] = useState<{ id: string; balance: number; credit_limit: number }[]>([])

  async function load() {
    setLoading(true)
    try {
      const [orderRows, customerRows, productRows, warehouseRows, accountRows] = await Promise.all([
        fetchOrdersWithMargins(30),
        fetchCustomers(),
        supabase.from('products').select('id, name, sku, image_url').eq('is_active', true).order('name'),
        fetchWarehousesList(),
        fetchAccounts(),
      ])
      setOrders((orderRows ?? []) as any)
      setCustomers((customerRows ?? []).map((c: any) => ({ id: c.id, name: c.name })))
      setProducts((productRows.data ?? []).map((p: any) => ({ id: p.id, name: p.name, sku: p.sku, image_url: p.image_url })))
      setWarehouses((warehouseRows ?? []).map((w: any) => ({ id: w.id, name: w.name })))
      setAccounts(accountRows ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!warehouseId) { setStockByProduct({}); return }
    supabase.from('current_inventory').select('product_id, quantity_on_hand').eq('warehouse_id', warehouseId)
      .then(({ data }) => {
        const map: Record<string, number> = {}
        for (const row of (data ?? []) as any[]) map[row.product_id] = Number(row.quantity_on_hand ?? 0)
        setStockByProduct(map)
      })
  }, [warehouseId])

  useEffect(() => {
    if (!customerId) { setCustomerCredit([]); return }
    supabase.from('credit_accounts').select('id, balance, credit_limit').eq('customer_id', customerId).eq('status', 'active')
      .then(({ data }) => setCustomerCredit((data ?? []) as any))
  }, [customerId])

  const cartTotal = useMemo(() => cart.reduce((s, l) => s + l.quantity * l.unitPriceEtb, 0), [cart])

  function addToCart(productId: string) {
    if (cart.some(l => l.productId === productId)) return
    setCart(c => [...c, { productId, quantity: 1, unitPriceEtb: 0 }])
  }
  function updateLine(productId: string, patch: Partial<CartLine>) {
    setCart(c => c.map(l => l.productId === productId ? { ...l, ...patch } : l))
  }
  function removeLine(productId: string) {
    setCart(c => c.filter(l => l.productId !== productId))
  }

  function resetForm() {
    setCustomerId(''); setWarehouseId(''); setCart([]); setMethod('cash')
    setAccountId(''); setCreditAccountId(''); setShowNewCustomer(false); setNewCustomerName('')
  }

  async function addCustomer() {
    if (!newCustomerName.trim()) return
    setSaving(true)
    try {
      const id = await createCustomer({ name: newCustomerName })
      setNewCustomerName(''); setShowNewCustomer(false)
      await load()
      setCustomerId(id)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to add customer.')
    } finally {
      setSaving(false)
    }
  }

  async function submit() {
    if (!customerId) { setError('Choose a customer.'); return }
    if (!warehouseId) { setError('Choose a warehouse.'); return }
    if (cart.length === 0) { setError('Add at least one item.'); return }
    if (cart.some(l => l.quantity <= 0 || l.unitPriceEtb <= 0)) { setError('Every item needs a quantity and price.'); return }
    if (method !== 'credit' && !accountId) { setError('Choose which account received the money.'); return }
    const shortLine = cart.find(l => l.quantity > (stockByProduct[l.productId] ?? 0))
    if (shortLine) {
      const p = products.find(x => x.id === shortLine.productId)
      setError(`Not enough stock of ${p?.name ?? 'this item'} at this warehouse.`)
      return
    }

    setSaving(true); setError(null); setSuccess(null)
    try {
      let creditAcctId = creditAccountId
      if (method === 'credit' && !creditAcctId) {
        if (customerCredit.length === 0) {
          const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 30)
          creditAcctId = await openCreditAccount(customerId, cartTotal, dueDate.toISOString().split('T')[0])
        } else {
          throw new Error('Choose a credit account for this customer.')
        }
      }

      const result = await createSalesOrder({
        customer_id: customerId, warehouse_id: warehouseId, sale_date: new Date().toISOString().split('T')[0],
        payment_terms: method !== 'credit' ? 'Immediate' : 'Credit',
        lines: cart.map(l => ({ product_id: l.productId, quantity: l.quantity, unit_price_etb: l.unitPriceEtb })),
      })

      try {
        if (method === 'credit') {
          await recordCreditTransaction(creditAcctId, 'draw', result.total_etb, { method, salesOrderId: result.order_id })
        } else {
          await recordPayment(result.order_id, result.total_etb, method, { accountId, hawalaRoute: method === 'hawala' ? hawala.route.trim() || undefined : undefined })
        }
      } catch (payErr: any) {
        setError(`${result.order_number} was recorded, but the payment failed: ${payErr?.message ?? 'unknown error'}.`)
        setOpen(false); resetForm(); load()
        return
      }

      setSuccess(`${result.order_number} — ${N(result.total_etb)} ETB recorded`)
      setOpen(false); resetForm(); load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record sale.')
    } finally {
      setSaving(false)
    }
  }

  if (open) {
    return (
      <div className="fixed inset-0 bg-white z-40 flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <button onClick={() => setOpen(false)}><ChevronLeft size={20} className="text-gray-500" /></button>
          <h1 className="text-base font-medium flex-1">New sale</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

          <div>
            <label className="block text-xs text-gray-500 mb-1">Customer</label>
            {showNewCustomer ? (
              <div className="flex gap-2">
                <input value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} placeholder="Customer name" autoFocus
                  className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-xl" />
                <button onClick={addCustomer} disabled={saving} className="px-3 bg-blue-600 text-white rounded-xl"><Check size={16} /></button>
                <button onClick={() => setShowNewCustomer(false)} className="px-3 border border-gray-200 rounded-xl"><X size={16} /></button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select value={customerId} onChange={e => setCustomerId(e.target.value)}
                  className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white">
                  <option value="">Select…</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button onClick={() => setShowNewCustomer(true)} className="px-3 border border-gray-200 rounded-xl text-gray-500"><Plus size={16} /></button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Warehouse</label>
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white">
              <option value="">Select…</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Items</label>
            {!warehouseId && <p className="text-xs text-amber-600 mb-1.5">Choose a warehouse to see stock.</p>}
            <div className="relative mb-1.5">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={itemQuery} onChange={e => setItemQuery(e.target.value)} placeholder="Search products…"
                className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
            </div>
            <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1 border border-gray-100 rounded-xl mb-2">
              {products.filter(p => p.name.toLowerCase().includes(itemQuery.toLowerCase()) || p.sku?.toLowerCase().includes(itemQuery.toLowerCase())).map(p => {
                const stock = stockByProduct[p.id] ?? 0
                const outOfStock = !!warehouseId && stock <= 0
                return (
                  <button key={p.id} onClick={() => addToCart(p.id)} disabled={cart.some(l => l.productId === p.id) || outOfStock}
                    className="flex flex-col items-center gap-1 p-2 rounded-xl border border-gray-200 active:bg-gray-50 disabled:opacity-30 text-center">
                    <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center">
                      {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <Package size={16} className="text-gray-300" />}
                    </div>
                    <span className="text-[10px] leading-tight line-clamp-2">{p.name}</span>
                    {warehouseId && <span className={`text-[9px] font-mono ${outOfStock ? 'text-red-500' : 'text-gray-400'}`}>{outOfStock ? 'out' : stock}</span>}
                  </button>
                )
              })}
            </div>

            {cart.map(line => {
              const p = products.find(x => x.id === line.productId)
              return (
                <div key={line.productId} className="bg-gray-50 rounded-xl px-3 py-2.5 mb-2">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="flex-1 text-sm font-medium truncate">{p?.name}</span>
                    <button onClick={() => removeLine(line.productId)} className="text-gray-400"><Trash2 size={14} /></button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateLine(line.productId, { quantity: Math.max(1, line.quantity - 1) })}
                      className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center"><Minus size={14} /></button>
                    <input type="number" value={line.quantity} min={1}
                      onChange={e => updateLine(line.productId, { quantity: Math.max(1, Number(e.target.value)) })}
                      className="w-12 h-8 text-center text-sm border border-gray-200 rounded-lg" />
                    <button onClick={() => updateLine(line.productId, { quantity: line.quantity + 1 })}
                      className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center"><Plus size={14} /></button>
                    <input type="number" value={line.unitPriceEtb || ''} placeholder="Price"
                      onChange={e => updateLine(line.productId, { unitPriceEtb: Number(e.target.value) })}
                      className="flex-1 h-8 px-2 text-sm border border-gray-200 rounded-lg font-mono" />
                  </div>
                </div>
              )
            })}
            {cart.length > 0 && (
              <p className="text-right text-sm font-medium">Total: <span className="font-mono text-blue-700">{N(cartTotal)} ETB</span></p>
            )}
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Payment method</label>
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {(['cash', 'bank_transfer', 'mobile_money', 'credit', 'hawala'] as const).map(m => (
                <button key={m} onClick={() => setMethod(m)}
                  className={`py-2 text-xs rounded-lg border capitalize ${method === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-600'}`}>
                  {m.replace('_', ' ')}
                </button>
              ))}
            </div>
            {method === 'credit' ? (
              customerCredit.length > 0 ? (
                <select value={creditAccountId} onChange={e => setCreditAccountId(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white">
                  <option value="">Select credit account…</option>
                  {customerCredit.map(c => <option key={c.id} value={c.id}>{N(c.balance)}/{N(c.credit_limit)} ETB</option>)}
                </select>
              ) : (
                <p className="text-xs text-blue-600">A credit account will be opened automatically for this customer.</p>
              )
            ) : (
              <select value={accountId} onChange={e => setAccountId(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white">
                <option value="">Which account received it?</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            {method === 'hawala' && <div className="mt-2"><HawalaFields value={hawala} onChange={setHawala} /></div>}
          </div>
        </div>
        <div className="p-4 border-t border-gray-100 shrink-0">
          <button onClick={submit} disabled={saving}
            className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {saving ? 'Saving…' : `Record sale · ${N(cartTotal)} ETB`}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 pb-6 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold flex items-center gap-2"><ShoppingCart size={18} /> Sales</h1>
        <button onClick={() => { setOpen(true); setError(null); setSuccess(null) }}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-xs rounded-xl">
          <Plus size={14} /> New sale
        </button>
      </div>

      {success && <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">{success}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400">No sales yet — tap "New sale" to record one.</div>
      ) : (
        <div className="space-y-2">
          {orders.map(o => (
            <div key={o.id} className="bg-white border border-gray-200 rounded-2xl p-3.5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium">{oneName(o.customers)}</p>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_CLS[o.status] ?? 'bg-gray-100 text-gray-600'}`}>{o.status}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>{o.order_number} · {o.sale_date}</span>
                <span className="font-mono text-gray-700">{N(o.total_etb)} ETB</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
