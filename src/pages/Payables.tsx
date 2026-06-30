import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Wallet, Loader2, AlertTriangle } from 'lucide-react'

interface Payable {
  id: string
  supplier_name: string
  po_number: string | null
  total_amount: number
  paid_amount: number
  currency: string
  payment_terms: string | null
  due_date: string | null
  status: string
}

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 2 }).format(n)

export function Payables() {
  const [rows, setRows]       = useState<Payable[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('purchase_orders')
        .select('id, po_number, total_amount, paid_amount, currency, payment_terms, due_date, status, suppliers(name)')
        .in('status', ['OPEN', 'PARTIAL', 'OVERDUE'])
        .order('due_date', { ascending: true })

      setRows((data ?? []).map((r: any) => ({
        id: r.id,
        supplier_name: (Array.isArray(r.suppliers) ? r.suppliers[0]?.name : r.suppliers?.name) ?? '—',
        po_number: r.po_number,
        total_amount: r.total_amount ?? 0,
        paid_amount: r.paid_amount ?? 0,
        currency: r.currency ?? 'USD',
        payment_terms: r.payment_terms,
        due_date: r.due_date,
        status: r.status,
      })))
      setLoading(false)
    }
    load()
  }, [])

  const totalUsd = rows
    .filter(r => r.currency === 'USD')
    .reduce((s, r) => s + (r.total_amount - r.paid_amount), 0)

  const overdue = rows.filter(r => r.due_date && new Date(r.due_date) < new Date())

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <Wallet size={18} /> Payables
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Outstanding supplier invoices and purchase orders
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-400">Total outstanding (USD)</p>
          <p className="text-xl font-medium font-mono text-red-700">${N(totalUsd)}</p>
        </div>
        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-400">Overdue</p>
          <p className="text-xl font-medium font-mono text-amber-700">{overdue.length}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400">
          No open payables. Supplier POs appear here when recorded in purchase_orders.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {rows.map((r, i) => {
            const outstanding = r.total_amount - r.paid_amount
            const isOverdue = r.due_date && new Date(r.due_date) < new Date()
            return (
              <div
                key={r.id}
                className={`flex items-center gap-4 px-4 py-3
                  ${i < rows.length - 1 ? 'border-b border-gray-50' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{r.supplier_name}</p>
                  <p className="text-xs text-gray-400">
                    {r.po_number ?? 'PO'} · {r.payment_terms ?? '—'}
                    {r.due_date && ` · due ${r.due_date}`}
                  </p>
                </div>
                {isOverdue && (
                  <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                )}
                <div className="text-right">
                  <p className="text-sm font-mono font-medium">
                    {r.currency === 'USD' ? '$' : ''}{N(outstanding)} {r.currency}
                  </p>
                  <p className="text-xs text-gray-400">
                    of {N(r.total_amount)} paid {N(r.paid_amount)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
