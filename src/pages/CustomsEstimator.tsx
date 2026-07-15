import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Calculator, Info, AlertTriangle } from 'lucide-react'

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 2 }).format(n)

function Row({ label, value, tip, bold }: { label: string; value: string; tip?: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-4 py-2 text-sm ${bold ? 'font-medium' : ''}`}>
      <span className="flex items-center gap-1.5 text-gray-600">
        {label}
        {tip && <InfoTip text={tip} />}
      </span>
      <span className={`font-mono ${bold ? 'text-blue-700' : 'text-gray-900'}`}>{value}</span>
    </div>
  )
}

function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-block">
      <button
        onClick={() => setShow(v => !v)}
        className="text-blue-400 hover:text-blue-600 transition-colors"
        aria-label="More information"
        type="button"
      >
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

export function CustomsEstimator() {
  const [fobUsd, setFobUsd] = useState('')
  const [freightUsd, setFreightUsd] = useState('')
  const [insuranceUsd, setInsuranceUsd] = useState('')
  const [fxRate, setFxRate] = useState('')
  const [rateAgeDays, setRateAgeDays] = useState<number | null>(null)
  const [dutyPct, setDutyPct] = useState('')
  const [excisePct, setExcisePct] = useState('0')
  const [quantity, setQuantity] = useState('')

  useEffect(() => {
    supabase.from('forex_rates').select('rate, effective_date')
      .eq('from_currency', 'USD').eq('to_currency', 'ETB').eq('rate_type', 'CUSTOMS')
      .order('effective_date', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (data?.[0]) {
          setFxRate(String(data[0].rate))
          setRateAgeDays(Math.floor((Date.now() - new Date(data[0].effective_date).getTime()) / 86400000))
        }
      })
  }, [])

  const result = useMemo(() => {
    const fob = Number(fobUsd) || 0
    const freight = Number(freightUsd) || 0
    const insurance = Number(insuranceUsd) || 0
    const rate = Number(fxRate) || 0
    const duty = Number(dutyPct) || 0
    const excise = Number(excisePct) || 0
    const qty = Number(quantity) || 0

    const cifUsd = fob + freight + insurance
    const cifEtb = cifUsd * rate

    const dutyEtb = cifEtb * (duty / 100)
    const exciseEtb = (cifEtb + dutyEtb) * (excise / 100)
    const vatBase = cifEtb + dutyEtb + exciseEtb
    const vatEtb = vatBase * 0.15
    const surtaxBase = cifEtb + dutyEtb + vatEtb + exciseEtb
    const surtaxEtb = surtaxBase * 0.10
    const withholdingEtb = cifEtb * 0.03

    const totalTaxesEtb = dutyEtb + exciseEtb + vatEtb + surtaxEtb + withholdingEtb
    const totalPayableEtb = cifEtb + totalTaxesEtb

    return {
      cifUsd, cifEtb, dutyEtb, exciseEtb, vatEtb, surtaxEtb, withholdingEtb,
      totalTaxesEtb, totalPayableEtb,
      perUnitEtb: qty > 0 ? totalPayableEtb / qty : null,
    }
  }, [fobUsd, freightUsd, insuranceUsd, fxRate, dutyPct, excisePct, quantity])

  const hasInput = Number(fobUsd) > 0 && Number(fxRate) > 0 && dutyPct !== ''

  return (
    <div className="p-5 max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-medium flex items-center gap-2">
          <Calculator size={18} /> Customs Cost Estimator
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Estimate duty, VAT, surtax, and withholding tax before a shipment clears customs
        </p>
      </div>

      <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200
                      rounded-xl text-xs text-amber-800 mb-4">
        <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-500" />
        <div>
          <p className="font-medium mb-0.5">Estimate only — not a customs valuation</p>
          <p className="leading-relaxed">
            Duty rates depend on the exact HS code your clearing agent assigns (statutory range
            is roughly 10–35%) and ERCA makes the final valuation call. Use this to plan cash flow
            before a shipment arrives, then record the real figures from your clearing agent's
            paperwork as actual expenses on the shipment.
          </p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Shipment value</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">FOB value (USD)</label>
              <input type="number" value={fobUsd} onChange={e => setFobUsd(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-blue-400" placeholder="10000" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Freight (USD)</label>
              <input type="number" value={freightUsd} onChange={e => setFreightUsd(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-blue-400" placeholder="1200" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Insurance (USD)</label>
              <input type="number" value={insuranceUsd} onChange={e => setInsuranceUsd(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-blue-400" placeholder="Optional" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-1 mb-1">
                <label className="text-xs text-gray-500">Customs FX rate (USD → ETB)</label>
                <InfoTip text="Prefilled from Settings → Exchange rates. Confirm with your clearing agent — ERCA's valuation rate can differ from bank-negotiated rates since the 2024 FX reform." />
              </div>
              <input type="number" value={fxRate} onChange={e => setFxRate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono" />
              {rateAgeDays !== null && rateAgeDays > 3 && (
                <p className="text-xs text-amber-600 mt-1">{rateAgeDays} days old — confirm before use</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Quantity (optional, for per-unit cost)</label>
              <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-blue-400" placeholder="500" />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Tax rates</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-1 mb-1">
                <label className="text-xs text-gray-500">Customs duty rate (%)</label>
                <InfoTip text="Statutory range is 10–35% depending on HS code classification. Look up your item's HS code on the ERCA tariff portal, or ask your clearing agent." />
              </div>
              <input type="number" value={dutyPct} onChange={e => setDutyPct(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-blue-400" placeholder="e.g. 20" />
            </div>
            <div>
              <div className="flex items-center gap-1 mb-1">
                <label className="text-xs text-gray-500">Excise tax rate (%)</label>
                <InfoTip text="Only applies to selected goods (vehicles, alcohol, tobacco, sugar, etc). Leave at 0 for general merchandise." />
              </div>
              <input type="number" value={excisePct} onChange={e => setExcisePct(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                           focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          <p className="text-xs text-gray-400">
            VAT (15%), surtax (10%), and withholding tax (3%) are applied automatically at their
            standard statutory rates.
          </p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Estimated breakdown</p>
        </div>
        {!hasInput ? (
          <div className="p-8 text-center text-xs text-gray-400">
            Enter FOB value, FX rate, and duty rate to see the estimate.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            <Row label="CIF value" value={`${N(result.cifUsd)} USD  ·  ${N(result.cifEtb)} ETB`} />
            <Row label="Customs duty" value={`${N(result.dutyEtb)} ETB`} tip="CIF × duty rate" />
            {Number(excisePct) > 0 && (
              <Row label="Excise tax" value={`${N(result.exciseEtb)} ETB`} tip="(CIF + Duty) × excise rate" />
            )}
            <Row label="VAT (15%)" value={`${N(result.vatEtb)} ETB`} tip="(CIF + Duty + Excise) × 15%" />
            <Row label="Surtax (10%)" value={`${N(result.surtaxEtb)} ETB`} tip="(CIF + Duty + VAT + Excise) × 10%" />
            <Row
              label="Withholding tax (3%)"
              value={`${N(result.withholdingEtb)} ETB`}
              tip="CIF × 3% — an advance payment against your annual profit tax, creditable when you file. Not a permanent cost, but you do need the cash at clearing."
            />
            <Row label="Total taxes" value={`${N(result.totalTaxesEtb)} ETB`} />
            <Row label="Total payable at clearing" value={`${N(result.totalPayableEtb)} ETB`} bold />
            {result.perUnitEtb !== null && (
              <Row label="Per unit (incl. taxes)" value={`${N(result.perUnitEtb)} ETB`} bold />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
