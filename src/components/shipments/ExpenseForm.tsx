import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { Check, Loader2, X, Info } from 'lucide-react'

interface ExpenseFormProps {
  shipmentId: string
  fxRate: number
  onSave: () => void
  onClose: () => void
  editExpense?: any
}

// ETHIOPIA_CUSTOMS stays a valid category so an existing customs-tagged row
// (created from the dedicated Customs tab) can still be opened here for a
// plain manual edit — it just isn't offered as a category for a *new*
// expense anymore; the Customs tab is the only place that creates those.
type Category =
  | 'CHINA_ORIGIN'
  | 'OCEAN_FREIGHT'
  | 'DJIBOUTI_PORT'
  | 'TRUCKING'
  | 'ETHIOPIA_CUSTOMS'
  | 'OTHER'

// Categories that are conventionally billed per-container in this trade
// (ocean freight, port handling, trucking) rather than as one flat number —
// letting the user enter a per-container rate and multiplying by the
// shipment's actual container count avoids manual arithmetic (and the
// mistakes that come with it) every time a shipment has more than one box.
const PER_CONTAINER_CATEGORIES: Category[] = ['OCEAN_FREIGHT', 'DJIBOUTI_PORT', 'TRUCKING']

export function ExpenseForm({
  shipmentId, fxRate, onSave, onClose, editExpense,
}: ExpenseFormProps) {
  const [category, setCategory]       = useState<Category>('OCEAN_FREIGHT')
  const [description, setDescription] = useState('')
  const [amount, setAmount]           = useState('')
  const [currency, setCurrency]       = useState<'ETB' | 'USD' | 'CNY'>('ETB')
  const [vendorName, setVendorName]   = useState('')
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0])
  const [receiptRef, setReceiptRef]   = useState('')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [containerCount, setContainerCount] = useState(0)
  const [perContainer, setPerContainer] = useState(false)
  const [ratePerContainer, setRatePerContainer] = useState('')

  useEffect(() => {
    supabase.from('containers').select('id', { count: 'exact', head: true }).eq('shipment_id', shipmentId)
      .then(({ count }) => setContainerCount(count ?? 0))
  }, [shipmentId])

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

  // Keep the total in sync with rate × container count while the toggle is on.
  useEffect(() => {
    if (!perContainer || containerCount <= 0) return
    const rate = parseFloat(ratePerContainer)
    if (rate > 0) setAmount(String(Math.round(rate * containerCount * 100) / 100))
  }, [perContainer, ratePerContainer, containerCount])

  async function save() {
    if (!description) {
      setError('Description is required')
      return
    }
    setSaving(true)
    setError(null)

    try {
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
      className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4"
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

          {/* Category picker — ETHIOPIA_CUSTOMS is deliberately not offered
              here; the Customs tab is the only place that creates a fresh
              customs line. It stays a valid Category so an existing one can
              still be edited (pre-filled via editExpense below). */}
          <div>
            <label className="block text-xs text-gray-500 mb-2">Category</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(CAT_META) as [Category, any][]).filter(([k]) => k !== 'ETHIOPIA_CUSTOMS').map(([k, v]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setCategory(k)
                    setDescription('')
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

          <ManualEntry
            description={description} setDescription={setDescription}
            amount={amount} setAmount={setAmount}
            currency={currency} setCurrency={setCurrency}
            vendorName={vendorName} setVendorName={setVendorName}
            expenseDate={expenseDate} setExpenseDate={setExpenseDate}
            receiptRef={receiptRef} setReceiptRef={setReceiptRef}
            fxRate={fxRate} suggestions={SUGGESTIONS[category]}
            categoryHints={CAT_HINTS[category]}
            containerCount={containerCount}
            allowPerContainer={PER_CONTAINER_CATEGORIES.includes(category)}
            perContainer={perContainer} setPerContainer={setPerContainer}
            ratePerContainer={ratePerContainer} setRatePerContainer={setRatePerContainer}
          />


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
              : <><Check size={12} /> {editExpense ? 'Save changes' : 'Add expense'}</>
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
  containerCount, allowPerContainer, perContainer, setPerContainer,
  ratePerContainer, setRatePerContainer,
}: any) {
  const [showHint, setShowHint] = useState(false)
  return (
    <div className="space-y-3">
      {categoryHints && (
        showHint ? (
          <div className="flex items-start gap-2 px-3 py-2 bg-blue-50 border
                          border-blue-100 rounded-lg text-xs text-blue-700">
            <Info size={12} className="shrink-0 mt-0.5" />
            <span>{categoryHints}</span>
            <button onClick={() => setShowHint(false)} className="ml-auto text-blue-300 hover:text-blue-500 shrink-0">
              <X size={11} />
            </button>
          </div>
        ) : (
          <button onClick={() => setShowHint(true)} type="button"
            className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700">
            <Info size={12} /> What counts here?
          </button>
        )
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

      {allowPerContainer && containerCount > 0 && (
        <label className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={perContainer} onChange={e => setPerContainer(e.target.checked)} />
          Bill per container — this shipment has <span className="font-medium">{containerCount}</span> container{containerCount === 1 ? '' : 's'}
        </label>
      )}

      {allowPerContainer && perContainer && containerCount > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Rate per container <span className="text-red-400">*</span>
            </label>
            <input
              type="number" step="0.01"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                         focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
              value={ratePerContainer}
              onChange={e => setRatePerContainer(e.target.value)}
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
          <div className="col-span-2 flex items-center justify-between px-3 py-2 bg-blue-50 rounded-lg text-xs text-blue-700">
            <span>{ratePerContainer || 0} × {containerCount} container{containerCount === 1 ? '' : 's'}</span>
            <span className="font-mono font-medium">Total: {amount || 0} {currency}</span>
          </div>
        </div>
      ) : (
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
      )}

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
