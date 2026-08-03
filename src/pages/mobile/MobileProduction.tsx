import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchWarehousesList } from '../../api/income'
import { logProductionQuick } from '../../lib/productionLogging'
import { fetchProductionPlanningCompanies } from '../../api/warehouseOperations'
import type { OperationalCompany } from '../../api/warehouseOperations'
import { Wrench, Loader2, Check, Package, AlertTriangle, Factory, ArrowRight, Clock3, Layers3 } from 'lucide-react'
import { SelectMenu } from '../../components/ui/SelectMenu'

interface BomOption { id: string; name: string; productName: string; stage: string }
interface Option { id: string; name: string }
interface RecentLog { id: string; log_date: string; quantity_produced: number; productName: string }
interface BomRow { id: string; name: string; stage: string | null; product_id: string | null; finished_product_id: string | null }
interface ProductRow { id: string; name: string }
interface EmbeddedBom { product_id: string | null; finished_product_id: string | null }
interface EmbeddedOrder { bom_headers: EmbeddedBom | EmbeddedBom[] | null }
interface RecentLogRow {
  id: string
  log_date: string
  quantity_produced: number | null
  bom_header_id: string | null
  production_orders: EmbeddedOrder | EmbeddedOrder[] | null
}

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))
const one = <T,>(value: T | T[] | null | undefined): T | null => Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback
const today = () => new Date().toISOString().split('T')[0]
const shortDate = new Intl.DateTimeFormat('en-ET', { month: 'short', day: 'numeric' })

function MobileStat({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  hint,
}: {
  label: string
  value: string
  icon: typeof Factory
  tone?: 'neutral' | 'accent' | 'good' | 'subtle'
  hint?: string
}) {
  const toneClasses = tone === 'accent'
    ? 'bg-accent/18 text-accent border-accent/25'
    : tone === 'good'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
      : tone === 'subtle'
        ? 'bg-gray-50 text-gray-500 border-gray-100'
        : 'bg-slate-50 text-slate-600 border-slate-100'

  return (
    <article className="rounded-card border bg-white p-3 shadow-[var(--shadow-card-sm)]">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl border ${toneClasses}`}>
        <Icon size={17} strokeWidth={1.7} />
      </div>
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-gray-900">{value}</p>
      {hint && <p className="mt-1 text-[10px] leading-tight text-gray-500">{hint}</p>}
    </article>
  )
}

export function MobileProduction() {
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [companies, setCompanies] = useState<OperationalCompany[]>([])
  const [companyId, setCompanyId] = useState('')
  const [boms, setBoms] = useState<BomOption[]>([])
  const [recent, setRecent] = useState<RecentLog[]>([])
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [warehouseRows, bomRows, companyRows] = await Promise.all([
        fetchWarehousesList(),
        supabase.from('bom_headers').select('id, name, stage, product_id, finished_product_id').eq('is_active', true),
        fetchProductionPlanningCompanies().catch(() => []),
      ])
      const warehouseOptions = (warehouseRows ?? []) as Option[]
      setWarehouses(warehouseOptions.map(warehouse => ({ id: warehouse.id, name: warehouse.name })))
      setWarehouseId(prev => prev || (warehouseRows?.[0]?.id ?? ''))
      setCompanies(companyRows)
      setCompanyId(prev => (
        companyRows.some(company => company.id === prev)
          ? prev
          : companyRows.find(company => company.is_primary)?.id ?? companyRows[0]?.id ?? ''
      ))

      const rows = (bomRows.data ?? []) as BomRow[]
      const productIds = [...new Set(rows
        .map(row => row.product_id ?? row.finished_product_id)
        .filter((id): id is string => Boolean(id)))]
      const { data: products } = productIds.length > 0
        ? await supabase.from('products').select('id, name').in('id', productIds)
        : { data: [] }
      const nameById = new Map(((products ?? []) as ProductRow[]).map(product => [product.id, product.name]))
      const bomOptions = rows.map(row => ({
        id: row.id,
        name: row.name,
        stage: row.stage ?? 'ASSEMBLY',
        productName: nameById.get(row.product_id ?? row.finished_product_id ?? '') ?? 'Unknown product',
      }))
      setBoms(bomOptions)

      const { data: logs } = await supabase
        .from('production_daily_logs')
        .select('id, log_date, quantity_produced, bom_header_id, production_orders(bom_headers(product_id, finished_product_id))')
        .order('log_date', { ascending: false })
        .limit(10)
      setRecent(((logs ?? []) as RecentLogRow[]).map(log => {
        const orderBom = one(one(log.production_orders)?.bom_headers)
        const bomHeaderId = log.bom_header_id ?? null
        const productName = bomHeaderId
          ? bomOptions.find(bom => bom.id === bomHeaderId)?.productName
          : nameById.get(orderBom?.product_id ?? orderBom?.finished_product_id ?? '')
        return { id: log.id, log_date: log.log_date, quantity_produced: Number(log.quantity_produced ?? 0), productName: productName ?? 'Production' }
      }))
    } catch (caught) {
      setError(message(caught, 'Failed to load.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const selectedWarehouse = useMemo(
    () => warehouses.find(warehouse => warehouse.id === warehouseId) ?? null,
    [warehouseId, warehouses],
  )
  const selectedCompany = useMemo(
    () => companies.find(company => company.id === companyId) ?? null,
    [companyId, companies],
  )
  const todayLogs = useMemo(() => recent.filter(log => log.log_date === today()), [recent])
  const totalRecent = useMemo(() => recent.reduce((sum, log) => sum + log.quantity_produced, 0), [recent])
  const todaysQuantity = useMemo(() => todayLogs.reduce((sum, log) => sum + log.quantity_produced, 0), [todayLogs])

  async function logOne(bomId: string) {
    const qty = Number(entries[bomId] ?? '0')
    if (!warehouseId) { setError('Choose a warehouse first.'); return }
    if (!companyId) { setError('Choose the company for this production log.'); return }
    if (!qty || qty <= 0) { setError('Enter a quantity greater than 0.'); return }
    setSavingId(bomId)
    setError(null)
    setSuccess(null)
    try {
      await logProductionQuick(bomId, warehouseId, qty, undefined, today(), companyId)
      setEntries(prev => ({ ...prev, [bomId]: '' }))
      const bom = boms.find(b => b.id === bomId)
      setSuccess(`Logged ${qty} × ${bom?.productName ?? 'product'}`)
      await load()
    } catch (caught) {
      setError(message(caught, 'Failed to log production.'))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="mobile-production-shell">
      <div className="mobile-production-hero">
        <div>
          <p className="mobile-production-eyebrow">
            <Wrench size={12} strokeWidth={1.8} />
            Production
          </p>
          <h1>Floor output on the move</h1>
          <p>Log production from a phone, then jump into the full warehouse operations workspace when you need batches, payroll or approvals.</p>
        </div>
        <Link to="/warehouse-operations?tab=production" className="mobile-production-ops-link">
          Open ops
          <ArrowRight size={13} />
        </Link>
      </div>

      <div className="mobile-production-summary">
        <MobileStat
          label="Warehouse"
          value={selectedWarehouse?.name ?? 'Choose one'}
          icon={Factory}
          tone={selectedWarehouse ? 'accent' : 'subtle'}
          hint={selectedWarehouse ? 'Selected for live logging' : 'Required for every entry'}
        />
        <MobileStat
          label="Company"
          value={selectedCompany?.name ?? 'Choose one'}
          icon={Layers3}
          tone={selectedCompany ? 'good' : 'subtle'}
          hint={selectedCompany?.is_primary ? 'Primary company scope' : 'Company-scoped logging'}
        />
        <MobileStat
          label="Today"
          value={N(todaysQuantity)}
          icon={Clock3}
          tone="neutral"
          hint="Units logged today"
        />
        <MobileStat
          label="Recent logs"
          value={N(totalRecent)}
          icon={Package}
          tone="neutral"
          hint="Last 10 production entries"
        />
      </div>

      <div className="mobile-production-filters">
        <SelectMenu
          ariaLabel="Mobile production warehouse"
          searchable
          value={warehouseId}
          onChange={setWarehouseId}
          options={[
            { value: '', label: 'Choose warehouse' },
            ...warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name })),
          ]}
        />
        <SelectMenu
          ariaLabel="Mobile production company"
          searchable
          value={companyId}
          onChange={setCompanyId}
          options={[
            { value: '', label: companies.length ? 'Choose company' : 'No company access', disabled: companies.length === 0 },
            ...companies.map(company => ({
              value: company.id,
              label: company.name,
              description: company.is_primary ? 'Primary company' : undefined,
            })),
          ]}
        />
      </div>

      {error && (
        <div className="mobile-production-alert is-error" role="alert">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {success && <div className="mobile-production-alert is-success">{success}</div>}

      {loading ? (
        <div className="mobile-production-loading">
          <Loader2 size={18} className="animate-spin" />
          Loading…
        </div>
      ) : boms.length === 0 ? (
        <div className="mobile-production-empty">
          <strong>No active BOMs</strong>
          <span>Set one up on the full version first, then come back here to log output fast.</span>
        </div>
      ) : (
        <div className="mobile-production-list">
          {boms.map(bom => (
            <article key={bom.id} className="mobile-production-card">
              <div className="mobile-production-card__head">
                <div className="mobile-production-card__icon">
                  <Package size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">{bom.productName}</p>
                  <p className="truncate text-[11px] text-gray-500">
                    {bom.name} · {bom.stage.replaceAll('_', ' ').toLowerCase()}
                  </p>
                </div>
              </div>
              <div className="mobile-production-card__controls">
                <label className="mobile-production-quantity">
                  <span>Qty</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={entries[bom.id] ?? ''}
                    onChange={e => setEntries(prev => ({ ...prev, [bom.id]: e.target.value }))}
                    placeholder="0"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => logOne(bom.id)}
                  disabled={savingId === bom.id}
                  className="mobile-production-log-button"
                >
                  {savingId === bom.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Log
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <section className="mobile-production-recent">
          <div className="mobile-production-recent__head">
            <p>Recent activity</p>
            <span>{recent.length} entries</span>
          </div>
          <div className="mobile-production-recent__list">
            {recent.map((log, index) => (
              <div key={log.id} className={`mobile-production-recent__item${index < recent.length - 1 ? ' has-divider' : ''}`}>
                <div className="min-w-0">
                  <strong>{log.productName}</strong>
                  <span>{shortDate.format(new Date(`${log.log_date}T12:00:00`))}</span>
                </div>
                <b>+{N(log.quantity_produced)}</b>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
