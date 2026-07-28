// src/components/shipments/AliChargesTable.tsx
//
// Reconciliation table for costs paid to Ali (the Djibouti forwarder):
// what we expected vs. what he actually invoiced, for each named charge
// type, with a discrepancy flag and a per-row sync into shipment_expenses.
import { useState, useEffect, useCallback } from 'react'
import { Check, Loader2, Plus, RefreshCw, X } from 'lucide-react'
import {
  listAliCharges, upsertAliCharge, deleteAliCharge, syncAliChargeToExpense,
  ALI_CHARGE_TYPES, ALI_CHARGE_LABELS,
} from '../../api/aliCharges'
import type { AliCharge, AliChargeType } from '../../api/aliCharges'

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 2 }).format(n)

// A row the user is actively editing -- either a real DB row, or an
// unsaved stub for a fixed charge type that has no row yet. `dirty` tracks
// whether local edits differ from what's saved, so "Save" only appears
// when there's actually something to commit.
interface Row {
  charge: Partial<AliCharge> & { charge_type: AliChargeType }
  dirty: boolean
}

function emptyRow(chargeType: AliChargeType): Row {
  return { charge: { charge_type: chargeType, currency: 'USD' }, dirty: false }
}

function discrepancy(expected: number | null | undefined, actual: number | null | undefined) {
  if (expected == null || actual == null) return null
  const diff = actual - expected
  const tolerance = Math.max(expected * 0.05, 50)
  if (Math.abs(diff) <= tolerance) return { label: 'Matches', cls: 'bg-green-50 text-green-700' }
  const over = diff > 0
  return {
    label: `${over ? '+' : '−'}${N(Math.abs(diff))} ${over ? 'over' : 'under'}`,
    cls: over ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700',
  }
}

export function AliChargesTable({ shipmentId, fxRate }: { shipmentId: string; fxRate: number }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const saved = await listAliCharges(shipmentId)
      const savedByType = new Map(saved.filter(c => c.charge_type !== 'OTHER').map(c => [c.charge_type, c]))
      const fixed: Row[] = ALI_CHARGE_TYPES.map(t => ({ charge: savedByType.get(t) ?? { charge_type: t, currency: 'USD' as const }, dirty: false }))
      const others: Row[] = saved.filter(c => c.charge_type === 'OTHER').map(c => ({ charge: c, dirty: false }))
      setRows([...fixed, ...others])
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
    setLoading(false)
  }, [shipmentId])

  useEffect(() => { load() }, [load])

  function updateRow(index: number, patch: Partial<AliCharge>) {
    setRows(prev => prev.map((r, i) => i === index ? { charge: { ...r.charge, ...patch }, dirty: true } : r))
  }

  async function saveRow(index: number) {
    const row = rows[index]
    setSavingId(row.charge.id ?? `new-${index}`)
    setError(null)
    try {
      const saved = await upsertAliCharge(shipmentId, {
        id: row.charge.id,
        charge_type: row.charge.charge_type,
        custom_label: row.charge.custom_label,
        expected_amount: row.charge.expected_amount ?? null,
        actual_amount: row.charge.actual_amount ?? null,
        currency: row.charge.currency ?? 'USD',
        is_reconciled: row.charge.is_reconciled ?? false,
        notes: row.charge.notes,
      })
      setRows(prev => prev.map((r, i) => i === index ? { charge: saved, dirty: false } : r))
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
    setSavingId(null)
  }

  async function syncRow(index: number) {
    const row = rows[index]
    if (!row.charge.id) { setError('Save this charge before syncing.'); return }
    setSyncingId(row.charge.id)
    setError(null)
    try {
      await syncAliChargeToExpense(row.charge as AliCharge, fxRate)
      await load()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
    setSyncingId(null)
  }

  async function removeRow(index: number) {
    const row = rows[index]
    if (!row.charge.id) { setRows(prev => prev.filter((_, i) => i !== index)); return }
    try {
      await deleteAliCharge(row.charge.id)
      await load()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
  }

  function addOther() {
    setRows(prev => [...prev, emptyRow('OTHER')])
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-xs text-gray-400 py-4"><Loader2 size={14} className="animate-spin" /> Loading Ali charges…</div>
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Charges paid to Ali</p>
          <p className="text-xs text-gray-400 mt-0.5">What we expected vs. what he actually invoiced</p>
        </div>
        <button onClick={addOther} className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-white transition-colors">
          <Plus size={12} /> Add other charge
        </button>
      </div>

      {error && <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700">{error}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50/60 border-b border-gray-100 text-gray-400 uppercase tracking-wide">
              <th className="text-left px-4 py-2 font-medium">Charge</th>
              <th className="text-right px-2 py-2 font-medium">Expected</th>
              <th className="text-right px-2 py-2 font-medium">Ali's actual</th>
              <th className="px-2 py-2 font-medium">Currency</th>
              <th className="px-2 py-2 font-medium">Vs. expected</th>
              <th className="px-2 py-2 font-medium">Reconciled</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row, i) => {
              const disc = discrepancy(row.charge.expected_amount, row.charge.actual_amount)
              const isPaidLocked = !!row.charge.synced_expense_id // best-effort; real paid check happens server-side too
              return (
                <tr key={row.charge.id ?? `stub-${row.charge.charge_type}-${i}`} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2.5">
                    {row.charge.charge_type === 'OTHER' ? (
                      <input
                        value={row.charge.custom_label ?? ''}
                        onChange={e => updateRow(i, { custom_label: e.target.value })}
                        placeholder="Describe this charge"
                        className="w-32 px-2 py-1 text-xs border border-gray-200 rounded-lg"
                      />
                    ) : (
                      <span className="font-medium">{ALI_CHARGE_LABELS[row.charge.charge_type]}</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <input type="number" step="0.01"
                      value={row.charge.expected_amount ?? ''}
                      onChange={e => updateRow(i, { expected_amount: e.target.value ? parseFloat(e.target.value) : null })}
                      className="w-24 px-2 py-1 text-xs text-right font-mono border border-gray-200 rounded-lg" />
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <input type="number" step="0.01"
                      value={row.charge.actual_amount ?? ''}
                      onChange={e => updateRow(i, { actual_amount: e.target.value ? parseFloat(e.target.value) : null })}
                      className="w-24 px-2 py-1 text-xs text-right font-mono border border-gray-200 rounded-lg" />
                  </td>
                  <td className="px-2 py-2.5">
                    <select value={row.charge.currency ?? 'USD'} onChange={e => updateRow(i, { currency: e.target.value as any })}
                      className="px-1.5 py-1 text-xs border border-gray-200 rounded-lg bg-white">
                      <option value="USD">USD</option><option value="ETB">ETB</option><option value="CNY">CNY</option>
                    </select>
                  </td>
                  <td className="px-2 py-2.5">
                    {disc ? <span className={`inline-flex px-2 py-0.5 rounded-full font-medium ${disc.cls}`}>{disc.label}</span> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <input type="checkbox" checked={row.charge.is_reconciled ?? false}
                      onChange={e => updateRow(i, { is_reconciled: e.target.checked })} />
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-1.5 justify-end">
                      {row.dirty && (
                        <button onClick={() => saveRow(i)} disabled={savingId !== null}
                          className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                          {savingId === (row.charge.id ?? `new-${i}`) ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save
                        </button>
                      )}
                      {!row.dirty && row.charge.actual_amount != null && (
                        <button onClick={() => syncRow(i)} disabled={syncingId !== null}
                          className="flex items-center gap-1 px-2 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
                          <RefreshCw size={11} className={syncingId === row.charge.id ? 'animate-spin' : ''} />
                          {isPaidLocked ? 'Re-sync' : 'Sync'}
                        </button>
                      )}
                      <button onClick={() => removeRow(i)} className="text-gray-300 hover:text-red-500 transition-colors p-1">
                        <X size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
