import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { CreditCard, Loader2, AlertTriangle } from 'lucide-react'

interface Receivable {
  id: string
  customer_name: string
  order_number: string | null
  total_etb: number
  paid_etb: number
  sale_date: string | null
  status: string
  days_outstanding: number
}

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

export function Receivables() {
  const [rows, setRows]       = useState<Receivable[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [salesRes, paymentsRes] = await Promise.all([
          (async () => {
            try {
              return await supabase
                .from('sales_orders')
                .select('id, order_number, total_etb, paid_amount, sale_date, status, customers(name)')
                .in('status', ['INVOICED', 'PARTIAL'])
                .order('sale_date', { ascending: true })
            } catch {
              return { data: [], error: null }
            }
          })(),
          (async () => {
            try {
              return await supabase
                .from('sales_payments')
                .select('sales_order_id, amount_paid')
            } catch {
              return { data: [], error: null }
            }
          })(),
        ])

        const paymentMap = new Map<string, number>()
        for (const payment of (paymentsRes.data ?? []) as Array<{ sales_order_id: string; amount_paid: number }>) {
          const key = payment.sales_order_id
          paymentMap.set(key, (paymentMap.get(key) ?? 0) + Number(payment.amount_paid ?? 0))
        }

        const today = new Date()
        const rowsData = (salesRes.data ?? []).map((r: any) => {
          const saleDate = r.sale_date ? new Date(r.sale_date) : today
          const days = Math.floor((today.getTime() - saleDate.getTime()) / 86400000)
          const paidFromOrders = Number(r.paid_amount ?? 0)
          const paidFromPayments = paymentMap.get(r.id) ?? 0
          const paidEtb = Math.max(paidFromOrders, paidFromPayments)

          return {
            id: r.id,
            customer_name: (Array.isArray(r.customers) ? r.customers[0]?.name : r.customers?.name) ?? '—',
            order_number: r.order_number,
            total_etb: Number(r.total_etb ?? 0),
            paid_etb: paidEtb,
            sale_date: r.sale_date,
            status: r.status,
            days_outstanding: days,
          }
        })

        setRows(rowsData.filter((row: Receivable) => row.total_etb > row.paid_etb))
      } catch (error) {
        console.error(error)
        setRows([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const totalOutstanding = rows.reduce((s, r) => s + (r.total_etb - r.paid_etb), 0)
  const overdue = rows.filter(r => r.days_outstanding > 30)

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <CreditCard size={18} /> Receivables
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Customer invoices awaiting payment
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-400">Total outstanding</p>
          <p className="text-xl font-medium font-mono text-green-700">{N(totalOutstanding)} ETB</p>
        </div>
        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-400">Over 30 days</p>
          <p className="text-xl font-medium font-mono text-amber-700">{overdue.length}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400">
          No open receivables. Invoiced sales orders appear here.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {rows.map((r, i) => {
            const outstanding = r.total_etb - r.paid_etb
            const isOverdue = r.days_outstanding > 30
            return (
              <div
                key={r.id}
                className={`flex items-center gap-4 px-4 py-3
                  ${i < rows.length - 1 ? 'border-b border-gray-50' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{r.customer_name}</p>
                  <p className="text-xs text-gray-400">
                    {r.order_number ?? 'Invoice'} · {r.sale_date ?? '—'} · {r.days_outstanding}d
                  </p>
                </div>
                {isOverdue && (
                  <AlertTriangle size={14} className="text-red-500 shrink-0" />
                )}
                <div className="text-right">
                  <p className="text-sm font-mono font-medium text-green-700">
                    {N(outstanding)} ETB
                  </p>
                  <p className="text-xs text-gray-400">
                    of {N(r.total_etb)} · paid {N(r.paid_etb)}
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
