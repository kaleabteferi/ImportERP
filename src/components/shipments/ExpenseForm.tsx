import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { Check, Loader2, X, Info } from 'lucide-react'
import { replaceAutoExpenses, type AutoExpenseSource } from '../../lib/expenseSync'

// ── Ethiopian customs cascade (Proclamation 622/2009, updated 2023) ──
// The correct calculation order per ERCA:
// 1. CIF value = FOB + Freight + Insurance
// 2. Customs duty = CIF × duty rate
// 3. Excise tax = (CIF + duty) × excise rate (only for specified goods)
// 4. Surtax = (CIF + duty + excise) × 10% (most consumer goods)
// 5. VAT = (CIF + duty + excise + surtax) × 15%
// 6. WHT = CIF × 3% (advance income tax — recoverable)
// 7. Clearing agent fee = fixed fee (negotiated with agent)

interface ExpenseFormProps {
  shipmentId: string
  shipmentItems: Array<{
    id: string
    product_name: string
    quantity: number
    unit_price_usd: number
  }>
  fxRate: number
  freightUsd: number   // already entered ocean freight
  insuranceUsd: number // already entered insurance
  onSave: () => void
  onClose: () => void
  editExpense?: any
}

type Category =
  | 'CHINA_ORIGIN'
  | 'OCEAN_FREIGHT'
  | 'DJIBOUTI_PORT'
  | 'TRUCKING'
  | 'ETHIOPIA_CUSTOMS'
  | 'OTHER'

function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-block">
      <button onClick={() => setShow(v => !v)}
              className="text-blue-400 hover:text-blue-600 transition-colors"
              aria-label="More information">
        <Info size={13} />
      </button>
      {show && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShow(false)} />
          <div className="absolute left-5 top-0 z-50 w-64 p-3 bg-white border
                          border-blue-200 rounded-xl shadow-lg text-xs
                          text-gray-700 leading-relaxed">
            {text}
          </div>
        </>
      )}
    </span>
  )
}

export function ExpenseForm({
  shipmentId, shipmentItems, fxRate, freightUsd,
  insuranceUsd, onSave, onClose, editExpense,
}: ExpenseFormProps) {
  const [category, setCategory]       = useState<Category>('ETHIOPIA_CUSTOMS')
  const [description, setDescription] = useState('')
  const [amount, setAmount]           = useState('')
  const [currency, setCurrency]       = useState<'ETB' | 'USD' | 'CNY'>('ETB')
  const [vendorName, setVendorName]   = useState('')
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0])
  const [receiptRef, setReceiptRef]   = useState('')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)

  // Customs-specific fields
  const [dutyRate, setDutyRate]       = useState(25)
  const [exciseRate, setExciseRate]   = useState(0)
  const [applyVat, setApplyVat]       = useState(true)
  const [applySurtax, setApplySurtax] = useState(true)
  const [applyWht, setApplyWht]       = useState(true)
  const [clearingFee, setClearingFee] = useState(0)
  const [useCalc, setUseCalc]         = useState(true)

  // Pre-fill when editing
  useEffect(() => {
    if (editExpense) {
      setCategory(editExpense.category)
      setDescription(editExpense.description)
      setAmount(String(editExpense.amount))
      setCurrency(editExpense.currency)
      setVendorName(editExpense.vendor_name ?? '')
      setExpenseDate(editExpense.expense_date)
      setReceiptRef(editExpense.receipt_ref ?? '')
    }
  }, [editExpense])

  // Calculate CIF from existing items
  const totalFobUsd = shipmentItems.reduce(
    (s, i) => s + i.quantity * i.unit_price_usd, 0
  )
  const cifUsd      = totalFobUsd + freightUsd + insuranceUsd
  const cifEtb      = cifUsd * fxRate

  // Ethiopian customs cascade calculation
  // Ethiopian customs cascade — correct per ERCA 2024
const calc = useMemo(() => {
  const cifEtb   = cifUsd * fxRate

  // Step 1: Import duty
  const duty     = Math.round(cifEtb * (dutyRate / 100))

  // Step 2: Excise (on CIF + duty base) — Proclamation 307/2002
  // Only applies to: tobacco, alcohol, vehicles, luxury cosmetics, beverages
  // Most electronics/appliances = 0%
  const exciseBase = cifEtb + duty
  const excise   = Math.round(exciseBase * (exciseRate / 100))

  // Step 3: Surtax 10% (on CIF + duty + excise) — Proclamation 249/2001
  // Applies to most consumer goods. Ask clearing agent if exempt.
  const surtaxBase = cifEtb + duty + excise
  const surtax   = applySurtax ? Math.round(surtaxBase * 0.10) : 0

  // Step 4: VAT 15% (on CIF + duty + excise + surtax) — Proclamation 285/2002
  // This is the largest component — the base compounds all previous taxes
  const vatBase  = cifEtb + duty + excise + surtax
  const vat      = applyVat ? Math.round(vatBase * 0.15) : 0

  // Step 5: Withholding tax 3% (on CIF only) — Income Tax Proclamation
  // This is an ADVANCE payment — fully recoverable when filing annual income tax
  // Do NOT treat it as a cost — it's a prepayment
  const wht      = applyWht ? Math.round(cifEtb * 0.03) : 0

  // Step 6: Clearing agent fee (fixed, negotiated)
  const clearing = Math.round(clearingFee)

  // Total tax burden (excluding WHT since it's recoverable)
  const totalNonRecoverable = duty + excise + surtax + vat + clearing
  const totalWithWht        = totalNonRecoverable + wht
  const effectiveRate       = cifEtb > 0 ? (totalNonRecoverable / cifEtb) * 100 : 0

  return {
    cifUsd, cifEtb: Math.round(cifEtb),
    duty, dutyRate,
    excise, exciseRate, exciseBase: Math.round(exciseBase),
    surtax, surtaxBase: Math.round(surtaxBase),
    vat, vatBase: Math.round(vatBase),
    wht,
    clearing,
    totalNonRecoverable,
    totalWithWht,
    effectiveRate: Math.round(effectiveRate * 10) / 10,
  }
}, [cifUsd, fxRate, dutyRate, exciseRate, applySurtax, applyVat, applyWht, clearingFee])

  async function save() {
  if (!description && category !== 'ETHIOPIA_CUSTOMS') {
    setError('Description is required')
    return
  }
  setSaving(true)
  setError(null)

  const isCustomsCalc = category === 'ETHIOPIA_CUSTOMS' && useCalc

  try {
    if (isCustomsCalc) {
      const components: { desc: string; amount: number; note: string }[] = []

      if (calc.duty > 0) {
        components.push({
          desc: 'Customs duty',
          amount: calc.duty,
          note: `${dutyRate}% × CIF ${calc.cifEtb.toLocaleString()} ETB`,
        })
      }
      if (calc.excise > 0) {
        components.push({
          desc: 'Excise tax',
          amount: calc.excise,
          note: `${exciseRate}% × (CIF + Duty)`,
        })
      }
      if (applySurtax && calc.surtax > 0) {
        components.push({
          desc: 'Surtax (10%)',
          amount: calc.surtax,
          note: '10% × (CIF + Duty + Excise)',
        })
      }
      if (applyVat && calc.vat > 0) {
        components.push({
          desc: 'VAT (15%)',
          amount: calc.vat,
          note: '15% × (CIF + Duty + Excise + Surtax)',
        })
      }
      if (applyWht && calc.wht > 0) {
        components.push({
          desc: 'Withholding tax (3%)',
          amount: calc.wht,
          note: '3% × CIF — recoverable against income tax',
        })
      }
      if (calc.clearing > 0) {
        components.push({
          desc: 'Clearing agent fee',
          amount: calc.clearing,
          note: 'Fixed fee',
        })
      }

      if (components.length === 0) {
        setError('No taxes to add. Set a duty rate or enable a tax above.')
        setSaving(false)
        return
      }

      const sourceByDesc: Record<string, AutoExpenseSource> = {
        'Customs duty': 'customs_duty',
        'Excise tax': 'customs_excise',
        'Surtax (10%)': 'customs_surtax',
        'VAT (15%)': 'customs_vat',
        'Withholding tax (3%)': 'customs_wht',
        'Clearing agent fee': 'customs_clearing',
      }

      await replaceAutoExpenses(
        shipmentId,
        'customs',
        components.map(comp => ({
          source: sourceByDesc[comp.desc] ?? 'customs_duty',
          category: 'ETHIOPIA_CUSTOMS',
          description: comp.desc,
          amount: comp.amount,
          currency: 'ETB' as const,
          amountEtb: comp.amount,
          fxRate,
          vendorName: vendorName || 'ERCA',
          expenseDate,
          detailNote: comp.note,
        })),
      )

    } else {
      // Single manual expense
      const amt = parseFloat(amount) || 0
      const amtEtb = currency === 'ETB' ? amt
        : currency === 'USD' ? amt * fxRate
        : amt * (fxRate / 7.2)

      const payload = {
        category,
        description,
        amount: amt,
        currency,
        amount_etb:    Math.round(amtEtb * 100) / 100,
        exchange_rate: fxRate,
        vendor_name:   vendorName || null,
        expense_date:  expenseDate,
        receipt_ref:   receiptRef || null,
        cost_status:   'PROVISIONAL',
      }

      const { error: err2 } = editExpense
        ? await supabase.from('shipment_expenses')
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq('id', editExpense.id)
        : await supabase.from('shipment_expenses')
            .insert({ ...payload, shipment_id: shipmentId })

      if (err2) {
        setError(`Failed to save: ${err2.message}`)
        setSaving(false)
        return
      }
    }

    setSaving(false)
    onSave()
  } catch (e: any) {
    console.error('Unexpected save error:', e)
    setError(`Unexpected error: ${e.message}`)
    setSaving(false)
  }
}

  const CAT_META: Record<Category, { label: string; icon: string; color: string }> = {
    CHINA_ORIGIN:     { label: 'China origin',     icon: '🇨🇳', color: 'border-red-300 bg-red-50 text-red-700'     },
    OCEAN_FREIGHT:    { label: 'Ocean freight',     icon: '🚢', color: 'border-blue-300 bg-blue-50 text-blue-700'   },
    DJIBOUTI_PORT:    { label: 'Djibouti port',     icon: '⚓', color: 'border-cyan-300 bg-cyan-50 text-cyan-700'   },
    TRUCKING:         { label: 'Trucking',           icon: '🚛', color: 'border-orange-300 bg-orange-50 text-orange-700' },
    ETHIOPIA_CUSTOMS: { label: 'Ethiopia customs',  icon: '🛃', color: 'border-purple-300 bg-purple-50 text-purple-700' },
    OTHER:            { label: 'Other',              icon: '📋', color: 'border-gray-300 bg-gray-50 text-gray-600'   },
  }

  const SUGGESTIONS: Record<Category, string[]> = {
    CHINA_ORIGIN:     ['Factory loading', 'Export documentation', 'Inspection fee', 'Banking charges (LC)'],
    OCEAN_FREIGHT:    ['Ocean freight – COSCO', 'Ocean freight – MAERSK', 'BL fee', 'Insurance premium'],
    DJIBOUTI_PORT:    ['Port handling / offloading', 'Warehouse storage (Djibouti)', 'Transit documentation', 'Port dues'],
    TRUCKING:         ['Truck fee – Djibouti to Addis', 'Fuel surcharge', 'Driver allowance', 'Security escort', 'Road toll'],
    ETHIOPIA_CUSTOMS: ['Customs duty', 'VAT on import', 'Surtax', 'Withholding tax', 'Clearing agent fee', 'Port handling (ETH)'],
    OTHER:            ['Demurrage', 'Detention', 'Penalty', 'Bank charge', 'Currency loss'],
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh]
                      overflow-auto shadow-xl">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-medium">
              {editExpense ? 'Edit expense' : 'Add expense'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Rate: {fxRate} ETB / 1 USD
            </p>
          </div>
          <button onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">

          {/* Category picker */}
          <div>
            <label className="block text-xs text-gray-500 mb-2">Category</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(CAT_META) as [Category, any][]).map(([k, v]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setCategory(k)
                    setDescription('')
                    setUseCalc(k === 'ETHIOPIA_CUSTOMS')
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg
                              border text-xs text-left transition-all leading-tight
                    ${category === k
                      ? `${v.color} ring-1 ring-current`
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}
                >
                  <span>{v.icon}</span>
                  <span className="leading-tight">{v.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── ETHIOPIA CUSTOMS — smart calculator ───────── */}
          {category === 'ETHIOPIA_CUSTOMS' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium text-gray-700">Ethiopian customs cascade</p>
                  <InfoTip text="Ethiopian customs taxes are calculated in a specific cascade order as per ERCA Proclamation 622/2009. Each tax is calculated on the cumulative base of previous taxes. This calculator handles the correct order automatically." />
                </div>
                <button
                  onClick={() => setUseCalc(v => !v)}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors
                    ${useCalc
                      ? 'bg-purple-600 text-white border-purple-600'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                >
                  {useCalc ? '✓ Auto-calculate' : 'Manual entry'}
                </button>
              </div>

              {useCalc ? (
                <div className="space-y-4">
                  {/* CIF base */}
                  <div className="bg-gray-50 rounded-xl p-3">
                    <div className="flex items-center gap-1 mb-1">
                      <p className="text-xs font-medium text-gray-600">CIF value (calculated)</p>
                      <InfoTip text="CIF = Cost (FOB) + Insurance + Freight. This is the customs valuation base. It is calculated automatically from your FOB values (PI items) plus your ocean freight and insurance expenses." />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="bg-white rounded-lg p-2 border border-gray-200">
                        <p className="text-gray-400 mb-0.5">FOB value</p>
                        <p className="font-mono font-medium">
                          ${Math.round(totalFobUsd).toLocaleString()}
                        </p>
                      </div>
                      <div className="bg-white rounded-lg p-2 border border-gray-200">
                        <p className="text-gray-400 mb-0.5">+ Freight + Ins</p>
                        <p className="font-mono font-medium">
                          ${Math.round(freightUsd + insuranceUsd).toLocaleString()}
                        </p>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-2 border border-blue-200">
                        <p className="text-blue-600 mb-0.5">= CIF (ETB)</p>
                        <p className="font-mono font-medium text-blue-700">
                          {Math.round(cifEtb).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    {(freightUsd + insuranceUsd) === 0 && (
                      <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                        <Info size={11} />
                        Add ocean freight and insurance expenses first for accurate CIF
                      </p>
                    )}
                  </div>

                  {/* Duty rate */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1">
                        <label className="text-xs text-gray-500">Import duty rate (%)</label>
                        <InfoTip text="The duty rate from the Ethiopian Customs Tariff Schedule based on your product's HS code. Common rates: electronics 0–25%, household appliances 25–35%, vehicles 35%. Ask your clearing agent for the exact rate for your HS code." />
                      </div>
                      <span className="text-xs font-mono font-medium text-purple-700">
                        = {calc.duty.toLocaleString()} ETB
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range" min="0" max="100" step="5"
                        value={dutyRate}
                        onChange={e => setDutyRate(parseInt(e.target.value))}
                        className="flex-1"
                      />
                      <div className="flex items-center gap-1">
                        <input
                          type="number" min="0" max="100" step="0.5"
                          value={dutyRate}
                          onChange={e => setDutyRate(parseFloat(e.target.value) || 0)}
                          className="w-16 px-2 py-1.5 text-xs font-mono text-right border
                                     border-gray-200 rounded-lg focus:outline-none
                                     focus:ring-2 focus:ring-blue-400"
                        />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {[0, 5, 10, 15, 20, 25, 30, 35].map(r => (
                        <button
                          key={r}
                          onClick={() => setDutyRate(r)}
                          className={`text-xs px-2 py-0.5 rounded border transition-colors
                            ${dutyRate === r
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'border-gray-200 hover:bg-gray-50 text-gray-500'}`}
                        >
                          {r}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Excise tax */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1">
                        <label className="text-xs text-gray-500">Excise tax rate (%)</label>
                        <InfoTip text="Excise tax applies only to specific goods listed in Ethiopia's Excise Tax Proclamation No. 307/2002. Common items: vehicles (100%), alcohol (100%), tobacco (100%), cosmetics (10-30%), soft drinks (30%). Most electronics and appliances: 0%." />
                      </div>
                      <span className="text-xs font-mono font-medium text-purple-700">
                        = {calc.excise.toLocaleString()} ETB
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range" min="0" max="100" step="5"
                        value={exciseRate}
                        onChange={e => setExciseRate(parseInt(e.target.value))}
                        className="flex-1"
                      />
                      <div className="flex items-center gap-1">
                        <input
                          type="number" min="0" max="500" step="5"
                          value={exciseRate}
                          onChange={e => setExciseRate(parseFloat(e.target.value) || 0)}
                          className="w-16 px-2 py-1.5 text-xs font-mono text-right border
                                     border-gray-200 rounded-lg focus:outline-none
                                     focus:ring-2 focus:ring-blue-400"
                        />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {[0, 10, 20, 30, 50, 100].map(r => (
                        <button
                          key={r}
                          onClick={() => setExciseRate(r)}
                          className={`text-xs px-2 py-0.5 rounded border transition-colors
                            ${exciseRate === r
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'border-gray-200 hover:bg-gray-50 text-gray-500'}`}
                        >
                          {r}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Toggle switches for other taxes */}
                  <div className="bg-gray-50 rounded-xl p-3 space-y-2.5">
                    <p className="text-xs font-medium text-gray-600 mb-2">
                      Additional levies
                    </p>

                    {/* Surtax */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setApplySurtax(v => !v)}
                          className={`relative w-8 h-4.5 rounded-full border-none
                                      cursor-pointer transition-colors
                            ${applySurtax ? 'bg-blue-600' : 'bg-gray-300'}`}
                          style={{ width: 30, height: 17 }}
                        >
                          <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full
                                            transition-all
                            ${applySurtax ? 'left-3.5' : 'left-0.5'}`}
                                style={{ width: 13, height: 13 }} />
                        </button>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-600">Surtax 10%</span>
                          <InfoTip text="Surtax is 10% applied on (CIF + duty + excise). It applies to most consumer goods imported into Ethiopia under Proclamation 249/2001. Ask your clearing agent if it applies to your HS codes." />
                        </div>
                      </div>
                      <span className={`text-xs font-mono
                        ${applySurtax ? 'text-gray-700 font-medium' : 'text-gray-300'}`}>
                        {calc.surtax.toLocaleString()} ETB
                      </span>
                    </div>

                    {/* VAT */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setApplyVat(v => !v)}
                          className={`relative rounded-full border-none cursor-pointer
                                      transition-colors
                            ${applyVat ? 'bg-blue-600' : 'bg-gray-300'}`}
                          style={{ width: 30, height: 17 }}
                        >
                          <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full
                                            transition-all
                            ${applyVat ? 'left-3.5' : 'left-0.5'}`}
                                style={{ width: 13, height: 13 }} />
                        </button>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-600">VAT 15%</span>
                          <InfoTip text="15% VAT is applied on the entire base including CIF + duty + excise + surtax. This is charged on virtually all imports per Proclamation 285/2002. The base is higher than customs duty because it compounds on top of all previous taxes." />
                        </div>
                      </div>
                      <span className={`text-xs font-mono
                        ${applyVat ? 'text-gray-700 font-medium' : 'text-gray-300'}`}>
                        {calc.vat.toLocaleString()} ETB
                      </span>
                    </div>

                    {/* WHT */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setApplyWht(v => !v)}
                          className={`relative rounded-full border-none cursor-pointer
                                      transition-colors
                            ${applyWht ? 'bg-blue-600' : 'bg-gray-300'}`}
                          style={{ width: 30, height: 17 }}
                        >
                          <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full
                                            transition-all
                            ${applyWht ? 'left-3.5' : 'left-0.5'}`}
                                style={{ width: 13, height: 13 }} />
                        </button>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-600">Withholding tax 3%</span>
                          <InfoTip text="WHT is 3% of CIF value, collected as an advance payment toward your annual income tax liability. Unlike other taxes, this is RECOVERABLE — you can claim it back when filing your annual tax return with ERCA. Always keep the WHT receipt." />
                        </div>
                      </div>
                      <span className={`text-xs font-mono
                        ${applyWht ? 'text-green-700 font-medium' : 'text-gray-300'}`}>
                        {calc.wht.toLocaleString()} ETB
                        {applyWht && (
                          <span className="text-green-500 text-xs ml-1">(recoverable)</span>
                        )}
                      </span>
                    </div>

                    {/* Clearing fee */}
                    <div className="flex items-center justify-between pt-1 border-t border-gray-200">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-600">Clearing agent fee</span>
                        <InfoTip text="Fixed fee charged by your clearing agent for handling the customs paperwork. Typically 0.5–2% of CIF value or a fixed ETB amount negotiated with your agent. Enter the actual amount agreed with your agent." />
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={clearingFee || ''}
                          onChange={e => setClearingFee(parseFloat(e.target.value) || 0)}
                          className="w-24 px-2 py-1 text-xs font-mono text-right border
                                     border-gray-200 rounded-lg focus:outline-none
                                     focus:ring-2 focus:ring-blue-400"
                          placeholder="0"
                        />
                        <span className="text-xs text-gray-400">ETB</span>
                      </div>
                    </div>
                  </div>

                  {/* Total cascade summary */}
                  <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
                    <p className="text-xs font-medium text-purple-800 mb-2">
                      Total customs tax cascade
                    </p>
                    <div className="space-y-1">
                      {[
                        { label: `Duty (${dutyRate}% × CIF)`,         val: calc.duty, show: true },
                        { label: `Excise (${exciseRate}%)`,           val: calc.excise,  show: exciseRate > 0 },
                        { label: 'Surtax (10%)',                       val: calc.surtax,     show: applySurtax },
                        { label: 'VAT (15% on full base)',             val: calc.vat,        show: applyVat },
                        { label: 'WHT (3% of CIF — recoverable)',      val: calc.wht,        show: applyWht },
                        { label: 'Clearing agent fee',                 val: calc.clearing , show: clearingFee > 0 },
                      ].filter(r => r.show).map(row => (
                        <div key={row.label}
                             className="flex justify-between text-xs">
                          <span className="text-purple-700">{row.label}</span>
                          <span className="font-mono font-medium text-purple-900">
                            {row.val.toLocaleString()} ETB
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between text-sm font-medium
                                      pt-2 border-t border-purple-200 mt-1">
                        <span className="text-purple-900">Total payable</span>
                        <span className="font-mono text-purple-900">
                          {calc.totalWithWht.toLocaleString()} ETB
                        </span>
                      </div>
                      <p className="text-xs text-purple-600 mt-1">
                        Effective rate: {calc.effectiveRate}% of CIF value
                      </p>
                    </div>
                  </div>

                  {/* Meta fields for customs */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        Vendor (paid to)
                      </label>
                      <input
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                                   focus:outline-none focus:ring-2 focus:ring-blue-400"
                        value={vendorName}
                        onChange={e => setVendorName(e.target.value)}
                        placeholder="ERCA"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Date paid</label>
                      <input
                        type="date"
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                                   focus:outline-none focus:ring-2 focus:ring-blue-400"
                        value={expenseDate}
                        onChange={e => setExpenseDate(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      ERCA receipt / declaration ref
                    </label>
                    <input
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                                 focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                      value={receiptRef}
                      onChange={e => setReceiptRef(e.target.value)}
                      placeholder="Customs declaration number"
                    />
                  </div>
                </div>
              ) : (
                // Manual entry for customs
                <ManualEntry
                  description={description} setDescription={setDescription}
                  amount={amount} setAmount={setAmount}
                  currency={currency} setCurrency={setCurrency}
                  vendorName={vendorName} setVendorName={setVendorName}
                  expenseDate={expenseDate} setExpenseDate={setExpenseDate}
                  receiptRef={receiptRef} setReceiptRef={setReceiptRef}
                  fxRate={fxRate} suggestions={SUGGESTIONS[category]}
                />
              )}
            </div>
          )}

          {/* ── ALL OTHER CATEGORIES — standard form ──────── */}
          {category !== 'ETHIOPIA_CUSTOMS' && (
            <ManualEntry
              description={description} setDescription={setDescription}
              amount={amount} setAmount={setAmount}
              currency={currency} setCurrency={setCurrency}
              vendorName={vendorName} setVendorName={setVendorName}
              expenseDate={expenseDate} setExpenseDate={setExpenseDate}
              receiptRef={receiptRef} setReceiptRef={setReceiptRef}
              fxRate={fxRate} suggestions={SUGGESTIONS[category]}
              categoryHints={CAT_HINTS[category]}
            />
          )}

          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg
                            text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs text-gray-600 border border-gray-200
                       rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white
                       text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50
                       transition-colors min-w-[140px] justify-center"
          >
            {saving
              ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
              : <><Check size={12} /> {
                  category === 'ETHIOPIA_CUSTOMS' && useCalc
                    ? `Save ${[
                        true,
                        exciseRate > 0,
                        applySurtax,
                        applyVat,
                        applyWht,
                        clearingFee > 0,
                      ].filter(Boolean).length} expense lines`
                    : editExpense ? 'Save changes' : 'Add expense'
                }</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

// Category-specific hints
const CAT_HINTS: Record<string, string> = {
  CHINA_ORIGIN:  'Costs incurred in China before the shipment leaves. These include factory loading, export documentation, inspection fees (e.g. SGS), and banking charges for LC opening.',
  OCEAN_FREIGHT: 'Cost of shipping from Chinese port to Djibouti. Enter the total for the container. Insurance is typically 0.3–0.5% of CIF value and is required by most banks for LC shipments.',
  DJIBOUTI_PORT: 'Costs at Djibouti port: offloading the container from the vessel, storage in the Djibouti warehouse while awaiting truck, and port documentation.',
  TRUCKING:      'Cost of road transport from Djibouti to your warehouse in Addis Ababa (approximately 900 km). Typically includes fuel, driver allowance, and security. Enter the total truck fee.',
  OTHER:         'Any cost that doesn\'t fit the above categories. Demurrage (daily charge when container overstays free period at port) and detention (charge when container is held too long) are common.',
}

// Manual entry sub-component
function ManualEntry({
  description, setDescription, amount, setAmount,
  currency, setCurrency, vendorName, setVendorName,
  expenseDate, setExpenseDate, receiptRef, setReceiptRef,
  fxRate, suggestions, categoryHints,
}: any) {
  return (
    <div className="space-y-3">
      {categoryHints && (
        <div className="flex items-start gap-2 px-3 py-2 bg-blue-50 border
                        border-blue-100 rounded-lg text-xs text-blue-700">
          <Info size={12} className="shrink-0 mt-0.5" />
          <span>{categoryHints}</span>
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Description <span className="text-red-400">*</span>
        </label>
        <input
          list="exp-suggestions"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="e.g. Ocean freight – COSCO"
        />
        <datalist id="exp-suggestions">
          {suggestions?.map((s: string) => <option key={s} value={s} />)}
        </datalist>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Amount <span className="text-red-400">*</span>
          </label>
          <input
            type="number" step="0.01"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Currency</label>
          <select
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            value={currency}
            onChange={e => setCurrency(e.target.value as any)}
          >
            <option value="ETB">ETB — Birr</option>
            <option value="USD">USD — Dollar</option>
            <option value="CNY">CNY — Yuan</option>
          </select>
        </div>
      </div>

      {amount && currency !== 'ETB' && (
        <div className="flex items-center justify-between px-3 py-2
                        bg-amber-50 rounded-lg">
          <span className="text-xs text-amber-700">Converts to</span>
          <span className="text-sm font-medium font-mono text-amber-700">
            {Math.round(
              currency === 'USD'
                ? parseFloat(amount) * fxRate
                : parseFloat(amount) * (fxRate / 7.2)
            ).toLocaleString()} ETB
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Vendor / paid to</label>
          <input
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={vendorName}
            onChange={e => setVendorName(e.target.value)}
            placeholder="e.g. COSCO Shipping"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Date</label>
          <input
            type="date"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={expenseDate}
            onChange={e => setExpenseDate(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Receipt / invoice reference
        </label>
        <input
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
          value={receiptRef}
          onChange={e => setReceiptRef(e.target.value)}
          placeholder="e.g. INV-2026-0045"
        />
      </div>
    </div>
  )
}