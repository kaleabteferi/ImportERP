import { useState, useEffect, useCallback } from 'react'
import { fetchBoms, fetchAllProducts, createBom, setBomActive, deleteBom } from '../api/bom'
import type { BomStage } from '../api/bom'
import { ListTree, Loader2, Plus, X, Trash2, Power, Sticker, Wrench, Boxes } from 'lucide-react'

interface ProductOption { id: string; name: string; sku: string }
interface BomLine { componentProductId: string; quantityRequired: number }
interface Bom {
  id: string; name: string; isActive: boolean; notes: string | null; stage: BomStage
  productId: string; productName: string; productSku: string
  lines: Array<{ id: string; componentProductId: string; componentName: string; componentSku: string; quantityRequired: number }>
}

const STAGE_INFO: Record<BomStage, { label: string; icon: typeof Wrench; hint: string }> = {
  ASSEMBLY: { label: 'Assembly', icon: Wrench, hint: 'Builds the finished product from raw/SKD/CKD components' },
  STICKER: { label: 'Sticker Application', icon: Sticker, hint: 'Consumes a sticker/label per unit — component in, same product out' },
  OTHER: { label: 'Other', icon: Boxes, hint: 'Any other post-assembly production step' },
}

function NewBomForm({ products, onDone, onCancel }: {
  products: ProductOption[]; onDone: () => void; onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [productId, setProductId] = useState('')
  const [stage, setStage] = useState<BomStage>('ASSEMBLY')
  const [lines, setLines] = useState<BomLine[]>([{ componentProductId: '', quantityRequired: 1 }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addLine() { setLines([...lines, { componentProductId: '', quantityRequired: 1 }]) }
  function removeLine(i: number) { setLines(lines.filter((_, idx) => idx !== i)) }
  function updateLine(i: number, patch: Partial<BomLine>) {
    setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }

  async function submit() {
    if (!name.trim()) { setError('Name this BOM (e.g. "TV Model X — CKD assembly").'); return }
    if (!productId) { setError('Choose the finished product this BOM builds.'); return }
    const validLines = lines.filter(l => l.componentProductId && l.quantityRequired > 0)
    if (validLines.length === 0) { setError('Add at least one component.'); return }
    setSaving(true); setError(null)
    try {
      await createBom({ name, productId, lines: validLines, stage })
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create BOM.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input value={name} onChange={e => setName(e.target.value)} placeholder="BOM name"
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />

      <div>
        <p className="text-xs font-medium text-gray-500 mb-1.5">Production stage</p>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(STAGE_INFO) as BomStage[]).map(s => {
            const info = STAGE_INFO[s]
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStage(s)}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-center
                  ${stage === s ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <info.icon size={16} className={stage === s ? 'text-blue-600' : 'text-gray-400'} />
                <span className="text-[11px] font-medium">{info.label}</span>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-gray-400 mt-1">{STAGE_INFO[stage].hint}</p>
      </div>

      <select value={productId} onChange={e => setProductId(e.target.value)}
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
        <option value="">{stage === 'ASSEMBLY' ? 'Finished product this BOM assembles' : 'Product this stage applies to'}</option>
        {products.map(p => <option key={p.id} value={p.id}>{p.name} {p.sku && `(${p.sku})`}</option>)}
      </select>

      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-500">
          {stage === 'ASSEMBLY' ? 'Components required' : 'Materials consumed per unit (e.g. the sticker itself)'}
        </p>
        {lines.map((line, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select value={line.componentProductId} onChange={e => updateLine(i, { componentProductId: e.target.value })}
              className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white">
              <option value="">Component product</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name} {p.sku && `(${p.sku})`}</option>)}
            </select>
            <input type="number" value={line.quantityRequired}
              onChange={e => updateLine(i, { quantityRequired: Number(e.target.value) })}
              placeholder="Qty per unit" className="w-28 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
            <button onClick={() => removeLine(i)} className="p-1.5 text-gray-400 hover:text-red-500">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button onClick={addLine} className="text-xs text-blue-600 flex items-center gap-1">
          <Plus size={12} /> Add component
        </button>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200">Cancel</button>
        <button onClick={submit} disabled={saving}
          className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Create BOM'}
        </button>
      </div>
    </div>
  )
}

function BomCard({ bom, onToggle, onRemove }: { bom: Bom; onToggle: () => void; onRemove: () => void }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{bom.name}</p>
          <p className="text-xs text-gray-400">{bom.productName} {bom.productSku && `(${bom.productSku})`}</p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${bom.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {bom.isActive ? 'Active' : 'Inactive'}
        </span>
        <button onClick={onToggle} className="p-1.5 text-gray-400 hover:text-blue-600" title={bom.isActive ? 'Deactivate' : 'Activate'}>
          <Power size={14} />
        </button>
        <button onClick={onRemove} className="p-1.5 text-gray-400 hover:text-red-500" title="Delete">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="px-4 py-2 space-y-1">
        {bom.lines.map(line => (
          <div key={line.id} className="flex justify-between text-xs text-gray-600">
            <span>{line.componentName} {line.componentSku && `(${line.componentSku})`}</span>
            <span className="text-gray-400">{line.quantityRequired} per unit</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Boms() {
  const [boms, setBoms] = useState<Bom[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [bomRows, productRows] = await Promise.all([fetchBoms(), fetchAllProducts()])
      setBoms(bomRows as any)
      setProducts((productRows ?? []).map((p: any) => ({ id: p.id, name: p.name, sku: p.sku })))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function toggleActive(bom: Bom) {
    await setBomActive(bom.id, !bom.isActive)
    load()
  }

  async function remove(bom: Bom) {
    if (!confirm(`Delete "${bom.name}"? This can't be undone.`)) return
    await deleteBom(bom.id)
    load()
  }

  const stages: BomStage[] = ['ASSEMBLY', 'STICKER', 'OTHER']

  return (
    <div className="p-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium flex items-center gap-2"><ListTree size={18} /> Bills of Materials</h1>
          <p className="text-xs text-gray-400 mt-0.5">Define each production stage's components — assembly, sticker application, etc.</p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white flex items-center gap-1">
          {showForm ? <X size={12} /> : <Plus size={12} />} New BOM
        </button>
      </div>

      {showForm && <NewBomForm products={products} onCancel={() => setShowForm(false)} onDone={() => { setShowForm(false); load() }} />}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : boms.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400">No BOMs yet — create one above to enable Assembly.</div>
      ) : (
        <div className="space-y-6">
          {stages.map(stage => {
            const stageBoms = boms.filter(b => b.stage === stage)
            if (stageBoms.length === 0) return null
            const info = STAGE_INFO[stage]
            return (
              <div key={stage}>
                <p className="text-xs uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5">
                  <info.icon size={13} /> {info.label} ({stageBoms.length})
                </p>
                <div className="space-y-3">
                  {stageBoms.map(bom => (
                    <BomCard key={bom.id} bom={bom} onToggle={() => toggleActive(bom)} onRemove={() => remove(bom)} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
