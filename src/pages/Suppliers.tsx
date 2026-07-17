import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Building2, Phone, Mail, X, Check, Loader2, ClipboardPaste } from 'lucide-react'
import { BulkImportModal } from '../components/BulkImportModal'
import type { BulkImportColumn } from '../components/BulkImportModal'
import { BulkActionBar } from '../components/BulkActionBar'
import { SortHeader } from '../components/SortHeader'
import { useSort } from '../lib/useSort'
import { useBulkSelect } from '../lib/useBulkSelect'

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
  created_at: string | null
}

const EMPTY = {
  name: '', country: 'China', contact_person: '',
  email: '', phone: '', currency: 'USD', payment_terms: '',
}

type SortKey = 'name' | 'currency' | 'is_active' | 'created_at'

const SUPPLIER_IMPORT_COLUMNS: BulkImportColumn[] = [
  { key: 'name', label: 'Supplier name', required: true, width: '150px' },
  { key: 'country', label: 'Country', width: '100px' },
  { key: 'currency', label: 'Currency', width: '80px' },
  { key: 'contact_person', label: 'Contact person', width: '120px' },
  { key: 'phone', label: 'Phone', width: '110px' },
  { key: 'email', label: 'Email', width: '150px' },
  { key: 'payment_terms', label: 'Payment terms', width: '160px' },
]
const SUPPLIER_IMPORT_EXAMPLE = `name,country,currency,contact_person,phone,email,payment_terms
Guangzhou Electronics Co.,China,USD,Li Wei,+86 138 0000 0000,li@example.com,30% TT + 70% LC before shipment
Dubai Auto Parts LLC,UAE,USD,Ahmed Hassan,+971 50 000 0000,,100% TT before shipment`

export function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading]     = useState(true)
  const [open, setOpen]           = useState(false)
  const [form, setForm]           = useState({ ...EMPTY })
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [editId, setEditId]       = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)

  const { sorted, sortKey, sortDir, toggleSort } = useSort<Supplier, SortKey>(suppliers, (s, key) => key === 'is_active' ? (s.is_active ? 1 : 0) : s[key], 'name')
  const { selected, toggle, toggleAll, clear, allSelected, count } = useBulkSelect(sorted)

  async function bulkDelete() {
    const ids = [...selected]
    const { error: err } = await supabase.from('suppliers').delete().in('id', ids)
    if (err) { setError(err.message); return }
    clear()
    load()
  }

  async function handleBulkImport(rows: Record<string, string>[]) {
    const errors: string[] = []
    let succeeded = 0
    for (const row of rows) {
      const name = row.name?.trim()
      if (!name) { errors.push('Skipped a row missing a name.'); continue }
      const { error: err } = await supabase.from('suppliers').insert({
        name,
        country: row.country?.trim() || 'China',
        currency: row.currency?.trim() || 'USD',
        contact_person: row.contact_person?.trim() || null,
        phone: row.phone?.trim() || null,
        email: row.email?.trim() || null,
        payment_terms: row.payment_terms?.trim() || null,
      })
      if (err) errors.push(`${name}: ${err.message}`)
      else succeeded++
    }
    return { succeeded, errors }
  }

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
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600
                       text-xs rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ClipboardPaste size={13} /> Bulk import
          </button>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white
                       text-xs rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={13} /> Add supplier
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 mb-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          {error}
        </div>
      )}

      {showImport && (
        <BulkImportModal
          title="Bulk import suppliers"
          columns={SUPPLIER_IMPORT_COLUMNS}
          exampleCsv={SUPPLIER_IMPORT_EXAMPLE}
          helpText="Paste a supplier list. Only name is required — country defaults to China and currency to USD if left blank."
          onImport={handleBulkImport}
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}

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
        <>
          <BulkActionBar count={count} itemLabel="supplier" onClear={clear} onDelete={bulkDelete} />
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[24px_2fr_1fr_1.5fr_auto_80px_auto] gap-3 px-4 py-2.5
                          bg-gray-50 border-b border-gray-100
                          text-xs font-medium text-gray-400 uppercase tracking-wide items-center">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="cursor-pointer" />
            <SortHeader label="Supplier" active={sortKey === 'name'} dir={sortDir} onClick={() => toggleSort('name')} />
            <SortHeader label="Currency" active={sortKey === 'currency'} dir={sortDir} onClick={() => toggleSort('currency')} />
            <div>Payment terms</div>
            <SortHeader label="Status" active={sortKey === 'is_active'} dir={sortDir} onClick={() => toggleSort('is_active')} />
            <SortHeader label="Added" align="right" active={sortKey === 'created_at'} dir={sortDir} onClick={() => toggleSort('created_at')} />
            <div></div>
          </div>

          {sorted.map((sup, i) => (
            <div
              key={sup.id}
              className={`grid grid-cols-[24px_2fr_1fr_1.5fr_auto_80px_auto] gap-3 px-4 py-3
                          items-center text-sm
                          ${i < sorted.length - 1 ? 'border-b border-gray-50' : ''}
                          ${selected.has(sup.id) ? 'bg-blue-50/40' : ''}`}
            >
              <input type="checkbox" checked={selected.has(sup.id)} onChange={() => toggle(sup.id)} className="cursor-pointer" />
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

              {/* Added */}
              <div className="text-xs text-gray-400 text-right w-20">
                {sup.created_at ? new Date(sup.created_at).toLocaleDateString('en-ET', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
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
        </>
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