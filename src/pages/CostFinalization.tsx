// src/pages/CostFinalization.tsx

import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, Check, Loader2,
  AlertTriangle, Lock, CheckCircle,
} from 'lucide-react'
import { useCostFinalization, type AllocationMethod } from '../hooks/useCostFinalization'

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

const CAT: Record<string, string> = {
  CHINA_ORIGIN:     '🇨🇳 China Origin',
  OCEAN_FREIGHT:    '🚢 Ocean Freight',
  DJIBOUTI_PORT:    '⚓ Djibouti Port',
  TRUCKING:         '🚛 Trucking',
  ETHIOPIA_CUSTOMS: '🛃 Customs',
  OTHER:            '📋 Other',
}

const METHODS: { value: AllocationMethod; label: string }[] = [
  { value: 'QUANTITY', label: 'By quantity' },
  { value: 'WEIGHT',   label: 'By weight (kg)' },
  { value: 'VOLUME',   label: 'By volume (m³)' },
  { value: 'VALUE',    label: 'By product value' },
]

const STEPS = ['Review expenses', 'Preview impact', 'Confirm & lock', 'Done']

export function CostFinalization() {
  const { id } = useParams<{ id: string }>()
  const [confirmed, setConfirmed] = useState(false)

  const fin = useCostFinalization(id!)

  if (fin.isLoading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
      <Loader2 size={18} className="animate-spin" /> Loading shipment costs…
    </div>
  )

  if (!fin.hasProvisional && fin.step === 1) return (
    <div className="p-5 max-w-2xl mx-auto text-center py-20">
      <CheckCircle size={40} className="mx-auto text-green-600 mb-4" />
      <h1 className="text-lg font-medium text-gray-900 mb-2">
        Costs already finalized
      </h1>
      <p className="text-sm text-gray-400 mb-6">
        All items on this shipment have been locked. No provisional costs remain.
      </p>
      <Link to={`/shipments/${id}`}
            className="inline-flex items-center gap-1.5 text-sm text-blue-600
                       hover:underline">
        <ArrowLeft size={14} /> Back to shipment
      </Link>
    </div>
  )

  return (
    <div className="p-5 max-w-3xl mx-auto">

      {/* Back */}
      <Link to={`/shipments/${id}`}
            className="inline-flex items-center gap-1 text-xs text-gray-400
                       hover:text-gray-600 mb-5 transition-colors">
        <ArrowLeft size={13} /> Back to shipment
      </Link>

      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-lg font-medium">Finalize costs</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Review provisional expenses, confirm final amounts, preview unit
          cost impact, then lock permanently.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((label, i) => {
          const n   = i + 1
          const done = n < fin.step
          const active = n === fin.step
          return (
            <div key={n} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1 min-w-[72px]">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center
                                 text-xs font-medium border-2 transition-all
                  ${done   ? 'bg-green-100 border-green-600 text-green-700'   : ''}
                  ${active ? 'bg-blue-50 border-blue-600 text-blue-700'       : ''}
                  ${!done && !active ? 'bg-gray-50 border-gray-200 text-gray-400' : ''}`}>
                  {done ? <Check size={13} /> : n}
                </div>
                <span className={`text-xs text-center leading-tight
                  ${active ? 'text-blue-700 font-medium' : 'text-gray-400'}`}>
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 mb-4 transition-colors
                  ${done ? 'bg-green-500' : 'bg-gray-200'}`} />
              )}
            </div>
          )
        })}
      </div>

      {/* Error banner */}
      {fin.error && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border
                        border-red-200 rounded-xl text-xs text-red-700 mb-4">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {fin.error}
        </div>
      )}

      {/* ── STEP 1: Review ─────────────────────────────── */}
      {fin.step === 1 && (
        <div className="space-y-4">

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50
                            border-b border-gray-100">
              <p className="text-sm font-medium">Provisional expenses</p>
              <p className="text-xs text-gray-400">
                Update amounts if invoices differ from estimates
              </p>
            </div>

            <div className="divide-y divide-gray-50">
              {fin.expenses.map(exp => {
                const diff = exp.finalAmount - (exp.amount_etb ?? exp.amount)
                return (
                  <div key={exp.id} className="px-4 py-3">
                    <div className="grid grid-cols-[2fr_1fr_auto_auto] gap-3
                                    items-center">

                      {/* Description */}
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {exp.description}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {CAT[exp.category] ?? exp.category}
                          {exp.vendor_name && ` · ${exp.vendor_name}`}
                        </p>
                      </div>

                      {/* Editable amount */}
                      <div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            step="100"
                            min="0"
                            value={exp.finalAmount}
                            onChange={e => fin.updateAmount(
                              exp.id, parseFloat(e.target.value) || 0
                            )}
                            className="w-28 px-2.5 py-1.5 text-xs font-mono text-right
                                       border border-gray-200 rounded-lg
                                       focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                          <span className="text-xs text-gray-400">ETB</span>
                        </div>
                        {Math.abs(diff) > 1 && (
                          <p className={`text-xs font-mono mt-1
                            ${diff > 0 ? 'text-red-600' : 'text-green-700'}`}>
                            {diff > 0 ? '+' : ''}{N(diff)} ETB
                          </p>
                        )}
                      </div>

                      {/* Original */}
                      <div className="text-right">
                        <p className="text-xs text-gray-400">was</p>
                        <p className="text-xs font-mono text-gray-500">
                          {N(exp.amount_etb ?? exp.amount)} ETB
                        </p>
                      </div>

                      {/* Final toggle */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => fin.toggleFinal(exp.id)}
                          className={`relative w-8 h-4.5 rounded-full border-none
                                      transition-colors cursor-pointer
                            ${exp.isFinal ? 'bg-blue-600' : 'bg-gray-200'}`}
                          style={{ width: 32, height: 18 }}
                          aria-label={exp.isFinal ? 'Mark provisional' : 'Mark final'}
                        >
                          <span className={`absolute top-0.5 w-3.5 h-3.5 bg-white
                                            rounded-full transition-all
                            ${exp.isFinal ? 'left-4' : 'left-0.5'}`}
                                style={{ width: 14, height: 14 }} />
                        </button>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                          ${exp.isFinal
                            ? 'bg-green-50 text-green-700'
                            : 'bg-amber-50 text-amber-700'}`}>
                          {exp.isFinal ? 'Final' : 'Provisional'}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                label: 'Provisional total',
                val: `${N(fin.provisionalTotal)} ETB`,
                color: 'text-gray-900',
              },
              {
                label: 'Final total',
                val: fin.allConfirmed ? `${N(fin.finalTotal)} ETB` : '—',
                color: 'text-blue-700',
              },
              {
                label: 'Confirmed',
                val: `${fin.confirmedCount} / ${fin.expenses.length}`,
                color: fin.allConfirmed ? 'text-green-700' : 'text-gray-900',
              },
            ].map(s => (
              <div key={s.label}
                   className="bg-gray-50 rounded-xl px-4 py-3">
                <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                <p className={`text-sm font-medium font-mono ${s.color}`}>{s.val}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={fin.markAllFinal}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border
                         border-gray-200 rounded-lg hover:bg-gray-50 transition-colors
                         text-gray-600"
            >
              <Check size={13} /> Mark all as final
            </button>
            <button
              onClick={() => fin.goToStep(2)}
              disabled={!fin.allConfirmed}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white
                         text-xs rounded-lg hover:bg-blue-700 disabled:opacity-40
                         transition-colors"
            >
              Preview cost impact <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Preview ────────────────────────────── */}
      {fin.step === 2 && (
        <div className="space-y-4">

          {/* Controls */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-2">Exchange rate (ETB/USD)</p>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="0.01"
                  value={fin.fxRate}
                  onChange={e => fin.setFxRate(parseFloat(e.target.value) || 131.20)}
                  className="w-24 px-2.5 py-1.5 text-sm font-mono border border-gray-200
                             rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <span className="text-xs text-gray-400">ETB</span>
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-2">Allocation method</p>
              <select
                value={fin.method}
                onChange={e => fin.setMethod(e.target.value as AllocationMethod)}
                className="w-full px-2.5 py-1.5 text-xs border border-gray-200
                           rounded-lg bg-white focus:outline-none
                           focus:ring-2 focus:ring-blue-400"
              >
                {METHODS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-2">Total overhead change</p>
              <p className={`text-sm font-medium font-mono
                ${fin.overheadDelta > 0 ? 'text-red-600'
                  : fin.overheadDelta < 0 ? 'text-green-700'
                  : 'text-gray-500'}`}>
                {fin.overheadDelta === 0
                  ? 'No change'
                  : `${fin.overheadDelta > 0 ? '+' : ''}${N(fin.overheadDelta)} ETB`
                }
              </p>
            </div>
          </div>

          {/* Impact table */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-4 gap-3 px-4 py-2.5 bg-gray-50
                            border-b border-gray-100 text-xs font-medium
                            text-gray-400 uppercase tracking-wide">
              <div>Product</div>
              <div className="text-right">Provisional cost</div>
              <div className="text-right">Final cost</div>
              <div className="text-right">Change per unit</div>
            </div>

            {fin.preview.map((p, i) => {
              const diff       = p.change_per_unit
              const diffColor  = diff > 0 ? 'text-red-600'
                : diff < 0 ? 'text-green-700' : 'text-gray-400'
              return (
                <div
                  key={p.product_name}
                  className={`grid grid-cols-4 gap-3 px-4 py-3 items-center
                    ${i < fin.preview.length - 1 ? 'border-b border-gray-50' : ''}`}
                >
                  <div className="text-sm font-medium">{p.product_name}</div>
                  <div className="text-right text-xs font-mono text-gray-500">
                    {N(p.old_unit_cost)} ETB
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-medium font-mono text-blue-700">
                      {N(p.new_unit_cost)} ETB
                    </span>
                  </div>
                  <div className={`text-right text-xs font-mono font-medium ${diffColor}`}>
                    {diff === 0 ? '—'
                      : `${diff > 0 ? '+' : ''}${N(diff)} ETB`}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Safety note */}
          <div className="flex items-start gap-2 px-4 py-3 bg-amber-50
                          border border-amber-200 rounded-xl text-xs text-amber-800">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" />
            <span>
              Units sold before finalization keep their provisional cost snapshot.
              This change only affects remaining inventory and future sales.
              Historical P&L stays accurate.
            </span>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => fin.goToStep(1)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border
                         border-gray-200 rounded-lg hover:bg-gray-50 transition-colors
                         text-gray-600"
            >
              <ArrowLeft size={13} /> Back
            </button>
            <button
              onClick={() => { fin.goToStep(3); setConfirmed(false) }}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white
                         text-xs rounded-lg hover:bg-blue-700 transition-colors"
            >
              Confirm finalization <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Confirm ────────────────────────────── */}
      {fin.step === 3 && (
        <div className="space-y-4">

          {/* Danger warning */}
          <div className="flex items-start gap-3 px-4 py-3 bg-red-50
                          border border-red-200 rounded-xl text-xs text-red-700">
            <AlertTriangle size={15} className="shrink-0 mt-0.5 text-red-500" />
            <div>
              <p className="font-medium mb-1">This action cannot be undone.</p>
              Once locked, expenses cannot be edited and cost_status becomes FINAL
              permanently. Unit costs in inventory update immediately.
            </div>
          </div>

          {/* Expense lock list */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Expenses to lock
              </p>
            </div>
            {fin.expenses.map((exp, i) => {
              const diff = exp.finalAmount - (exp.amount_etb ?? exp.amount)
              return (
                <div
                  key={exp.id}
                  className={`flex items-center justify-between px-4 py-2.5 text-sm
                    ${i < fin.expenses.length - 1 ? 'border-b border-gray-50' : ''}`}
                >
                  <span className="text-gray-600">{exp.description}</span>
                  <div className="text-right">
                    <p className="font-medium font-mono">{N(exp.finalAmount)} ETB</p>
                    {Math.abs(diff) > 1 && (
                      <p className={`text-xs font-mono
                        ${diff > 0 ? 'text-red-600' : 'text-green-700'}`}>
                        {diff > 0 ? '+' : ''}{N(diff)} from estimate
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
            <div className="flex items-center justify-between px-4 py-2.5
                            bg-gray-50 border-t border-gray-100 font-medium text-sm">
              <span className="text-gray-600">Total</span>
              <span className="font-mono">{N(fin.finalTotal)} ETB</span>
            </div>
          </div>

          {/* New unit costs */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                New unit landed costs
              </p>
            </div>
            {fin.preview.map((p, i) => (
              <div
                key={p.product_name}
                className={`flex items-center justify-between px-4 py-2.5 text-sm
                  ${i < fin.preview.length - 1 ? 'border-b border-gray-50' : ''}`}
              >
                <span className="font-medium">{p.product_name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-gray-400 line-through">
                    {N(p.old_unit_cost)}
                  </span>
                  <span className="font-medium font-mono text-blue-700">
                    {N(p.new_unit_cost)} ETB
                  </span>
                  {p.change_per_unit !== 0 && (
                    <span className={`text-xs font-mono
                      ${p.change_per_unit > 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {p.change_per_unit > 0 ? '+' : ''}{N(p.change_per_unit)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Confirmation checkbox */}
          <label className="flex items-center gap-3 px-4 py-3 bg-gray-50
                            rounded-xl border border-gray-200 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="w-4 h-4 cursor-pointer rounded"
            />
            <span className="text-xs text-gray-700">
              I have verified the final amounts and understand this permanently
              locks the costs for this shipment.
            </span>
          </label>

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => fin.goToStep(2)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border
                         border-gray-200 rounded-lg hover:bg-gray-50 transition-colors
                         text-gray-600"
            >
              <ArrowLeft size={13} /> Back
            </button>
            <button
              onClick={fin.finalize}
              disabled={!confirmed || fin.isSaving}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-700 text-white
                         text-xs rounded-lg hover:bg-green-800 disabled:opacity-40
                         transition-colors min-w-[160px] justify-center"
            >
              {fin.isSaving
                ? <><Loader2 size={12} className="animate-spin" /> Finalizing…</>
                : <><Lock size={12} /> Lock costs permanently</>
              }
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 4: Done ───────────────────────────────── */}
      {fin.step === 4 && fin.result && (
        <div className="space-y-4">

          <div className="bg-green-50 border border-green-200 rounded-xl
                          p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-green-100 border-2
                            border-green-600 flex items-center justify-center
                            mx-auto mb-4">
              <Check size={22} className="text-green-700" />
            </div>
            <h2 className="text-base font-medium text-green-800 mb-1">
              Costs finalized
            </h2>
            <p className="text-xs text-green-700 mb-4">
              {fin.result.items.length} products updated ·{' '}
              {N(fin.result.total_overhead)} ETB total overhead ·{' '}
              rate {fin.result.exchange_rate} ETB/USD
            </p>
            <p className="text-xs text-green-600">
              Sales made before finalization keep their original cost snapshots.
              Historical P&L is preserved.
            </p>
          </div>

          {/* What changed */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                What changed
              </p>
            </div>
            {fin.result.items.map((item, i) => (
              <div
                key={item.product_name}
                className={`flex items-center justify-between px-4 py-3
                  ${i < fin.result!.items.length - 1 ? 'border-b border-gray-50' : ''}`}
              >
                <div>
                  <p className="text-sm font-medium">{item.product_name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Unit landed cost
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-gray-400 line-through">
                    {N(item.old_unit_cost)}
                  </span>
                  <span className="text-sm font-medium font-mono text-green-700">
                    {N(item.new_unit_cost)} ETB
                  </span>
                  {item.change_per_unit !== 0 && (
                    <span className={`text-xs font-mono font-medium
                      ${item.change_per_unit > 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {item.change_per_unit > 0 ? '+' : ''}{N(item.change_per_unit)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <Link
              to={`/shipments/${id}`}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border
                         border-gray-200 rounded-lg hover:bg-gray-50 transition-colors
                         text-gray-600"
            >
              <ArrowLeft size={13} /> Back to shipment
            </Link>
            <Link
              to="/"
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600
                         text-white text-xs rounded-lg hover:bg-blue-700
                         transition-colors"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}