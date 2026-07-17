import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { createSalesOrder, recordPayment } from '../../api/sales'
import { fetchCustomers } from '../../api/customers'
import { fetchWarehousesList } from '../../api/income'
import { recordQuickIncome } from '../../api/income'
import { recordCompanyExpense } from '../../api/companyExpenses'
import { fetchAccounts } from '../../api/accounts'
import { recordCreditTransaction, openCreditAccount } from '../../api/credit'
import { logProductionQuick } from '../../lib/productionLogging'
import { SearchableSelect } from '../SearchableSelect'
import {
  ShoppingCart, Banknote, Receipt, Wrench, X, Loader2, Check, Plus, Minus, Package, Trash2, Search,
} from 'lucide-react'

interface Option { id: string; name: string }
interface Product { id: string; name: string; image_url: string | null }
interface CartLine { productId: string; quantity: number; unitPriceEtb: number }

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

function ModalShell({ title, icon: Icon, color, onClose, children, footer }: {
  title: string; icon: typeof ShoppingCart; color: string; onClose: () => void
  children: React.ReactNode; footer: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-sm font-medium flex items-center gap-2"><Icon size={16} className={color} /> {title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">{children}</div>
        <div className="px-5 py-4 border-t border-gray-100 shrink-0">{footer}</div>
      </div>
    </div>
  )
}

function QuickSaleModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [customers, setCustomers] = useState<Option[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [accounts, setAccounts] = useState<Option[]>([])
  const [customerId, setCustomerId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [stockByProduct, setStockByProduct] = useState<Record<string, number>>({})
  const [method, setMethod] = useState<'cash' | 'bank_transfer' | 'mobile_money' | 'credit'>('cash')
  const [accountId, setAccountId] = useState('')
  const [creditAccounts, setCreditAccounts] = useState<{ id: string; balance: number; credit_limit: number }[]>([])
  const [creditAccountId, setCreditAccountId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [itemQuery, setItemQuery] = useState('')

  useEffect(() => {
    Promise.all([
      fetchCustomers(), fetchWarehousesList(),
      supabase.from('products').select('id, name, image_url').eq('is_active', true).order('name'),
      fetchAccounts(),
    ]).then(([c, w, p, a]) => {
      setCustomers((c ?? []).map((x: any) => ({ id: x.id, name: x.name })))
      setWarehouses((w ?? []).map((x: any) => ({ id: x.id, name: x.name })))
      setProducts((p.data ?? []).map((x: any) => ({ id: x.id, name: x.name, image_url: x.image_url })))
      setAccounts(a ?? [])
    }).catch(e => setError(e?.message ?? 'Failed to load.'))
  }, [])

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
    if (!customerId) { setCreditAccounts([]); return }
    supabase.from('credit_accounts').select('id, balance, credit_limit').eq('customer_id', customerId).eq('status', 'active')
      .then(({ data }) => setCreditAccounts((data ?? []) as any))
  }, [customerId])

  const cartTotal = useMemo(() => cart.reduce((s, l) => s + l.quantity * l.unitPriceEtb, 0), [cart])

  function addToCart(id: string) {
    if (cart.some(l => l.productId === id)) return
    setCart(c => [...c, { productId: id, quantity: 1, unitPriceEtb: 0 }])
  }
  function update(id: string, patch: Partial<CartLine>) {
    setCart(c => c.map(l => l.productId === id ? { ...l, ...patch } : l))
  }

  async function submit() {
    if (!customerId) { setError('Choose a customer.'); return }
    if (!warehouseId) { setError('Choose a warehouse.'); return }
    if (cart.length === 0) { setError('Add at least one item.'); return }
    if (cart.some(l => l.quantity <= 0 || l.unitPriceEtb <= 0)) { setError('Every item needs quantity and price.'); return }
    if (method !== 'credit' && !accountId) { setError('Choose which account received the money.'); return }
    const short = cart.find(l => l.quantity > (stockByProduct[l.productId] ?? 0))
    if (short) { setError('Not enough stock for one of the items at this warehouse.'); return }

    setSaving(true); setError(null)
    try {
      let creditAcctId = creditAccountId
      if (method === 'credit' && !creditAcctId) {
        if (creditAccounts.length === 0) {
          const due = new Date(); due.setDate(due.getDate() + 30)
          creditAcctId = await openCreditAccount(customerId, cartTotal, due.toISOString().split('T')[0])
        } else {
          throw new Error('Choose a credit account.')
        }
      }
      const result = await createSalesOrder({
        customer_id: customerId, warehouse_id: warehouseId, sale_date: new Date().toISOString().split('T')[0],
        payment_terms: method !== 'credit' ? 'Immediate' : 'Credit',
        lines: cart.map(l => ({ product_id: l.productId, quantity: l.quantity, unit_price_etb: l.unitPriceEtb })),
      })
      try {
        if (method === 'credit') await recordCreditTransaction(creditAcctId, 'draw', result.total_etb, { method, salesOrderId: result.order_id })
        else await recordPayment(result.order_id, result.total_etb, method, { accountId })
      } catch (payErr: any) {
        setError(`${result.order_number} was recorded, but payment failed: ${payErr?.message}. Don't resubmit.`)
        onDone()
        return
      }
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record sale.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title="Record a sale" icon={ShoppingCart} color="text-blue-600" onClose={onClose} footer={
      <button onClick={submit} disabled={saving} className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {saving ? 'Saving…' : `Record sale · ${N(cartTotal)} ETB`}
      </button>
    }>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">Customer…</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">Warehouse…</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      {products.length > 8 && (
        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={itemQuery} onChange={e => setItemQuery(e.target.value)} placeholder="Search products…"
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg" />
        </div>
      )}
      <div className="grid grid-cols-4 gap-1.5 max-h-32 overflow-y-auto p-1 border border-gray-100 rounded-lg">
        {products.filter(p => p.name.toLowerCase().includes(itemQuery.toLowerCase())).map(p => {
          const stock = stockByProduct[p.id] ?? 0
          const out = !!warehouseId && stock <= 0
          return (
            <button key={p.id} onClick={() => addToCart(p.id)} disabled={cart.some(l => l.productId === p.id) || out}
              className="flex flex-col items-center gap-1 p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 text-center">
              <div className="w-8 h-8 rounded bg-gray-100 overflow-hidden flex items-center justify-center">
                {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <Package size={12} className="text-gray-300" />}
              </div>
              <span className="text-[9px] leading-tight line-clamp-2">{p.name}</span>
            </button>
          )
        })}
      </div>
      {cart.map(l => (
        <div key={l.productId} className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-2 py-1.5">
          <span className="flex-1 text-xs truncate">{products.find(p => p.id === l.productId)?.name}</span>
          <button onClick={() => update(l.productId, { quantity: Math.max(1, l.quantity - 1) })} className="p-1 text-gray-400"><Minus size={11} /></button>
          <input type="number" value={l.quantity} onChange={e => update(l.productId, { quantity: Math.max(1, Number(e.target.value)) })} className="w-9 text-center text-xs border border-gray-200 rounded" />
          <button onClick={() => update(l.productId, { quantity: l.quantity + 1 })} className="p-1 text-gray-400"><Plus size={11} /></button>
          <input type="number" placeholder="Price" value={l.unitPriceEtb || ''} onChange={e => update(l.productId, { unitPriceEtb: Number(e.target.value) })} className="w-16 text-xs border border-gray-200 rounded px-1 py-1 font-mono" />
          <button onClick={() => setCart(c => c.filter(x => x.productId !== l.productId))} className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
        </div>
      ))}
      <div className="flex gap-1.5">
        {(['cash', 'bank_transfer', 'mobile_money', 'credit'] as const).map(m => (
          <button key={m} onClick={() => setMethod(m)} className={`flex-1 py-1.5 text-[10px] rounded-lg border capitalize ${method === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-600'}`}>{m.replace('_', ' ')}</button>
        ))}
      </div>
      {method === 'credit' ? (
        creditAccounts.length > 0 ? (
          <select value={creditAccountId} onChange={e => setCreditAccountId(e.target.value)} className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white">
            <option value="">Credit account…</option>
            {creditAccounts.map(c => <option key={c.id} value={c.id}>{N(c.balance)}/{N(c.credit_limit)} ETB</option>)}
          </select>
        ) : <p className="text-xs text-blue-600">A credit account will be opened automatically.</p>
      ) : (
        <select value={accountId} onChange={e => setAccountId(e.target.value)} className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">Which account received it?</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
    </ModalShell>
  )
}

function QuickPaymentModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [customers, setCustomers] = useState<Option[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [accounts, setAccounts] = useState<Option[]>([])
  const [customerId, setCustomerId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'bank_transfer' | 'mobile_money' | 'credit'>('cash')
  const [accountId, setAccountId] = useState('')
  const [creditAccounts, setCreditAccounts] = useState<{ id: string; balance: number; credit_limit: number }[]>([])
  const [creditAccountId, setCreditAccountId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchCustomers(), fetchWarehousesList(), fetchAccounts()]).then(([c, w, a]) => {
      setCustomers((c ?? []).map((x: any) => ({ id: x.id, name: x.name })))
      setWarehouses((w ?? []).map((x: any) => ({ id: x.id, name: x.name })))
      setAccounts(a ?? [])
    }).catch(e => setError(e?.message ?? 'Failed to load.'))
  }, [])

  useEffect(() => {
    if (!customerId) { setCreditAccounts([]); return }
    supabase.from('credit_accounts').select('id, balance, credit_limit').eq('customer_id', customerId).eq('status', 'active')
      .then(({ data }) => setCreditAccounts((data ?? []) as any))
  }, [customerId])

  async function submit() {
    const amt = Number(amount)
    if (!customerId) { setError('Choose a customer.'); return }
    if (!warehouseId) { setError('Choose a warehouse.'); return }
    if (!amt || amt <= 0) { setError('Enter an amount.'); return }
    if (method === 'credit' && !creditAccountId) { setError('Choose a credit account.'); return }
    if (method !== 'credit' && !accountId) { setError('Choose which account received it.'); return }
    setSaving(true); setError(null)
    try {
      await recordQuickIncome({
        customerId, warehouseId, amount: amt, method,
        creditAccountId: method === 'credit' ? creditAccountId : undefined,
        accountId: method !== 'credit' ? accountId : undefined,
        date: new Date().toISOString().split('T')[0],
      })
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record payment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title="Record a payment" icon={Banknote} color="text-green-600" onClose={onClose} footer={
      <button onClick={submit} disabled={saving} className="w-full py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {saving ? 'Saving…' : 'Record payment'}
      </button>
    }>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white">
        <option value="">Which customer?</option>
        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white">
        <option value="">Which warehouse?</option>
        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (ETB)" className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg" />
      <div className="flex gap-1.5">
        {(['cash', 'bank_transfer', 'mobile_money', 'credit'] as const).map(m => (
          <button key={m} onClick={() => setMethod(m)} className={`flex-1 py-1.5 text-[10px] rounded-lg border capitalize ${method === m ? 'bg-green-600 text-white border-green-600' : 'bg-white border-gray-200 text-gray-600'}`}>{m.replace('_', ' ')}</button>
        ))}
      </div>
      {method === 'credit' ? (
        <select value={creditAccountId} onChange={e => setCreditAccountId(e.target.value)} className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">Which credit account?</option>
          {creditAccounts.map(c => <option key={c.id} value={c.id}>{N(c.balance)}/{N(c.credit_limit)} ETB</option>)}
        </select>
      ) : (
        <select value={accountId} onChange={e => setAccountId(e.target.value)} className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white">
          <option value="">Which account received it?</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
    </ModalShell>
  )
}

function QuickExpenseModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [accounts, setAccounts] = useState<Option[]>([])
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { fetchAccounts().then(a => setAccounts(a ?? [])).catch(() => {}) }, [])

  async function submit() {
    const amt = Number(amount)
    if (!description.trim()) { setError('What was this for?'); return }
    if (!amt || amt <= 0) { setError('Enter an amount.'); return }
    if (!accountId) { setError('Choose which account paid it.'); return }
    setSaving(true); setError(null)
    try {
      await recordCompanyExpense({
        category: 'other', description, amount: amt, currency: 'ETB', method: 'cash',
        expenseDate: new Date().toISOString().split('T')[0], accountId,
      })
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to record expense.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title="Record an expense" icon={Receipt} color="text-red-600" onClose={onClose} footer={
      <button onClick={submit} disabled={saving} className="w-full py-2.5 rounded-xl bg-red-600 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {saving ? 'Saving…' : 'Record expense'}
      </button>
    }>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What was this for?" className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg" />
      <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (ETB)" className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg" />
      <select value={accountId} onChange={e => setAccountId(e.target.value)} className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white">
        <option value="">Which account paid it?</option>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </ModalShell>
  )
}

function QuickProductionModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [boms, setBoms] = useState<{ id: string; productName: string }[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [bomId, setBomId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetchWarehousesList(),
      supabase.from('bom_headers').select('id, name, product_id, finished_product_id').eq('is_active', true),
    ]).then(async ([w, bomRes]) => {
      setWarehouses((w ?? []).map((x: any) => ({ id: x.id, name: x.name })))
      const rows = bomRes.data ?? []
      const productIds = [...new Set(rows.map((r: any) => r.product_id ?? r.finished_product_id).filter(Boolean))]
      const { data: products } = productIds.length > 0 ? await supabase.from('products').select('id, name').in('id', productIds) : { data: [] }
      const nameById = new Map((products ?? []).map((p: any) => [p.id, p.name]))
      setBoms(rows.map((r: any) => ({ id: r.id, productName: nameById.get(r.product_id ?? r.finished_product_id) ?? 'Unknown product' })))
    }).catch(e => setError(e?.message ?? 'Failed to load.'))
  }, [])

  async function submit() {
    const qty = Number(quantity)
    if (!warehouseId) { setError('Choose a warehouse.'); return }
    if (!bomId) { setError('Choose a product.'); return }
    if (!qty || qty <= 0) { setError('Enter a quantity.'); return }
    setSaving(true); setError(null)
    try {
      await logProductionQuick(bomId, warehouseId, qty, undefined, new Date().toISOString().split('T')[0])
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to log production.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title="Record factory performance" icon={Wrench} color="text-amber-600" onClose={onClose} footer={
      <button onClick={submit} disabled={saving} className="w-full py-2.5 rounded-xl bg-amber-600 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {saving ? 'Saving…' : 'Log production'}
      </button>
    }>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg bg-white">
        <option value="">Which warehouse?</option>
        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <SearchableSelect
        options={boms.map(b => ({ id: b.id, label: b.productName }))}
        value={bomId}
        onChange={setBomId}
        placeholder="Which product?"
      />
      <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="Quantity produced today" className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg" />
    </ModalShell>
  )
}

export function QuickActions({ onChanged }: { onChanged: () => void }) {
  const [active, setActive] = useState<'sale' | 'payment' | 'expense' | 'production' | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  function done(message: string) {
    setActive(null)
    setSuccess(message)
    onChanged()
    setTimeout(() => setSuccess(null), 4000)
  }

  const actions = [
    { key: 'sale' as const, label: 'Add sale', icon: ShoppingCart, color: 'bg-blue-600' },
    { key: 'payment' as const, label: 'Record payment', icon: Banknote, color: 'bg-green-600' },
    { key: 'expense' as const, label: 'Add expense', icon: Receipt, color: 'bg-red-600' },
    { key: 'production' as const, label: 'Factory performance', icon: Wrench, color: 'bg-amber-600' },
  ]

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs font-medium text-gray-500 mb-3">Quick actions</p>
      {success && <p className="text-xs text-green-700 bg-green-50 rounded-lg px-2.5 py-2 mb-3">{success}</p>}
      <div className="space-y-2">
        {actions.map(a => (
          <button key={a.key} onClick={() => setActive(a.key)}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-white text-xs font-medium ${a.color} hover:opacity-90 transition-opacity`}>
            <a.icon size={14} /> {a.label}
          </button>
        ))}
      </div>

      {active === 'sale' && <QuickSaleModal onClose={() => setActive(null)} onDone={() => done('Sale recorded.')} />}
      {active === 'payment' && <QuickPaymentModal onClose={() => setActive(null)} onDone={() => done('Payment recorded.')} />}
      {active === 'expense' && <QuickExpenseModal onClose={() => setActive(null)} onDone={() => done('Expense recorded.')} />}
      {active === 'production' && <QuickProductionModal onClose={() => setActive(null)} onDone={() => done('Production logged.')} />}
    </div>
  )
}
