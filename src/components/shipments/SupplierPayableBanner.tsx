// src/components/shipments/SupplierPayableBanner.tsx — supplier debt
// tracked from the start of a shipment, not only once someone remembers
// to go create it manually on Supplier Payments. Still just a thin
// wrapper around supplier_payables — no new schema, this only changes
// when the first payable for a shipment gets created.
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { createSupplierPayable } from '../../api/supplierPayables'
import { Landmark, Loader2, RefreshCw, ExternalLink } from 'lucide-react'

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

interface Props {
  shipmentId: string
  supplierId: string
  supplierName: string
  totalFobUsd: number
}

interface PayableRow { id: string; total_amount: number; paid_amount: number; currency: string }

export function SupplierPayableBanner({ shipmentId, supplierId, supplierName, totalFobUsd }: Props) {
  const [payable, setPayable] = useState<PayableRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('supplier_payables')
      .select('id, total_amount, paid_amount, currency')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    setPayable(data ?? null)
    setLoading(false)
  }, [shipmentId])

  useEffect(() => { load() }, [load])

  async function create() {
    setBusy(true); setError(null)
    try {
      await createSupplierPayable({
        supplierId, shipmentId, reference: null, currency: 'USD',
        totalAmount: totalFobUsd, notes: 'Opened from the shipment\'s PI items',
      })
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create the payable.')
    } finally {
      setBusy(false)
    }
  }

  async function syncAmount() {
    if (!payable) return
    setBusy(true); setError(null)
    try {
      const { error: err } = await supabase.from('supplier_payables').update({ total_amount: totalFobUsd }).eq('id', payable.id)
      if (err) throw err
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to sync the amount.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return null
  if (totalFobUsd <= 0) return null

  const outstanding = payable ? Math.max(0, payable.total_amount - payable.paid_amount) : 0
  const stale = payable != null && payable.currency === 'USD' && Math.round(payable.total_amount) !== Math.round(totalFobUsd)

  return (
    <div className="flex items-start gap-2 px-4 py-3 bg-violet-50 border border-violet-100 rounded-xl text-xs text-violet-800 mb-4">
      <Landmark size={14} className="shrink-0 mt-0.5 text-violet-500" />
      <div className="flex-1 min-w-0">
        {!payable ? (
          <>
            <p className="font-medium mb-1">Supplier debt not recorded yet</p>
            <p className="text-violet-700 leading-relaxed mb-2">
              This shipment implies {supplierName} is owed ${N(totalFobUsd)} for the goods (FOB, from PI items) — separate from freight/customs, which are your own costs, not the supplier's. Record it now instead of remembering to later.
            </p>
            <button onClick={create} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs rounded-lg hover:bg-violet-700 disabled:opacity-50">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Landmark size={12} />} Create payable — ${N(totalFobUsd)}
            </button>
          </>
        ) : (
          <>
            <p className="font-medium mb-1 flex items-center gap-1.5 flex-wrap">
              Supplier payable: {N(payable.total_amount)} {payable.currency}
              {outstanding > 0 ? <span className="text-violet-600">· {N(outstanding)} still owed</span> : <span className="text-green-600">· settled</span>}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Link to="/supplier-payments" className="flex items-center gap-0.5 text-violet-700 hover:underline">
                Manage in Supplier Payments <ExternalLink size={11} />
              </Link>
              {stale && (
                <button onClick={syncAmount} disabled={busy}
                  className="flex items-center gap-1 px-2 py-1 border border-violet-200 rounded-lg hover:bg-violet-100">
                  {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} PI total is now ${N(totalFobUsd)} — sync
                </button>
              )}
            </div>
          </>
        )}
        {error && <p className="text-red-600 mt-1">{error}</p>}
      </div>
    </div>
  )
}
