import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import { supabase } from '../lib/supabase'
import { uploadProductImage } from '../api/products'
import { BulkImportModal } from '../components/BulkImportModal'
import type { BulkImportColumn } from '../components/BulkImportModal'
import { BulkActionBar } from '../components/BulkActionBar'
import { SortHeader } from '../components/SortHeader'
import { useSort } from '../lib/useSort'
import { useBulkSelect } from '../lib/useBulkSelect'
import { Plus, Tag, Check, Loader2, ImagePlus, ClipboardPaste } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'

const PRODUCT_IMPORT_COLUMNS: BulkImportColumn[] = [
  { key: 'sku', label: 'SKU', required: true, width: '110px' },
  { key: 'name', label: 'Name', required: true, width: '200px' },
  { key: 'unit_of_measure', label: 'Unit', width: '70px' },
  { key: 'weight_kg', label: 'Weight (kg)', width: '90px' },
  { key: 'volume_m3', label: 'Volume (m³)', width: '90px' },
  { key: 'assembly_type', label: 'Assembly type', width: '110px' },
  { key: 'material_kind', label: 'Material kind', width: '130px' },
  { key: 'default_customs_value', label: 'Default CD value (USD)', width: '120px' },
  { key: 'carton_length_cm', label: 'Carton L (cm)', width: '100px' },
  { key: 'carton_width_cm', label: 'Carton W (cm)', width: '100px' },
  { key: 'carton_height_cm', label: 'Carton H (cm)', width: '100px' },
  { key: 'default_units_per_carton', label: 'Units/carton', width: '100px' },
  { key: 'description', label: 'Description', width: '200px' },
]
const PRODUCT_IMPORT_EXAMPLE = `sku,name,unit_of_measure,weight_kg,volume_m3,assembly_type,material_kind,default_customs_value,carton_length_cm,carton_width_cm,carton_height_cm,default_units_per_carton,description
TV-55-DMD,Dimond TV 55',PCS,18.5,0.21,SKD,finished_product,180,70,15,45,1,55 inch smart LED
STV-2B-SCH,Saachi 2-Burner Stove,PCS,4.2,0.03,IMPORTED,finished_product,,50,40,30,10,`

export const MATERIAL_KINDS = ['finished_product', 'skd_component', 'packaging_material', 'spare_part', 'raw_material'] as const
export type MaterialKind = typeof MATERIAL_KINDS[number]
export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  finished_product: 'Finished product',
  skd_component: 'SKD/CKD component',
  packaging_material: 'Packaging material',
  spare_part: 'Spare part',
  raw_material: 'Raw material',
}

interface Product {
  id: string
  sku: string
  name: string
  description: string | null
  unit_of_measure: string
  weight_kg: number | null
  volume_m3: number | null
  is_assembled: boolean
  assembly_type: string | null
  material_kind: MaterialKind | null
  default_customs_value: number | null
  carton_length_cm: number | null
  carton_width_cm: number | null
  carton_height_cm: number | null
  default_units_per_carton: number | null
  is_active: boolean
  image_url: string | null
  created_at: string | null
}

type SortKey = 'sku' | 'name' | 'unit_of_measure' | 'weight_kg' | 'volume_m3' | 'assembly_type' | 'created_at'

const EMPTY = {
  sku: '', name: '', description: '',
  unit_of_measure: 'PCS', weight_kg: '',
  volume_m3: '', is_assembled: false,
  assembly_type: 'IMPORTED', material_kind: 'finished_product' as MaterialKind, default_customs_value: '',
  carton_length_cm: '', carton_width_cm: '', carton_height_cm: '', default_units_per_carton: '',
}

export function Products() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading]   = useState(true)
  const [open, setOpen]         = useState(false)
  const [form, setForm]         = useState<any>({ ...EMPTY })
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [editId, setEditId]     = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showImport, setShowImport] = useState(false)

  const { sorted, sortKey, sortDir, toggleSort } = useSort<Product, SortKey>(products, (p, key) => p[key], 'name')
  const { selected, toggle, toggleAll, clear, allSelected, count } = useBulkSelect(sorted)

  async function bulkDelete() {
    const ids = [...selected]
    const { error: err } = await supabase.from('products').delete().in('id', ids)
    if (err) { setError(err.message); return }
    clear()
    load()
  }

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('products').select('*').order('name')
    setProducts(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openNew() {
    setForm({ ...EMPTY })
    setEditId(null)
    setImageUrl(null)
    setError(null)
    setOpen(true)
  }

  function openEdit(p: Product) {
    setForm({
      sku:             p.sku,
      name:            p.name,
      description:     p.description ?? '',
      unit_of_measure: p.unit_of_measure,
      weight_kg:       p.weight_kg ?? '',
      volume_m3:       p.volume_m3 ?? '',
      is_assembled:    p.is_assembled,
      assembly_type:   p.assembly_type ?? (p.is_assembled ? 'FULL' : 'IMPORTED'),
      material_kind:   p.material_kind ?? 'finished_product',
      default_customs_value: p.default_customs_value ?? '',
      carton_length_cm: p.carton_length_cm ?? '',
      carton_width_cm: p.carton_width_cm ?? '',
      carton_height_cm: p.carton_height_cm ?? '',
      default_units_per_carton: p.default_units_per_carton ?? '',
    })
    setEditId(p.id)
    setImageUrl(p.image_url)
    setError(null)
    setOpen(true)
  }

  const set = (f: string, v: any) => setForm((p: any) => ({ ...p, [f]: v }))

  async function save() {
    if (!form.sku.trim()) { setError('SKU is required'); return }
    if (!form.name.trim()) { setError('Product name is required'); return }
    setSaving(true)
    setError(null)
    const payload = {
      sku:             form.sku.trim().toUpperCase(),
      name:            form.name.trim(),
      description:     form.description || null,
      unit_of_measure: form.unit_of_measure,
      weight_kg:       form.weight_kg ? parseFloat(form.weight_kg) : null,
      volume_m3:       form.volume_m3 ? parseFloat(form.volume_m3) : null,
      is_assembled:    form.is_assembled,
      assembly_type:   form.assembly_type,
      material_kind:   form.material_kind,
      default_customs_value: form.default_customs_value ? parseFloat(form.default_customs_value) : null,
      carton_length_cm: form.carton_length_cm ? parseFloat(form.carton_length_cm) : null,
      carton_width_cm: form.carton_width_cm ? parseFloat(form.carton_width_cm) : null,
      carton_height_cm: form.carton_height_cm ? parseFloat(form.carton_height_cm) : null,
      default_units_per_carton: form.default_units_per_carton ? parseFloat(form.default_units_per_carton) : null,
    }
    const { error: err } = editId
      ? await supabase.from('products').update(payload).eq('id', editId)
      : await supabase.from('products').insert(payload)
    if (err) { setError(err.message); setSaving(false); return }
    setSaving(false)
    setOpen(false)
    load()
  }

  async function handleBulkImport(rows: Record<string, string>[]) {
    const errors: string[] = []
    let succeeded = 0
    for (const row of rows) {
      const sku = row.sku?.trim().toUpperCase()
      const name = row.name?.trim()
      if (!sku || !name) { errors.push(`Skipped a row missing SKU or name.`); continue }
      const assemblyType = ['IMPORTED', 'FULL', 'SKD', 'CKD'].includes((row.assembly_type ?? '').toUpperCase())
        ? row.assembly_type.toUpperCase() : 'IMPORTED'
      const materialKind = MATERIAL_KINDS.includes((row.material_kind ?? '').trim().toLowerCase() as MaterialKind)
        ? row.material_kind.trim().toLowerCase() : 'finished_product'
      const { error } = await supabase.from('products').insert({
        sku, name,
        description: row.description?.trim() || null,
        unit_of_measure: row.unit_of_measure?.trim().toUpperCase() || 'PCS',
        weight_kg: row.weight_kg ? parseFloat(row.weight_kg) : null,
        volume_m3: row.volume_m3 ? parseFloat(row.volume_m3) : null,
        is_assembled: assemblyType === 'FULL' || assemblyType === 'SKD',
        assembly_type: assemblyType,
        material_kind: materialKind,
        default_customs_value: row.default_customs_value ? parseFloat(row.default_customs_value) : null,
        carton_length_cm: row.carton_length_cm ? parseFloat(row.carton_length_cm) : null,
        carton_width_cm: row.carton_width_cm ? parseFloat(row.carton_width_cm) : null,
        carton_height_cm: row.carton_height_cm ? parseFloat(row.carton_height_cm) : null,
        default_units_per_carton: row.default_units_per_carton ? parseFloat(row.default_units_per_carton) : null,
      })
      if (error) errors.push(`${sku}: ${error.message}`)
      else succeeded++
    }
    return { succeeded, errors }
  }

  async function handleImagePick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !editId) return
    setUploadingImage(true)
    setError(null)
    try {
      const url = await uploadProductImage(editId, file)
      setImageUrl(url)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to upload image.')
    } finally {
      setUploadingImage(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="p-5 max-w-5xl mx-auto">

      <PageHeader
        title="Products"
        subtitle={`${products.length} product${products.length !== 1 ? 's' : ''}`}
        actions={<>
          <Button variant="secondary" icon={<ClipboardPaste size={13} />} onClick={() => setShowImport(true)}>Bulk import</Button>
          <Button icon={<Plus size={13} />} onClick={openNew}>Add product</Button>
        </>}
      />

      {showImport && (
        <BulkImportModal
          title="Bulk import products"
          columns={PRODUCT_IMPORT_COLUMNS}
          exampleCsv={PRODUCT_IMPORT_EXAMPLE}
          helpText="Paste a product list — from a supplier's price list, a spreadsheet export, or typed by hand. SKU and name are the only required fields; assembly type defaults to IMPORTED if left blank or unrecognized."
          onImport={handleBulkImport}
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && products.length === 0 && (
        <div className="text-center py-16">
          <Tag size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No products yet</p>
          <p className="text-xs text-gray-400 mb-4 max-w-xs mx-auto">
            Add your products here first. You'll link them to shipments
            when entering PI line items.
          </p>
          <Button icon={<Plus size={13} />} onClick={openNew} className="mx-auto">Add first product</Button>
        </div>
      )}

      {!loading && products.length > 0 && (
        <>
          <BulkActionBar count={count} itemLabel="product" onClear={clear} onDelete={bulkDelete} />
          <Card>
          <div className="grid grid-cols-[24px_36px_1fr_2fr_70px_80px_80px_1fr_90px_90px_auto] gap-3
                          px-4 py-2.5 bg-gray-50 border-b border-gray-100
                          text-xs font-medium text-gray-400 uppercase tracking-wide items-center">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="cursor-pointer" />
            <div></div>
            <div><SortHeader label="SKU" active={sortKey === 'sku'} dir={sortDir} onClick={() => toggleSort('sku')} /></div>
            <div><SortHeader label="Name" active={sortKey === 'name'} dir={sortDir} onClick={() => toggleSort('name')} /></div>
            <div><SortHeader label="Unit" active={sortKey === 'unit_of_measure'} dir={sortDir} onClick={() => toggleSort('unit_of_measure')} /></div>
            <div className="text-right"><SortHeader label="Weight" align="right" active={sortKey === 'weight_kg'} dir={sortDir} onClick={() => toggleSort('weight_kg')} /></div>
            <div className="text-right"><SortHeader label="Volume" align="right" active={sortKey === 'volume_m3'} dir={sortDir} onClick={() => toggleSort('volume_m3')} /></div>
            <div><SortHeader label="Type" active={sortKey === 'assembly_type'} dir={sortDir} onClick={() => toggleSort('assembly_type')} /></div>
            <div className="text-right">CD value</div>
            <div><SortHeader label="Added" active={sortKey === 'created_at'} dir={sortDir} onClick={() => toggleSort('created_at')} /></div>
            <div></div>
          </div>

          {sorted.map((p, i) => (
            <div
              key={p.id}
              className={`stagger-row grid grid-cols-[24px_36px_1fr_2fr_70px_80px_80px_1fr_90px_90px_auto] gap-3
                          px-4 py-3 items-center text-sm
                          ${i < sorted.length - 1 ? 'border-b border-gray-50' : ''} ${selected.has(p.id) ? 'bg-blue-50/40' : ''}`}
              style={{ '--stagger-index': Math.min(i, 20) } as React.CSSProperties}
            >
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="cursor-pointer" />
              <div className="w-8 h-8 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <Tag size={14} className="text-gray-300" />
                )}
              </div>
              <div className="font-mono text-xs text-blue-700 font-medium">{p.sku}</div>
              <div>
                <p className="font-medium text-gray-900">{p.name}</p>
                {p.description && (
                  <p className="text-xs text-gray-400 mt-0.5 truncate">{p.description}</p>
                )}
              </div>
              <div className="text-xs text-gray-500">{p.unit_of_measure}</div>
              <div className="text-right text-xs font-mono text-gray-500">
                {p.weight_kg ?? '—'}
              </div>
              <div className="text-right text-xs font-mono text-gray-500">
                {p.volume_m3 ?? '—'}
              </div>
              <div>
                <Badge variant={p.assembly_type === 'FULL' || p.is_assembled ? 'accent' : p.assembly_type === 'SKD' || p.assembly_type === 'CKD' ? 'warning' : 'neutral'}>
                  {p.assembly_type ?? (p.is_assembled ? 'FULL' : 'IMPORTED')}
                </Badge>
                {p.material_kind && p.material_kind !== 'finished_product' && (
                  <p className="text-[10px] text-gray-400 mt-0.5">{MATERIAL_KIND_LABELS[p.material_kind]}</p>
                )}
              </div>
              <div className="text-right text-xs font-mono text-gray-500">
                {p.default_customs_value != null ? `$${p.default_customs_value}` : '—'}
              </div>
              <div className="text-xs text-gray-400">
                {p.created_at ? new Date(p.created_at).toLocaleDateString('en-ET', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openEdit(p)}
                  className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg
                             hover:bg-gray-50 transition-colors text-gray-600"
                >
                  Edit
                </button>
              </div>
            </div>
          ))}
          </Card>
        </>
      )}

      {/* Modal */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? 'Edit product' : 'New product'}
        footer={<>
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button loading={saving} icon={<Check size={12} />} onClick={save} className="min-w-[110px]">
            {editId ? 'Save' : 'Add product'}
          </Button>
        </>}
      >
              <div>
                <label className="block text-xs text-gray-500 mb-1">Photo</label>
                {editId ? (
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                      {imageUrl ? (
                        <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ImagePlus size={20} className="text-gray-300" />
                      )}
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingImage}
                        className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {uploadingImage ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
                        {imageUrl ? 'Replace photo' : 'Add photo'}
                      </button>
                      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
                      <p className="text-xs text-gray-400 mt-1">Shown in the warehouse daily log so managers can pick products by sight.</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
                    Save the product first, then reopen it here to add a photo.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    SKU <span className="text-red-400">*</span>
                  </label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200
                               rounded-lg focus:outline-none focus:ring-2
                               focus:ring-blue-400 font-mono uppercase"
                    value={form.sku}
                    onChange={e => set('sku', e.target.value)}
                    placeholder="TV-43-SAM"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Unit</label>
                  <select
                    className="w-full px-3 py-2 text-sm border border-gray-200
                               rounded-lg focus:outline-none focus:ring-2
                               focus:ring-blue-400 bg-white"
                    value={form.unit_of_measure}
                    onChange={e => set('unit_of_measure', e.target.value)}
                  >
                    {['PCS', 'KG', 'CTN', 'SET', 'PAIR', 'BOX'].map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Product name <span className="text-red-400">*</span>
                </label>
                <input
                  className="w-full px-3 py-2 text-sm border border-gray-200
                             rounded-lg focus:outline-none focus:ring-2
                             focus:ring-blue-400"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="e.g. Samsung TV 43 inch Smart LED"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Description</label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200
                             rounded-lg focus:outline-none focus:ring-2
                             focus:ring-blue-400 resize-none"
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  placeholder="Optional description…"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Weight per unit (kg)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    className="w-full px-3 py-2 text-sm border border-gray-200
                               rounded-lg focus:outline-none focus:ring-2
                               focus:ring-blue-400 font-mono"
                    value={form.weight_kg}
                    onChange={e => set('weight_kg', e.target.value)}
                    placeholder="e.g. 8.5"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Volume per unit (m³)
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    className="w-full px-3 py-2 text-sm border border-gray-200
                               rounded-lg focus:outline-none focus:ring-2
                               focus:ring-blue-400 font-mono"
                    value={form.volume_m3}
                    onChange={e => set('volume_m3', e.target.value)}
                    placeholder="e.g. 0.085"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Standard carton size (cm) — L × W × H</label>
                <div className="grid grid-cols-3 gap-3">
                  <input type="number" step="0.1" placeholder="L"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                    value={form.carton_length_cm} onChange={e => set('carton_length_cm', e.target.value)} />
                  <input type="number" step="0.1" placeholder="W"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                    value={form.carton_width_cm} onChange={e => set('carton_width_cm', e.target.value)} />
                  <input type="number" step="0.1" placeholder="H"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                    value={form.carton_height_cm} onChange={e => set('carton_height_cm', e.target.value)} />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {form.carton_length_cm && form.carton_width_cm && form.carton_height_cm
                    ? `= ${((parseFloat(form.carton_length_cm) * parseFloat(form.carton_width_cm) * parseFloat(form.carton_height_cm)) / 1000000).toFixed(4)} m³ per carton — `
                    : ''}
                  Pre-fills the packing list's carton dimensions when this product is packed into a container — editable per shipment.
                </p>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Standard units per carton</label>
                <input
                  type="number"
                  step="1"
                  className="w-full px-3 py-2 text-sm border border-gray-200
                             rounded-lg focus:outline-none focus:ring-2
                             focus:ring-blue-400 font-mono"
                  value={form.default_units_per_carton}
                  onChange={e => set('default_units_per_carton', e.target.value)}
                  placeholder="e.g. 10"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Assembly type</label>
                <select
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
                  value={form.assembly_type}
                  onChange={e => {
                    set('assembly_type', e.target.value)
                    set('is_assembled', e.target.value === 'FULL' || e.target.value === 'SKD')
                  }}
                >
                  <option value="IMPORTED">IMPORTED — ready to sell</option>
                  <option value="FULL">FULL — fully assembled import</option>
                  <option value="SKD">SKD — semi-knocked down (assembly line)</option>
                  <option value="CKD">CKD — completely knocked down (parts only)</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  SKD/CKD stock routes to assembly components when shipment is received.
                </p>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Material kind</label>
                <select
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
                  value={form.material_kind}
                  onChange={e => set('material_kind', e.target.value)}
                >
                  {MATERIAL_KINDS.map(kind => <option key={kind} value={kind}>{MATERIAL_KIND_LABELS[kind]}</option>)}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  What this product actually is on a bill of materials — a sellable finished unit, an SKD/CKD assembly part, packaging, a spare, or a raw material. Drives grouping on the BOMs page.
                </p>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Default CD (customs) value per unit (USD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full px-3 py-2 text-sm border border-gray-200
                             rounded-lg focus:outline-none focus:ring-2
                             focus:ring-blue-400 font-mono"
                  value={form.default_customs_value}
                  onChange={e => set('default_customs_value', e.target.value)}
                  placeholder="e.g. 180.00"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Pre-fills the customs value when this product is added to a proforma invoice — editable per shipment.
                </p>
              </div>

              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-200
                                rounded-lg text-xs text-red-700">
                  {error}
                </div>
              )}
      </Modal>
    </div>
  )
}