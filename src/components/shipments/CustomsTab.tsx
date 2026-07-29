// src/components/shipments/CustomsTab.tsx — Ethiopian customs cascade,
// split out into its own tab so it isn't buried as one category choice
// inside the general Expenses tab. Saves into the same shipment_expenses
// table under ETHIOPIA_CUSTOMS (via replaceAutoExpenses), so it still
// counts toward the shipment's real landed-cost total — this is a change
// in where the UI lives, not a new data model.
import { useState, useMemo } from 'react'
import { Info, RefreshCw, Loader2, Pencil, Trash2 } from 'lucide-react'
import { replaceAutoExpenses } from '../../lib/expenseSync'
import type { AutoExpenseSource } from '../../lib/expenseSync'

interface CustomsExpense {
  id: string
  description: string
  amount: number
  currency: string
  amount_etb: number | null
  vendor_name: string | null
  expense_date: string
  cost_status: string
}

interface CustomsTabProps {
  shipmentId: string
  shipmentItems: Array<{ id: string; product_name: string; quantity: number; unit_price_usd: number }>
  fxRate: number
  freightUsd: number
  insuranceUsd: number
  customsExpenses: CustomsExpense[]
  onSaved: () => void
  onEdit: (expenseId: string) => void
  onDelete: (expenseId: string, description: string) => void
}

interface UpliftRow { label: string; pct: number }

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-block">
      <button onClick={() => setShow(v => !v)} className="text-blue-400 hover:text-blue-600 transition-colors" aria-label="More information" type="button">
        <Info size={13} />
      </button>
      {show && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShow(false)} />
          <div className="absolute left-5 top-0 z-50 w-64 p-3 bg-white border border-blue-200 rounded-xl shadow-lg text-xs text-gray-700 leading-relaxed">
            {text}
          </div>
        </>
      )}
    </span>
  )
}

export function CustomsTab({ shipmentId, shipmentItems, fxRate, freightUsd, insuranceUsd, customsExpenses, onSaved, onEdit, onDelete }: CustomsTabProps) {
  const [uplift, setUplift] = useState<UpliftRow[]>([
    { label: 'Insurance', pct: 2 },
    { label: 'Freight allowance', pct: 5 },
    { label: 'Handling', pct: 5 },
  ])
  const [dutyRate, setDutyRate] = useState(25)
  const [exciseRate, setExciseRate] = useState(0)
  const [applySurtax, setApplySurtax] = useState(true)
  const [applyVat, setApplyVat] = useState(true)
  const [applyWht, setApplyWht] = useState(true)
  const [clearingFee, setClearingFee] = useState(0)
  const [vendorName, setVendorName] = useState('ERCA')
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalFobUsd = shipmentItems.reduce((s, i) => s + i.quantity * i.unit_price_usd, 0)
  const upliftPctTotal = uplift.reduce((s, u) => s + (Number(u.pct) || 0), 0)
  const upliftUsd = totalFobUsd * (upliftPctTotal / 100)
  const cifUsd = totalFobUsd + freightUsd + insuranceUsd + upliftUsd

  const calc = useMemo(() => {
    const cifEtb = cifUsd * fxRate
    const duty = Math.round(cifEtb * (dutyRate / 100))
    const exciseBase = cifEtb + duty
    const excise = Math.round(exciseBase * (exciseRate / 100))
    const surtaxBase = cifEtb + duty + excise
    const surtax = applySurtax ? Math.round(surtaxBase * 0.10) : 0
    const vatBase = cifEtb + duty + excise + surtax
    const vat = applyVat ? Math.round(vatBase * 0.15) : 0
    const wht = applyWht ? Math.round(cifEtb * 0.03) : 0
    const clearing = Math.round(clearingFee)
    const totalNonRecoverable = duty + excise + surtax + vat + clearing
    const totalWithWht = totalNonRecoverable + wht
    const effectiveRate = cifEtb > 0 ? (totalNonRecoverable / cifEtb) * 100 : 0
    return {
      cifEtb: Math.round(cifEtb), duty, excise, surtax, vat, wht, clearing,
      totalNonRecoverable, totalWithWht, effectiveRate: Math.round(effectiveRate * 10) / 10,
    }
  }, [cifUsd, fxRate, dutyRate, exciseRate, applySurtax, applyVat, applyWht, clearingFee])

  function updateUplift(i: number, patch: Partial<UpliftRow>) {
    setUplift(u => u.map((row, idx) => idx === i ? { ...row, ...patch } : row))
  }

  const savedTotalEtb = customsExpenses.reduce((s, e) => s + (e.amount_etb ?? 0), 0)

  async function save() {
    setSaving(true); setError(null)
    try {
      const components: { source: AutoExpenseSource; subKey?: string; desc: string; amount: number; note: string }[] = []

      // Every uplift row (Insurance/Freight allowance/Handling/... — there
      // are 3 by default, all nonzero) shares the same source, so each
      // needs its own subKey or a batch insert of more than one would
      // collide on the same auto_sync_key and violate the unique
      // constraint outright.
      uplift.forEach((row, i) => {
        const pct = Number(row.pct) || 0
        const usd = totalFobUsd * (pct / 100)
        if (usd > 0) {
          components.push({
            source: 'customs_fob_uplift',
            subKey: String(i),
            desc: `FOB uplift — ${row.label.trim() || 'Uplift'} (${pct}%)`,
            amount: Math.round(usd * fxRate),
            note: `${pct}% × FOB $${N(totalFobUsd)}`,
          })
        }
      })
      if (calc.duty > 0) components.push({ source: 'customs_duty', desc: 'Customs duty', amount: calc.duty, note: `${dutyRate}% × CIF ${N(calc.cifEtb)} ETB` })
      if (calc.excise > 0) components.push({ source: 'customs_excise', desc: 'Excise tax', amount: calc.excise, note: `${exciseRate}% × (CIF + Duty)` })
      if (applySurtax && calc.surtax > 0) components.push({ source: 'customs_surtax', desc: 'Surtax (10%)', amount: calc.surtax, note: '10% × (CIF + Duty + Excise)' })
      if (applyVat && calc.vat > 0) components.push({ source: 'customs_vat', desc: 'VAT (15%)', amount: calc.vat, note: '15% × (CIF + Duty + Excise + Surtax)' })
      if (applyWht && calc.wht > 0) components.push({ source: 'customs_wht', desc: 'Withholding tax (3%)', amount: calc.wht, note: '3% × CIF — recoverable against income tax' })
      if (calc.clearing > 0) components.push({ source: 'customs_clearing', desc: 'Clearing agent fee', amount: calc.clearing, note: 'Fixed fee' })

      if (components.length === 0) {
        setError('Nothing to save — set a duty rate, an uplift %, or enable a tax above.')
        setSaving(false)
        return
      }

      await replaceAutoExpenses(shipmentId, 'customs', components.map(c => ({
        source: c.source, subKey: c.subKey, category: 'ETHIOPIA_CUSTOMS', description: c.desc, amount: c.amount,
        currency: 'ETB' as const, amountEtb: c.amount, fxRate, vendorName: vendorName || 'ERCA',
        expenseDate, detailNote: c.note,
      })))
      onSaved()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save customs costs.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Ethiopian customs</p>
            <InfoTip text="Duty, excise, surtax, VAT, and withholding tax are calculated in a specific cascade order per ERCA Proclamation 622/2009 — each tax builds on the cumulative base of the ones before it. This tab handles the order automatically and saves the result as line items on the shipment." />
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            Saved so far: <span className="font-medium text-gray-700">{N(savedTotalEtb)} ETB</span>
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* CIF base */}
        <div className="bg-gray-50 rounded-xl p-3">
          <div className="flex items-center gap-1 mb-1">
            <p className="text-xs font-medium text-gray-600">CIF value (calculated)</p>
            <InfoTip text="CIF = FOB (from PI items) + Freight + Insurance + FOB uplift. This is the customs valuation base." />
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div className="bg-white rounded-lg p-2 border border-gray-200">
              <p className="text-gray-400 mb-0.5">FOB value</p>
              <p className="font-mono font-medium">${N(totalFobUsd)}</p>
            </div>
            <div className="bg-white rounded-lg p-2 border border-gray-200">
              <p className="text-gray-400 mb-0.5">+ Freight + Ins</p>
              <p className="font-mono font-medium">${N(freightUsd + insuranceUsd)}</p>
            </div>
            <div className="bg-white rounded-lg p-2 border border-gray-200">
              <p className="text-gray-400 mb-0.5">+ FOB uplift</p>
              <p className="font-mono font-medium">${N(upliftUsd)}</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-2 border border-blue-200">
              <p className="text-blue-600 mb-0.5">= CIF (ETB)</p>
              <p className="font-mono font-medium text-blue-700">{N(calc.cifEtb)}</p>
            </div>
          </div>
          {(freightUsd + insuranceUsd) === 0 && (
            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
              <Info size={11} /> Add ocean freight and insurance expenses first for accurate CIF
            </p>
          )}
        </div>

        {/* FOB uplift */}
        <div className="bg-gray-50 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1">
              <p className="text-xs font-medium text-gray-600">FOB uplift</p>
              <InfoTip text="An extra cost estimated as a percentage of FOB value — on top of the freight/insurance you enter as real expenses. Split into whatever components you actually mean by it; rename the labels and adjust the rates freely." />
            </div>
            <span className="text-xs font-mono font-medium text-purple-700">{upliftPctTotal}% = ${N(upliftUsd)}</span>
          </div>
          <div className="space-y-1.5">
            {uplift.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={row.label} onChange={e => updateUplift(i, { label: e.target.value })}
                  className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white" placeholder="Label" />
                <input type="number" min="0" step="0.5" value={row.pct} onChange={e => updateUplift(i, { pct: parseFloat(e.target.value) || 0 })}
                  className="w-16 px-2 py-1 text-xs font-mono text-right border border-gray-200 rounded-lg bg-white" />
                <span className="text-xs text-gray-400 w-4">%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Duty rate */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1">
              <label className="text-xs text-gray-500">Import duty rate (%)</label>
              <InfoTip text="From the Ethiopian Customs Tariff Schedule based on your product's HS code. Common rates: electronics 0–25%, household appliances 25–35%, vehicles 35%." />
            </div>
            <span className="text-xs font-mono font-medium text-purple-700">= {N(calc.duty)} ETB</span>
          </div>
          <div className="flex items-center gap-3">
            <input type="range" min="0" max="100" step="5" value={dutyRate} onChange={e => setDutyRate(parseInt(e.target.value))} className="flex-1" />
            <div className="flex items-center gap-1">
              <input type="number" min="0" max="100" step="0.5" value={dutyRate} onChange={e => setDutyRate(parseFloat(e.target.value) || 0)}
                className="w-16 px-2 py-1.5 text-xs font-mono text-right border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <span className="text-xs text-gray-400">%</span>
            </div>
          </div>
        </div>

        {/* Excise */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1">
              <label className="text-xs text-gray-500">Excise tax rate (%)</label>
              <InfoTip text="Only applies to specific goods (vehicles, alcohol, tobacco, sugar, cosmetics). Leave at 0 for general merchandise." />
            </div>
            <span className="text-xs font-mono font-medium text-purple-700">= {N(calc.excise)} ETB</span>
          </div>
          <div className="flex items-center gap-3">
            <input type="range" min="0" max="100" step="5" value={exciseRate} onChange={e => setExciseRate(parseInt(e.target.value))} className="flex-1" />
            <div className="flex items-center gap-1">
              <input type="number" min="0" max="500" step="5" value={exciseRate} onChange={e => setExciseRate(parseFloat(e.target.value) || 0)}
                className="w-16 px-2 py-1.5 text-xs font-mono text-right border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <span className="text-xs text-gray-400">%</span>
            </div>
          </div>
        </div>

        {/* Additional levies */}
        <div className="bg-gray-50 rounded-xl p-3 space-y-2.5">
          <p className="text-xs font-medium text-gray-600 mb-2">Additional levies</p>
          {[
            { on: applySurtax, set: setApplySurtax, label: 'Surtax 10%', val: calc.surtax, tip: 'Surtax is 10% applied on (CIF + duty + excise). Applies to most consumer goods.' },
            { on: applyVat, set: setApplyVat, label: 'VAT 15%', val: calc.vat, tip: '15% VAT on CIF + duty + excise + surtax — charged on virtually all imports.' },
            { on: applyWht, set: setApplyWht, label: 'Withholding tax 3%', val: calc.wht, tip: '3% of CIF, an advance payment toward annual income tax — recoverable when filing.', recoverable: true },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={() => row.set(v => !v)}
                  className={`relative rounded-full border-none cursor-pointer transition-colors ${row.on ? 'bg-blue-600' : 'bg-gray-300'}`}
                  style={{ width: 30, height: 17 }}>
                  <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${row.on ? 'left-3.5' : 'left-0.5'}`} style={{ width: 13, height: 13 }} />
                </button>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-600">{row.label}</span>
                  <InfoTip text={row.tip} />
                </div>
              </div>
              <span className={`text-xs font-mono ${row.on ? 'text-gray-700 font-medium' : 'text-gray-300'}`}>
                {N(row.val)} ETB{row.recoverable && row.on && <span className="text-green-500 ml-1">(recoverable)</span>}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1 border-t border-gray-200">
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-600">Clearing agent fee</span>
              <InfoTip text="Fixed fee charged by your clearing agent for handling paperwork. Enter the amount agreed with your agent." />
            </div>
            <div className="flex items-center gap-1">
              <input type="number" value={clearingFee || ''} onChange={e => setClearingFee(parseFloat(e.target.value) || 0)}
                className="w-24 px-2 py-1 text-xs font-mono text-right border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" placeholder="0" />
              <span className="text-xs text-gray-400">ETB</span>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
          <p className="text-xs font-medium text-purple-800 mb-2">Total to save</p>
          <div className="space-y-1">
            {upliftUsd > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-purple-700">FOB uplift ({upliftPctTotal}%)</span>
                <span className="font-mono font-medium text-purple-900">{N(upliftUsd * fxRate)} ETB</span>
              </div>
            )}
            {[
              { label: `Duty (${dutyRate}% × CIF)`, val: calc.duty, show: true },
              { label: `Excise (${exciseRate}%)`, val: calc.excise, show: exciseRate > 0 },
              { label: 'Surtax (10%)', val: calc.surtax, show: applySurtax },
              { label: 'VAT (15% on full base)', val: calc.vat, show: applyVat },
              { label: 'WHT (3% of CIF — recoverable)', val: calc.wht, show: applyWht },
              { label: 'Clearing agent fee', val: calc.clearing, show: clearingFee > 0 },
            ].filter(r => r.show).map(row => (
              <div key={row.label} className="flex justify-between text-xs">
                <span className="text-purple-700">{row.label}</span>
                <span className="font-mono font-medium text-purple-900">{N(row.val)} ETB</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-medium pt-2 border-t border-purple-200 mt-1">
              <span className="text-purple-900">Total payable</span>
              <span className="font-mono text-purple-900">{N(calc.totalWithWht + upliftUsd * fxRate)} ETB</span>
            </div>
            <p className="text-xs text-purple-600 mt-1">Effective rate: {calc.effectiveRate}% of CIF value</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Vendor (paid to)</label>
            <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="ERCA" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date</label>
            <input type="date" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={expenseDate} onChange={e => setExpenseDate(e.target.value)} />
          </div>
        </div>

        {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

        <div className="flex justify-end">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-xs rounded-lg hover:bg-purple-700 disabled:opacity-50 min-w-[160px] justify-center">
            {saving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : <><RefreshCw size={12} /> Recalculate &amp; save</>}
          </button>
        </div>
      </div>

      {/* Already-saved customs lines */}
      <div className="mt-6">
        <p className="text-xs font-medium text-gray-500 mb-2">Saved customs lines</p>
        {customsExpenses.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-xs text-gray-400">
            Nothing saved yet — set your rates above and save.
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {customsExpenses.map((exp, i) => (
              <div key={exp.id} className={`flex items-center gap-3 px-4 py-2.5 ${i < customsExpenses.length - 1 ? 'border-b border-gray-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-800 truncate">{exp.description}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${exp.cost_status === 'FINAL' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                      {exp.cost_status === 'FINAL' ? 'Final' : 'Estimated'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-xs mt-0.5">
                    <span className="font-mono font-medium text-gray-700">{N(exp.amount_etb ?? 0)} ETB</span>
                    {exp.vendor_name && <span className="text-gray-400">{exp.vendor_name}</span>}
                    <span className="text-gray-400">{exp.expense_date}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => onEdit(exp.id)} className="p-1.5 text-gray-300 hover:text-blue-600 transition-colors"><Pencil size={13} /></button>
                  <button onClick={() => onDelete(exp.id, exp.description)} className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-100 font-medium">
              <span className="text-sm text-gray-600">Total customs</span>
              <span className="text-base font-mono text-gray-900">{N(savedTotalEtb)} ETB</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
