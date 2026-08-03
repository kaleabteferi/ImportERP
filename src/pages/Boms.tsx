import { useState, useEffect, useCallback } from 'react'
import { fetchBoms, fetchAllProducts, createBom, updateBom, setBomActive, deleteBom } from '../api/bom'
import type { BomStage } from '../api/bom'
import { MATERIAL_KIND_LABELS, type MaterialKind } from './Products'
import { SearchableSelect } from '../components/SearchableSelect'
import { BulkImportModal } from '../components/BulkImportModal'
import type { BulkImportColumn } from '../components/BulkImportModal'
import { ListTree, Loader2, Plus, X, Trash2, Power, Sticker, Wrench, Boxes, Pencil, ClipboardPaste, PackageOpen } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { SwipeToDelete } from '../components/ui/SwipeToDelete'

interface ProductOption { id: string; name: string; sku: string; assemblyType: string | null; materialKind: MaterialKind }
interface BomLine { componentProductId: string; quantityRequired: number }
interface Bom {
  id: string; name: string; isActive: boolean; notes: string | null; stage: BomStage
  productId: string; productName: string; productSku: string; productAssemblyType: string | null
  lines: Array<{ id: string; componentProductId: string; componentName: string; componentSku: string; componentMaterialKind: MaterialKind; quantityRequired: number }>
}

// CKD/SKD kits conventionally separate the physical assembly parts from
// packaging (cartons, foam, manuals, screw bags) -- they're sourced, costed,
// and declared to customs differently, so a real BOM keeps them visibly apart
// rather than one flat undifferentiated parts list.
function splitPackaging<T extends { componentMaterialKind: MaterialKind }>(lines: T[]) {
  return {
    components: lines.filter(l => l.componentMaterialKind !== 'packaging_material'),
    packaging: lines.filter(l => l.componentMaterialKind === 'packaging_material'),
  }
}

const STAGE_INFO: Record<BomStage, { label: string; icon: typeof Wrench; hint: string }> = {
  ASSEMBLY: { label: 'Assembly', icon: Wrench, hint: 'Builds the finished product from raw/SKD/CKD components' },
  STICKER: { label: 'Sticker Application', icon: Sticker, hint: 'Consumes a sticker/label per unit — component in, same product out' },
  OTHER: { label: 'Other', icon: Boxes, hint: 'Any other post-assembly production step' },
}

const COMPONENT_IMPORT_COLUMNS: BulkImportColumn[] = [
  { key: 'component', label: 'Component (SKU or name)', required: true, width: '220px' },
  { key: 'quantity', label: 'Qty per unit', required: true, width: '100px' },
]
const COMPONENT_IMPORT_EXAMPLE = `component,quantity
SKD-PANEL-42,1
SKD-STAND-42,2
SCR-M4X10,8`

function BomForm({ products, initial, onDone, onCancel }: {
  products: ProductOption[]; initial?: Bom; onDone: () => void; onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [productId, setProductId] = useState(initial?.productId ?? '')
  const [stage, setStage] = useState<BomStage>(initial?.stage ?? 'ASSEMBLY')
  const [lines, setLines] = useState<BomLine[]>(
    initial ? initial.lines.map(l => ({ componentProductId: l.componentProductId, quantityRequired: l.quantityRequired }))
      : [{ componentProductId: '', quantityRequired: 1 }]
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showComponentImport, setShowComponentImport] = useState(false)

  function addLine() { setLines([...lines, { componentProductId: '', quantityRequired: 1 }]) }
  function removeLine(i: number) { setLines(lines.filter((_, idx) => idx !== i)) }
  function updateLine(i: number, patch: Partial<BomLine>) {
    setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }

  // Finished-product picker: show assembly type so it's obvious which
  // products are actually CKD/SKD kits vs. ready-to-sell imports -- an
  // ASSEMBLY-stage BOM only makes sense against a FULL/SKD/CKD product.
  const finishedProductOptions = products.map(p => ({
    id: p.id, label: p.name,
    sublabel: `${p.sku}${p.assemblyType ? ` · ${p.assemblyType}` : ''}`,
  }))
  // Component picker: show material kind so packaging/spares are visibly
  // distinct from real assembly components while building the list.
  const componentOptions = products.map(p => ({
    id: p.id, label: p.name,
    sublabel: `${p.sku} · ${MATERIAL_KIND_LABELS[p.materialKind]}`,
  }))

  async function handleComponentImport(rows: Record<string, string>[]) {
    const errors: string[] = []
    let succeeded = 0
    const newLines: BomLine[] = []
    for (const row of rows) {
      const key = row.component?.trim().toLowerCase()
      const qty = Number(row.quantity)
      if (!key) { errors.push('Skipped a row missing a component.'); continue }
      if (!qty || qty <= 0) { errors.push(`${row.component}: quantity must be greater than 0.`); continue }
      const match = products.find(p => p.sku?.toLowerCase() === key) ?? products.find(p => p.name.toLowerCase() === key) ?? products.find(p => p.name.toLowerCase().includes(key))
      if (!match) { errors.push(`${row.component}: no matching product (checked SKU and name).`); continue }
      newLines.push({ componentProductId: match.id, quantityRequired: qty })
      succeeded++
    }
    if (newLines.length > 0) {
      setLines(ls => [...ls.filter(l => l.componentProductId), ...newLines])
    }
    return { succeeded, errors }
  }

  async function submit() {
    if (!name.trim()) { setError('Name this BOM (e.g. "TV Model X — CKD assembly").'); return }
    if (!productId) { setError('Choose the finished product this BOM builds.'); return }
    const validLines = lines.filter(l => l.componentProductId && l.quantityRequired > 0)
    if (validLines.length === 0) { setError('Add at least one component.'); return }
    if (validLines.some(l => l.componentProductId === productId)) {
      setError("The finished product can't also be listed as one of its own components.")
      return
    }
    setSaving(true); setError(null)
    try {
      if (initial) await updateBom(initial.id, { name, productId, lines: validLines, stage })
      else await createBom({ name, productId, lines: validLines, stage })
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save BOM.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card padded className="mb-4 space-y-3">
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

      <SearchableSelect
        options={finishedProductOptions}
        value={productId}
        onChange={setProductId}
        placeholder={stage === 'ASSEMBLY' ? 'Finished product this BOM assembles' : 'Product this stage applies to'}
      />
      {stage === 'ASSEMBLY' && productId && !['SKD', 'CKD', 'FULL'].includes(products.find(p => p.id === productId)?.assemblyType ?? '') && (
        <p className="text-xs text-amber-600 -mt-1.5">
          This product's assembly type isn't SKD/CKD/FULL — double-check it's meant to be built from components, not sold as-is.
        </p>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-gray-500">
            {stage === 'ASSEMBLY' ? 'Components required' : 'Materials consumed per unit (e.g. the sticker itself)'}
          </p>
          <button type="button" onClick={() => setShowComponentImport(true)} className="text-xs text-blue-600 flex items-center gap-1 hover:underline">
            <ClipboardPaste size={11} /> Paste components
          </button>
        </div>
        {stage === 'ASSEMBLY' && (
          <p className="text-xs text-gray-400 flex items-start gap-1.5">
            <PackageOpen size={13} className="shrink-0 mt-0.5" />
            Include packaging (cartons, foam, manuals, screw bags) as their own lines — tag them "Packaging material" on the Products page so they're grouped separately from real assembly parts below.
          </p>
        )}
        {lines.map((line, i) => {
          const component = products.find(p => p.id === line.componentProductId)
          return (
          <div key={i} className="flex gap-2 items-center">
            <SearchableSelect
              className="flex-1"
              options={componentOptions}
              value={line.componentProductId}
              onChange={id => updateLine(i, { componentProductId: id })}
              placeholder="Component product"
            />
            <input type="number" value={line.quantityRequired}
              onChange={e => updateLine(i, { quantityRequired: Number(e.target.value) })}
              placeholder="Qty per unit" className="w-28 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
            {component?.materialKind === 'packaging_material' && (
              <Badge variant="neutral">Packaging</Badge>
            )}
            <button onClick={() => removeLine(i)} className="p-1.5 text-gray-400 hover:text-red-500">
              <Trash2 size={14} />
            </button>
          </div>
          )
        })}
        <button onClick={addLine} className="text-xs text-blue-600 flex items-center gap-1">
          <Plus size={12} /> Add component
        </button>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button loading={saving} onClick={submit}>{initial ? 'Save changes' : 'Create BOM'}</Button>
      </div>

      {showComponentImport && (
        <BulkImportModal
          title="Paste components"
          columns={COMPONENT_IMPORT_COLUMNS}
          exampleCsv={COMPONENT_IMPORT_EXAMPLE}
          helpText="Paste a components list — SKU or exact product name, and quantity required per unit. Matched components are added to the list above; anything unmatched is reported so you can fix and retry."
          onImport={handleComponentImport}
          onClose={() => setShowComponentImport(false)}
          onImported={() => setShowComponentImport(false)}
        />
      )}
    </Card>
  )
}

function BomCard({ bom, onEdit, onToggle, onRemove }: { bom: Bom; onEdit: () => void; onToggle: () => void; onRemove: () => void }) {
  return (
    <SwipeToDelete onDelete={onRemove}>
    <Card>
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{bom.name}</p>
          <p className="text-xs text-gray-400">{bom.productName} {bom.productSku && `(${bom.productSku})`}</p>
        </div>
        <Badge variant={bom.isActive ? 'success' : 'neutral'}>{bom.isActive ? 'Active' : 'Inactive'}</Badge>
        <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-blue-600" title="Edit">
          <Pencil size={14} />
        </button>
        <button onClick={onToggle} className="p-1.5 text-gray-400 hover:text-blue-600" title={bom.isActive ? 'Deactivate' : 'Activate'}>
          <Power size={14} />
        </button>
      </div>
      <div className="px-4 py-2 space-y-1">
        {(() => {
          const { components, packaging } = splitPackaging(bom.lines)
          return <>
            {components.map(line => (
              <div key={line.id} className="flex justify-between text-xs text-gray-600">
                <span>{line.componentName} {line.componentSku && `(${line.componentSku})`}</span>
                <span className="text-gray-400">{line.quantityRequired} per unit</span>
              </div>
            ))}
            {packaging.length > 0 && (
              <>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 pt-2 flex items-center gap-1">
                  <PackageOpen size={11} /> Packaging
                </p>
                {packaging.map(line => (
                  <div key={line.id} className="flex justify-between text-xs text-gray-600">
                    <span>{line.componentName} {line.componentSku && `(${line.componentSku})`}</span>
                    <span className="text-gray-400">{line.quantityRequired} per unit</span>
                  </div>
                ))}
              </>
            )}
          </>
        })()}
      </div>
    </Card>
    </SwipeToDelete>
  )
}

export function Boms() {
  const [boms, setBoms] = useState<Bom[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingBom, setEditingBom] = useState<Bom | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [bomRows, productRows] = await Promise.all([fetchBoms(), fetchAllProducts()])
      setBoms(bomRows as any)
      setProducts((productRows ?? []).map((p: any) => ({
        id: p.id, name: p.name, sku: p.sku,
        assemblyType: p.assembly_type ?? null,
        materialKind: (p.material_kind ?? 'finished_product') as MaterialKind,
      })))
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
      <PageHeader
        icon={<ListTree size={18} />}
        title="Bills of Materials"
        subtitle="Define each production stage's components — assembly, sticker application, etc."
        actions={<Button icon={showForm ? <X size={12} /> : <Plus size={12} />} onClick={() => { setEditingBom(null); setShowForm(v => !v) }}>New BOM</Button>}
      />

      {showForm && (
        <BomForm products={products} initial={editingBom ?? undefined}
          onCancel={() => { setShowForm(false); setEditingBom(null) }}
          onDone={() => { setShowForm(false); setEditingBom(null); load() }} />
      )}

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
                    <BomCard key={bom.id} bom={bom}
                      onEdit={() => { setEditingBom(bom); setShowForm(true) }}
                      onToggle={() => toggleActive(bom)} onRemove={() => remove(bom)} />
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
