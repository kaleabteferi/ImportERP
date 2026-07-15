import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import { supabase } from '../lib/supabase'
import { uploadProductImage } from '../api/products'
import { Plus, Tag, X, Check, Loader2, ImagePlus } from 'lucide-react'

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
  is_active: boolean
  image_url: string | null
}

const EMPTY = {
  sku: '', name: '', description: '',
  unit_of_measure: 'PCS', weight_kg: '',
  volume_m3: '', is_assembled: false,
  assembly_type: 'IMPORTED',
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
    }
    const { error: err } = editId
      ? await supabase.from('products').update(payload).eq('id', editId)
      : await supabase.from('products').insert(payload)
    if (err) { setError(err.message); setSaving(false); return }
    setSaving(false)
    setOpen(false)
    load()
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

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium">Products</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {products.length} product{products.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white
                     text-xs rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={13} /> Add product
        </button>
      </div>

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
          <button
            onClick={openNew}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                       text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={13} /> Add first product
          </button>
        </div>
      )}

      {!loading && products.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[40px_1fr_2fr_1fr_1fr_1fr_1fr_auto] gap-3
                          px-4 py-2.5 bg-gray-50 border-b border-gray-100
                          text-xs font-medium text-gray-400 uppercase tracking-wide">
            <div></div>
            <div>SKU</div>
            <div>Name</div>
            <div>Unit</div>
            <div className="text-right">Weight (kg)</div>
            <div className="text-right">Volume (m³)</div>
            <div>Type</div>
            <div></div>
          </div>

          {products.map((p, i) => (
            <div
              key={p.id}
              className={`grid grid-cols-[40px_1fr_2fr_1fr_1fr_1fr_1fr_auto] gap-3
                          px-4 py-3 items-center text-sm
                          ${i < products.length - 1 ? 'border-b border-gray-50' : ''}`}
            >
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
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium
                  ${p.assembly_type === 'FULL' || p.is_assembled
                    ? 'bg-purple-50 text-purple-700'
                    : p.assembly_type === 'SKD' || p.assembly_type === 'CKD'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-gray-100 text-gray-600'}`}>
                  {p.assembly_type ?? (p.is_assembled ? 'FULL' : 'IMPORTED')}
                </span>
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
        </div>
      )}

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center
                     justify-center p-4"
          onClick={e => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="bg-white rounded-2xl w-full max-w-md
                          max-h-[90vh] overflow-auto shadow-xl">

            <div className="flex items-center justify-between px-5 py-4
                            border-b border-gray-100">
              <h2 className="text-sm font-medium">
                {editId ? 'Edit product' : 'New product'}
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">

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

              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-200
                                rounded-lg text-xs text-red-700">
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4
                            border-t border-gray-100">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-xs text-gray-600 border border-gray-200
                           rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600
                           text-white text-xs rounded-lg hover:bg-blue-700
                           disabled:opacity-50 transition-colors
                           min-w-[110px] justify-center"
              >
                {saving
                  ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                  : <><Check size={12} /> {editId ? 'Save' : 'Add product'}</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}