import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Building2, Phone, Mail, X, Check, Loader2 } from 'lucide-react'

interface Supplier {
  id: string
  name: string
  country: string
  contact_person: string | null
  email: string | null
  phone: string | null
  currency: string
  payment_terms: string | null
  is_active: boolean
}

const EMPTY = {
  name: '', country: 'China', contact_person: '',
  email: '', phone: '', currency: 'USD', payment_terms: '',
}

export function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading]     = useState(true)
  const [open, setOpen]           = useState(false)
  const [form, setForm]           = useState({ ...EMPTY })
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [editId, setEditId]       = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('suppliers').select('*').order('name')
    setSuppliers(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openNew() {
    setForm({ ...EMPTY })
    setEditId(null)
    setError(null)
    setOpen(true)
  }

  function openEdit(sup: Supplier) {
    setForm({
      name:           sup.name,
      country:        sup.country,
      contact_person: sup.contact_person ?? '',
      email:          sup.email ?? '',
      phone:          sup.phone ?? '',
      currency:       sup.currency,
      payment_terms:  sup.payment_terms ?? '',
    })
    setEditId(sup.id)
    setError(null)
    setOpen(true)
  }

  const set = (field: string, val: string) =>
    setForm(prev => ({ ...prev, [field]: val }))

  async function save() {
    if (!form.name.trim()) { setError('Supplier name is required'); return }
    setSaving(true)
    setError(null)
    const payload = {
      name:           form.name.trim(),
      country:        form.country,
      contact_person: form.contact_person || null,
      email:          form.email || null,
      phone:          form.phone || null,
      currency:       form.currency,
      payment_terms:  form.payment_terms || null,
    }
    const { error: err } = editId
      ? await supabase.from('suppliers').update(payload).eq('id', editId)
      : await supabase.from('suppliers').insert(payload)
    if (err) { setError(err.message); setSaving(false); return }
    setSaving(false)
    setOpen(false)
    load()
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('suppliers')
      .update({ is_active: !current }).eq('id', id)
    load()
  }

  return (
    <div className="p-5 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-medium">Suppliers</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white
                     text-xs rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={13} /> Add supplier
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      )}

      {/* Empty */}
      {!loading && suppliers.length === 0 && (
        <div className="text-center py-16">
          <Building2 size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">No suppliers yet</p>
          <p className="text-xs text-gray-400 mb-4">
            Add your first supplier to start creating shipments.
          </p>
          <button onClick={openNew}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                             text-white text-xs rounded-lg hover:bg-blue-700 transition-colors">
            <Plus size={13} /> Add first supplier
          </button>
        </div>
      )}

      {/* Table */}
      {!loading && suppliers.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1fr_1.5fr_auto_auto] gap-3 px-4 py-2.5
                          bg-gray-50 border-b border-gray-100
                          text-xs font-medium text-gray-400 uppercase tracking-wide">
            <div>Supplier</div>
            <div>Currency</div>
            <div>Payment terms</div>
            <div>Status</div>
            <div></div>
          </div>

          {suppliers.map((sup, i) => (
            <div
              key={sup.id}
              className={`grid grid-cols-[2fr_1fr_1.5fr_auto_auto] gap-3 px-4 py-3
                          items-center text-sm
                          ${i < suppliers.length - 1 ? 'border-b border-gray-50' : ''}`}
            >
              {/* Name */}
              <div>
                <p className="font-medium text-gray-900">{sup.name}</p>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {sup.country && (
                    <span className="text-xs text-gray-400">🌍 {sup.country}</span>
                  )}
                  {sup.contact_person && (
                    <span className="text-xs text-gray-400">{sup.contact_person}</span>
                  )}
                  {sup.phone && (
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <Phone size={10} /> {sup.phone}
                    </span>
                  )}
                  {sup.email && (
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <Mail size={10} /> {sup.email}
                    </span>
                  )}
                </div>
              </div>

              {/* Currency */}
              <div>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium
                  ${sup.currency === 'USD'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-green-50 text-green-700'}`}>
                  {sup.currency}
                </span>
              </div>

              {/* Payment terms */}
              <div className="text-xs text-gray-500">{sup.payment_terms || '—'}</div>

              {/* Status */}
              <div>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium
                  ${sup.is_active
                    ? 'bg-green-50 text-green-700'
                    : 'bg-gray-100 text-gray-500'}`}>
                  {sup.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openEdit(sup)}
                  className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg
                             hover:bg-gray-50 transition-colors text-gray-600"
                >
                  Edit
                </button>
                <button
                  onClick={() => toggleActive(sup.id, sup.is_active)}
                  className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg
                             hover:bg-gray-50 transition-colors text-gray-600"
                >
                  {sup.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-auto shadow-xl">

            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-medium">
                {editId ? 'Edit supplier' : 'New supplier'}
              </h2>
              <button onClick={() => setOpen(false)}
                      className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Supplier name <span className="text-red-400">*</span>
                </label>
                <input
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                             focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="e.g. Guangzhou Electronics Co."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Country</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.country}
                    onChange={e => set('country', e.target.value)}
                    placeholder="China"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Currency</label>
                  <select
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    value={form.currency}
                    onChange={e => set('currency', e.target.value)}
                  >
                    <option value="USD">USD — Dollar</option>
                    <option value="CNY">CNY — Yuan</option>
                    <option value="ETB">ETB — Birr</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Contact person</label>
                <input
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                             focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={form.contact_person ?? ''}
                  onChange={e => set('contact_person', e.target.value)}
                  placeholder="e.g. Li Wei"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Phone</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.phone ?? ''}
                    onChange={e => set('phone', e.target.value)}
                    placeholder="+86 138 0000 0000"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Email</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.email ?? ''}
                    onChange={e => set('email', e.target.value)}
                    placeholder="supplier@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Payment terms</label>
                <input
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                             focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={form.payment_terms ?? ''}
                  onChange={e => set('payment_terms', e.target.value)}
                  placeholder="e.g. 30% TT + 70% LC before shipment"
                />
              </div>

              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg
                                text-xs text-red-700">
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
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
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white
                           text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50
                           transition-colors min-w-[110px] justify-center"
              >
                {saving
                  ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                  : <><Check size={12} /> {editId ? 'Save changes' : 'Add supplier'}</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}