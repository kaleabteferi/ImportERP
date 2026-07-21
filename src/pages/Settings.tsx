import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAccounts, fetchAccountBalances, createAccount, updateAccount } from '../api/accounts'
import type { Account } from '../api/accounts'
import {
  Building2, DollarSign, Users, Check,
  Loader2, Plus, X, Info, Wallet
} from 'lucide-react'

interface CompanySettings {
  id: string
  company_name: string
  address: string | null
  city: string | null
  country: string | null
  tin_number: string | null
  vat_number: string | null
  phone: string | null
  email: string | null
  bank_name: string | null
  bank_account: string | null
}

interface ForexRate {
  id: string
  rate: number
  rate_type: string
  effective_date: string
  from_currency: string
  to_currency: string
}

interface Consignee {
  id: string
  name: string
  address: string | null
  city: string | null
  tin_number: string | null
  contact_person: string | null
  phone: string | null
  email: string | null
  is_default: boolean
}

interface Warehouse {
  id: string
  name: string
  code: string | null
  address: string | null
  city: string | null
  is_active: boolean
  has_production: boolean
  production_manager_employee_id: string | null
  created_at: string
}

interface Company {
  id: string
  name: string
  license_type: string | null
  tin_number: string | null
  is_primary: boolean
  is_active: boolean
}

interface Employee {
  id: string
  full_name: string
}

const RATE_TYPES = [
  {
    key: 'CUSTOMS',
    label: 'Customs rate',
    desc: 'Reference rate ERCA uses for customs valuation (duty/VAT/surtax base). Confirm with your clearing agent — it can diverge from bank rates since the 2024 market-based FX reform.',
  },
  {
    key: 'BANK_TT',
    label: 'TT transfer rate',
    desc: 'Rate your bank actually quotes when paying a supplier by Telegraphic Transfer (TT). Bank-negotiated since the 2024 reform, so check it per-payment rather than assuming it matches the customs rate.',
  },
  {
    key: 'BANK_LC',
    label: 'LC opening rate',
    desc: 'Rate used when opening a Letter of Credit. Locked at LC opening date.',
  },
]

const TABS = [
  { key: 'company',    label: 'Company',       icon: Building2  },
  { key: 'companies',  label: 'Companies',      icon: Building2  },
  { key: 'accounts',   label: 'Accounts',       icon: Wallet     },
  { key: 'forex',      label: 'Exchange rates', icon: DollarSign },
  { key: 'warehouses', label: 'Warehouses',     icon: Building2  },
  { key: 'consignees', label: 'Consignees',     icon: Users      },
]

type TabKey = 'company' | 'companies' | 'accounts' | 'forex' | 'warehouses' | 'consignees'

function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-block">
      <button
        onClick={() => setShow(v => !v)}
        className="text-blue-400 hover:text-blue-600 transition-colors"
        aria-label="More information"
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

export function Settings() {
  const [tab, setTab]         = useState<TabKey>('company')
  const [company, setCompany] = useState<CompanySettings | null>(null)
  const [rates, setRates]     = useState<ForexRate[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [consignees, setConsignees] = useState<Consignee[]>([])
  const [companiesList, setCompaniesList] = useState<Company[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountBalances, setAccountBalances] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // Company (multi-company) modal
  const [ownOpen, setOwnOpen] = useState(false)
  const [ownForm, setOwnForm] = useState({
    name: '', license_type: 'PLC', tin_number: '', is_primary: false, is_active: true,
  })
  const [ownEditId, setOwnEditId] = useState<string | null>(null)
  const [ownSaving, setOwnSaving] = useState(false)

  // Account (cash/bank) modal
  const [acctOpen, setAcctOpen] = useState(false)
  const [acctForm, setAcctForm] = useState({ name: '', type: 'bank' as 'cash' | 'bank', currency: 'ETB', companyId: '' })
  const [acctEditId, setAcctEditId] = useState<string | null>(null)
  const [acctSaving, setAcctSaving] = useState(false)

  // Consignee modal
  const [cOpen, setCOpen]     = useState(false)
  const [cForm, setCForm]     = useState({
    name: '', address: '', city: 'Addis Ababa', tin_number: '',
    contact_person: '', phone: '', email: '', is_default: false,
  })
  const [cEditId, setCEditId] = useState<string | null>(null)
  const [cSaving, setCsaving] = useState(false)

  const [wOpen, setWOpen] = useState(false)
  const [wForm, setWForm] = useState({
    name: '', code: '', address: '', city: 'Addis Ababa', is_active: true,
    has_production: false, production_manager_employee_id: '',
  })
  const [wEditId, setWEditId] = useState<string | null>(null)
  const [wSaving, setWSaving] = useState(false)

  // New rate form
  const [rForm, setRForm]     = useState({
    rate_type: 'CUSTOMS', rate: '', effective_date: new Date().toISOString().split('T')[0],
  })
  const [rSaving, setRsaving] = useState(false)

  async function load() {
    setLoading(true)
    const [coRes, fxRes, whRes, cnRes, ownRes, empRes, acctRows] = await Promise.all([
      supabase.from('company_settings').select('*').limit(1).single(),
      supabase.from('forex_rates')
        .select('*')
        .eq('from_currency', 'USD')
        .eq('to_currency', 'ETB')
        .order('effective_date', { ascending: false })
        .limit(20),
      supabase.from('warehouses').select('*').order('name'),
      supabase.from('consignees').select('*').order('name'),
      supabase.from('companies').select('*').order('is_primary', { ascending: false }).order('name'),
      supabase.from('employees').select('id, full_name').order('full_name'),
      fetchAccounts().catch(() => []),
    ])
    if (coRes.data) setCompany(coRes.data)
    setRates(fxRes.data ?? [])
    setWarehouses(whRes.data ?? [])
    setConsignees(cnRes.data ?? [])
    setCompaniesList(ownRes.data ?? [])
    setEmployees(empRes.data ?? [])
    setAccounts(acctRows)
    fetchAccountBalances(acctRows).then(setAccountBalances).catch(() => {})
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function saveCompany() {
    if (!company) return
    setSaving(true)
    setError(null)
    const { id, ...rest } = company
    const { error: err } = await supabase
      .from('company_settings')
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (err) { setError(err.message); setSaving(false); return }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function addRate() {
    if (!rForm.rate || !rForm.effective_date) return
    setRsaving(true)
    await supabase.from('forex_rates').upsert({
      from_currency:  'USD',
      to_currency:    'ETB',
      rate_type:      rForm.rate_type,
      rate:           parseFloat(rForm.rate),
      effective_date: rForm.effective_date,
    }, { onConflict: 'from_currency,to_currency,rate_type,effective_date' })
    setRForm({ rate_type: 'CUSTOMS', rate: '', effective_date: new Date().toISOString().split('T')[0] })
    setRsaving(false)
    load()
  }

  async function saveConsignee() {
    setCsaving(true)
    const payload = { ...cForm }
    if (cEditId) {
      await supabase.from('consignees').update(payload).eq('id', cEditId)
    } else {
      await supabase.from('consignees').insert(payload)
    }
    setCsaving(false)
    setCOpen(false)
    setCEditId(null)
    setCForm({ name: '', address: '', city: 'Addis Ababa', tin_number: '',
               contact_person: '', phone: '', email: '', is_default: false })
    load()
  }

  function openEditConsignee(c: Consignee) {
    setCForm({
      name:           c.name,
      address:        c.address ?? '',
      city:           c.city ?? 'Addis Ababa',
      tin_number:     c.tin_number ?? '',
      contact_person: c.contact_person ?? '',
      phone:          c.phone ?? '',
      email:          c.email ?? '',
      is_default:     c.is_default,
    })
    setCEditId(c.id)
    setCOpen(true)
  }

  async function setDefault(id: string) {
    await supabase.from('consignees').update({ is_default: false }).neq('id', id)
    await supabase.from('consignees').update({ is_default: true }).eq('id', id)
    load()
  }

  async function saveWarehouse() {
    setWSaving(true)
    const payload = {
      name: wForm.name,
      code: wForm.code,
      address: wForm.address,
      city: wForm.city,
      is_active: wForm.is_active,
      has_production: wForm.has_production,
      production_manager_employee_id: wForm.production_manager_employee_id || null,
    }
    if (wEditId) {
      await supabase.from('warehouses').update(payload).eq('id', wEditId)
    } else {
      await supabase.from('warehouses').insert(payload)
    }
    setWSaving(false)
    setWOpen(false)
    setWEditId(null)
    setWForm({ name: '', code: '', address: '', city: 'Addis Ababa', is_active: true, has_production: false, production_manager_employee_id: '' })
    load()
  }

  function openEditWarehouse(w: Warehouse) {
    setWForm({
      name: w.name,
      code: w.code ?? '',
      address: w.address ?? '',
      city: w.city ?? 'Addis Ababa',
      is_active: w.is_active,
      has_production: w.has_production,
      production_manager_employee_id: w.production_manager_employee_id ?? '',
    })
    setWEditId(w.id)
    setWOpen(true)
  }

  // ── Companies (multi-company / multi-license) ────────────────────────
  async function saveCompanyEntity() {
    if (!ownForm.name.trim()) return
    setOwnSaving(true)
    const payload = {
      name: ownForm.name,
      license_type: ownForm.license_type || null,
      tin_number: ownForm.tin_number || null,
      is_primary: ownForm.is_primary,
      is_active: ownForm.is_active,
    }
    if (ownForm.is_primary) {
      // only one company can be primary at a time
      await supabase.from('companies').update({ is_primary: false }).neq('id', ownEditId ?? '00000000-0000-0000-0000-000000000000')
    }
    if (ownEditId) {
      await supabase.from('companies').update(payload).eq('id', ownEditId)
    } else {
      await supabase.from('companies').insert(payload)
    }
    setOwnSaving(false)
    setOwnOpen(false)
    setOwnEditId(null)
    setOwnForm({ name: '', license_type: 'PLC', tin_number: '', is_primary: false, is_active: true })
    load()
  }

  function openEditCompanyEntity(c: Company) {
    setOwnForm({
      name: c.name,
      license_type: c.license_type ?? 'PLC',
      tin_number: c.tin_number ?? '',
      is_primary: c.is_primary,
      is_active: c.is_active,
    })
    setOwnEditId(c.id)
    setOwnOpen(true)
  }

  // ── Accounts (cash tills / bank accounts) ────────────────────────────
  async function saveAccount() {
    if (!acctForm.name.trim()) return
    setAcctSaving(true)
    try {
      if (acctEditId) {
        await updateAccount(acctEditId, { name: acctForm.name, type: acctForm.type, currency: acctForm.currency })
      } else {
        await createAccount({ name: acctForm.name, type: acctForm.type, currency: acctForm.currency, companyId: acctForm.companyId || undefined })
      }
      setAcctOpen(false)
      setAcctEditId(null)
      setAcctForm({ name: '', type: 'bank', currency: 'ETB', companyId: '' })
      load()
    } finally {
      setAcctSaving(false)
    }
  }

  function openEditAccount(a: Account) {
    setAcctForm({ name: a.name, type: a.type, currency: a.currency, companyId: a.company_id ?? '' })
    setAcctEditId(a.id)
    setAcctOpen(true)
  }

  async function deactivateAccount(a: Account) {
    await updateAccount(a.id, { isActive: false })
    load()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-gray-400 gap-2">
      <Loader2 size={18} className="animate-spin" /> Loading…
    </div>
  )

  return (
    <div className="p-5 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-medium">Settings</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Company details, exchange rates, and document settings
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-100 pb-3">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as TabKey)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg
                        border transition-colors
              ${tab === t.key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Company tab ───────────────────────────────────── */}
      {tab === 'company' && company && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Company information
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                This information appears on Commercial Invoices, Packing Lists, and Waybills
              </p>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Company name</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={company.company_name}
                    onChange={e => setCompany({ ...company, company_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Phone</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={company.phone ?? ''}
                    onChange={e => setCompany({ ...company, phone: e.target.value })}
                    placeholder="+251 11 000 0000"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Address</label>
                <input
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                             focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={company.address ?? ''}
                  onChange={e => setCompany({ ...company, address: e.target.value })}
                  placeholder="Street address, Addis Ababa"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <label className="text-xs text-gray-500">TIN number</label>
                    <InfoTip text="Your Ethiopian Tax Identification Number (TIN) issued by ERCA. Required on all commercial documents and customs declarations." />
                  </div>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                    value={company.tin_number ?? ''}
                    onChange={e => setCompany({ ...company, tin_number: e.target.value })}
                    placeholder="0012345678"
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <label className="text-xs text-gray-500">VAT registration</label>
                    <InfoTip text="Your VAT registration number. Mandatory once your taxable turnover exceeds 2,000,000 ETB in any 12-month period (raised from 1,000,000 ETB by VAT Proclamation No. 1341/2024). Voluntary registration is allowed between 1,000,000 and 2,000,000 ETB if you want to claim input VAT credits." />
                  </div>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                    value={company.vat_number ?? ''}
                    onChange={e => setCompany({ ...company, vat_number: e.target.value })}
                    placeholder="ETH-VAT-2024-XXXXX"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Email</label>
                <input
                  type="email"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                             focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={company.email ?? ''}
                  onChange={e => setCompany({ ...company, email: e.target.value })}
                  placeholder="info@yourcompany.com"
                />
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Bank details
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Appears on commercial invoices for payment reference
              </p>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Bank name</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={company.bank_name ?? ''}
                    onChange={e => setCompany({ ...company, bank_name: e.target.value })}
                    placeholder="Commercial Bank of Ethiopia"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Account number</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                    value={company.bank_account ?? ''}
                    onChange={e => setCompany({ ...company, bank_account: e.target.value })}
                    placeholder="1000123456789"
                  />
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl
                            text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={saveCompany}
              disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 text-white
                         text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50
                         transition-colors min-w-[120px] justify-center"
            >
              {saving
                ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                : saved
                  ? <><Check size={14} /> Saved</>
                  : <><Check size={14} /> Save changes</>
              }
            </button>
          </div>
        </div>
      )}

      {/* ── Companies tab (multi-company / multi-license) ────── */}
      {tab === 'companies' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2 text-xs text-gray-500 max-w-md">
              <Info size={13} className="mt-0.5 shrink-0 text-blue-400" />
              <span>
                Each licensed entity (the main PLC and any individually-licensed
                companies) gets its own row here. Shipments, sales, purchases,
                and expenses can be attributed to a company so books and
                receipts stay separate even though people and warehouses are
                shared.
              </span>
            </div>
            <button
              onClick={() => {
                setOwnForm({ name: '', license_type: 'PLC', tin_number: '', is_primary: companiesList.length === 0, is_active: true })
                setOwnEditId(null)
                setOwnOpen(true)
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                         text-white text-xs rounded-lg hover:bg-blue-700
                         transition-colors shrink-0 ml-3"
            >
              <Plus size={13} /> Add company
            </button>
          </div>

          {companiesList.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
              <Building2 size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">No companies yet</p>
              <p className="text-xs text-gray-400 mb-4">
                Add the main PLC and any other licensed entities you operate under.
              </p>
              <button
                onClick={() => setOwnOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                           text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus size={13} /> Add first company
              </button>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {companiesList.map((c, i) => (
                <div
                  key={c.id}
                  className={`px-5 py-4 flex items-start justify-between ${i > 0 ? 'border-t border-gray-100' : ''}`}
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium">{c.name}</p>
                      {c.is_primary && (
                        <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium">
                          Primary
                        </span>
                      )}
                      <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {c.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">
                      {[c.license_type, c.tin_number ? `TIN: ${c.tin_number}` : null].filter(Boolean).join(' • ') || 'No license details yet'}
                    </p>
                  </div>
                  <button
                    onClick={() => openEditCompanyEntity(c)}
                    className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-500 shrink-0 ml-3"
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          )}

          {ownOpen && (
            <div
              className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
              onClick={e => e.target === e.currentTarget && setOwnOpen(false)}
            >
              <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-auto shadow-xl">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <h2 className="text-sm font-medium">{ownEditId ? 'Edit company' : 'New company'}</h2>
                  <button onClick={() => setOwnOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                    <X size={18} />
                  </button>
                </div>
                <div className="px-5 py-4 space-y-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Company name <span className="text-red-400">*</span>
                    </label>
                    <input
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                                 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      value={ownForm.name}
                      onChange={e => setOwnForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="HBK Trading PLC"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">License type</label>
                      <select
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                                   focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                        value={ownForm.license_type}
                        onChange={e => setOwnForm(p => ({ ...p, license_type: e.target.value }))}
                      >
                        <option value="PLC">PLC</option>
                        <option value="Personal">Personal</option>
                        <option value="Sole Proprietorship">Sole Proprietorship</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">TIN number</label>
                      <input
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                                   focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                        value={ownForm.tin_number}
                        onChange={e => setOwnForm(p => ({ ...p, tin_number: e.target.value }))}
                        placeholder="0012345678"
                      />
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={ownForm.is_primary}
                      onChange={e => setOwnForm(p => ({ ...p, is_primary: e.target.checked }))}
                      className="form-checkbox rounded border-gray-300 text-blue-600"
                    />
                    Primary company (default for new records)
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={ownForm.is_active}
                      onChange={e => setOwnForm(p => ({ ...p, is_active: e.target.checked }))}
                      className="form-checkbox rounded border-gray-300 text-blue-600"
                    />
                    Active
                  </label>
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
                  <button
                    onClick={() => setOwnOpen(false)}
                    className="px-4 py-2 text-xs text-gray-600 border border-gray-200
                               rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveCompanyEntity}
                    disabled={ownSaving || !ownForm.name}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white
                               text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50
                               transition-colors min-w-[110px] justify-center"
                  >
                    {ownSaving
                      ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                      : <><Check size={12} /> {ownEditId ? 'Save' : 'Add company'}</>
                    }
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Accounts tab (cash tills / bank accounts) ────────── */}
      {tab === 'accounts' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2 text-xs text-gray-500 max-w-md">
              <Info size={13} className="mt-0.5 shrink-0 text-blue-400" />
              <span>
                Every cash till and bank account money actually moves through.
                Payments (sales, purchases, expenses, credit) record which account
                received or paid the money, so Money Tracking can show real balances,
                not just payment methods.
              </span>
            </div>
            <button
              onClick={() => {
                setAcctForm({ name: '', type: 'bank', currency: 'ETB', companyId: '' })
                setAcctEditId(null)
                setAcctOpen(true)
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                         text-white text-xs rounded-lg hover:bg-blue-700
                         transition-colors shrink-0 ml-3"
            >
              <Plus size={13} /> Add account
            </button>
          </div>

          {accounts.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
              <Wallet size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">No accounts yet</p>
              <p className="text-xs text-gray-400 mb-4">
                Add your cash till and bank accounts (e.g. CBE, Awash) so payments can be tied to a real balance.
              </p>
              <button
                onClick={() => setAcctOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                           text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus size={13} /> Add first account
              </button>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {accounts.map((a, i) => (
                <div
                  key={a.id}
                  className={`px-5 py-4 flex items-center justify-between ${i > 0 ? 'border-t border-gray-100' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${a.type === 'cash' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                      <Wallet size={14} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{a.name}</p>
                      <p className="text-xs text-gray-400 capitalize">{a.type} · {a.currency}
                        {a.company_id && ` · ${companiesList.find(c => c.id === a.company_id)?.name ?? ''}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className={`text-sm font-mono font-medium ${(accountBalances[a.id] ?? 0) < 0 ? 'text-red-600' : 'text-gray-700'}`}>
                        {Math.round(accountBalances[a.id] ?? 0).toLocaleString()} {a.currency}
                      </p>
                      <p className="text-[10px] text-gray-400">from app activity</p>
                    </div>
                    <button
                      onClick={() => openEditAccount(a)}
                      className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-500"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deactivateAccount(a)}
                      className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors text-gray-500"
                    >
                      Deactivate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {acctOpen && (
            <div
              className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
              onClick={e => e.target === e.currentTarget && setAcctOpen(false)}
            >
              <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <h2 className="text-sm font-medium">{acctEditId ? 'Edit account' : 'New account'}</h2>
                  <button onClick={() => setAcctOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                    <X size={18} />
                  </button>
                </div>
                <div className="px-5 py-4 space-y-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Account name <span className="text-red-400">*</span>
                    </label>
                    <input
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                                 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      value={acctForm.name}
                      onChange={e => setAcctForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. CBE - HBK PLC, Cash till"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Type</label>
                      <select
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                                   focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                        value={acctForm.type}
                        onChange={e => setAcctForm(p => ({ ...p, type: e.target.value as 'cash' | 'bank' }))}
                      >
                        <option value="bank">Bank</option>
                        <option value="cash">Cash</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Currency</label>
                      <select
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                                   focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                        value={acctForm.currency}
                        onChange={e => setAcctForm(p => ({ ...p, currency: e.target.value }))}
                      >
                        <option value="ETB">ETB</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                  </div>
                  {companiesList.length > 0 && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Company (optional)</label>
                      <select
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                                   focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                        value={acctForm.companyId}
                        onChange={e => setAcctForm(p => ({ ...p, companyId: e.target.value }))}
                      >
                        <option value="">Shared / not company-specific</option>
                        {companiesList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
                  <button
                    onClick={() => setAcctOpen(false)}
                    className="px-4 py-2 text-xs text-gray-600 border border-gray-200
                               rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveAccount}
                    disabled={acctSaving || !acctForm.name}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white
                               text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50
                               transition-colors min-w-[110px] justify-center"
                  >
                    {acctSaving
                      ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                      : <><Check size={12} /> {acctEditId ? 'Save' : 'Add account'}</>
                    }
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Forex tab ─────────────────────────────────────── */}
      {tab === 'forex' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 border
                          border-blue-100 rounded-xl text-xs text-blue-800">
            <Info size={14} className="shrink-0 mt-0.5 text-blue-500" />
            <div>
              <p className="font-medium mb-1">How exchange rates work</p>
              <p className="leading-relaxed">
                Ethiopia uses three different rates. The <strong>Customs rate</strong> is the
                reference value ERCA uses for duty/VAT valuation. The <strong>TT rate</strong> is
                what your bank actually charges when you wire your supplier. The <strong>LC
                rate</strong> is locked when you open a Letter of Credit. Since the July 2024
                move to a market-based exchange system, banks negotiate rates directly with
                clients rather than following one fixed NBE rate — the birr has moved
                substantially since then, and the gap between these three rates can now be
                large and change often. Update all three here whenever your bank or clearing
                agent quotes a new number, not just daily.
              </p>
            </div>
          </div>

          {/* Add new rate */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Add / update rate
              </p>
            </div>
            <div className="px-5 py-4">
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Rate type</label>
                  <select
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    value={rForm.rate_type}
                    onChange={e => setRForm(p => ({ ...p, rate_type: e.target.value }))}
                  >
                    {RATE_TYPES.map(r => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    1 USD = ? ETB
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                    value={rForm.rate}
                    onChange={e => setRForm(p => ({ ...p, rate: e.target.value }))}
                    placeholder="131.20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Effective date</label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={rForm.effective_date}
                    onChange={e => setRForm(p => ({ ...p, effective_date: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={addRate}
                  disabled={rSaving || !rForm.rate}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white
                             text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50
                             transition-colors"
                >
                  {rSaving
                    ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                    : <><Check size={12} /> Save rate</>
                  }
                </button>
              </div>
            </div>
          </div>

          {/* Rate history */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Rate history (USD → ETB)
              </p>
            </div>
            {rates.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-400">
                No rates yet. Add your first rate above.
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {RATE_TYPES.map(rt => {
                  const typeRates = rates.filter(r => r.rate_type === rt.key)
                  const latest    = typeRates[0]
                  if (!latest) return null
                  return (
                    <div key={rt.key} className="px-5 py-3">
                      <div className="flex items-start justify-between mb-1">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{rt.label}</p>
                            <InfoTip text={rt.desc} />
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">{rt.desc}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-medium font-mono text-blue-700">
                            {latest.rate.toFixed(2)} ETB
                          </p>
                          <p className="text-xs text-gray-400">
                            as of {latest.effective_date}
                          </p>
                          {(() => {
                            const days = Math.floor((Date.now() - new Date(latest.effective_date).getTime()) / 86400000)
                            return days > 3 ? (
                              <p className="text-xs text-amber-600 font-medium mt-0.5">
                                {days} days old — confirm before use
                              </p>
                            ) : null
                          })()}
                        </div>
                      </div>
                      {typeRates.length > 1 && (
                        <div className="mt-2 flex gap-3 flex-wrap">
                          {typeRates.slice(1, 4).map(r => (
                            <span key={r.id} className="text-xs text-gray-400 font-mono">
                              {r.effective_date}: {r.rate.toFixed(2)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Warehouses tab ────────────────────────────────── */}
      {tab === 'warehouses' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2 text-xs text-gray-500 max-w-md">
              <Info size={13} className="mt-0.5 shrink-0 text-blue-400" />
              <span>
                Register warehouses where stock is stored and choose the receiving location
                for each shipment. Warehouses are also used by inventory ledger entries.
              </span>
            </div>
            <button
              onClick={() => {
                setWForm({ name: '', code: '', address: '', city: 'Addis Ababa', is_active: true, has_production: false, production_manager_employee_id: '' })
                setWEditId(null)
                setWOpen(true)
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                         text-white text-xs rounded-lg hover:bg-blue-700
                         transition-colors shrink-0 ml-3"
            >
              <Plus size={13} /> Add warehouse
            </button>
          </div>

          {warehouses.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
              <Building2 size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">No warehouses yet</p>
              <p className="text-xs text-gray-400 mb-4">
                Create a warehouse to receive shipments and record inventory by location.
              </p>
              <button
                onClick={() => setWOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                           text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus size={13} /> Add first warehouse
              </button>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {warehouses.map((w, i) => (
                <div
                  key={w.id}
                  className={`px-5 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-sm">{w.name}</p>
                      <p className="text-xs text-gray-500">
                        {w.code ? `${w.code} • ` : ''}{w.city || 'No city'}
                      </p>
                      {w.address && (
                        <p className="text-xs text-gray-400 mt-1">{w.address}</p>
                      )}
                      {w.has_production && (
                        <p className="text-xs text-blue-600 mt-1">
                          Production site
                          {w.production_manager_employee_id && (
                            <> · Manager: {employees.find(e => e.id === w.production_manager_employee_id)?.full_name ?? 'Unknown'}</>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${w.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {w.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <button
                        onClick={() => openEditWarehouse(w)}
                        className="mt-3 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                      >
                        <X size={12} /> Edit
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {wOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
              <div className="w-full max-w-xl bg-white rounded-3xl border border-gray-200 shadow-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <div>
                    <p className="text-sm font-semibold">{wEditId ? 'Edit warehouse' : 'New warehouse'}</p>
                    <p className="text-xs text-gray-500">Add a location for shipment receipt and inventory tracking.</p>
                  </div>
                  <button onClick={() => setWOpen(false)} className="text-gray-400 hover:text-gray-600">
                    <X size={18} />
                  </button>
                </div>
                <div className="px-5 py-5 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Warehouse name</label>
                      <input
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                        value={wForm.name}
                        onChange={e => setWForm(p => ({ ...p, name: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Code</label>
                      <input
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                        value={wForm.code}
                        onChange={e => setWForm(p => ({ ...p, code: e.target.value }))}
                        placeholder="MAIN"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">City</label>
                      <input
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                        value={wForm.city}
                        onChange={e => setWForm(p => ({ ...p, city: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Address</label>
                      <input
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                        value={wForm.address}
                        onChange={e => setWForm(p => ({ ...p, address: e.target.value }))}
                      />
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={wForm.is_active}
                      onChange={e => setWForm(p => ({ ...p, is_active: e.target.checked }))}
                      className="form-checkbox rounded border-gray-300 text-blue-600"
                    />
                    Active warehouse
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={wForm.has_production}
                      onChange={e => setWForm(p => ({ ...p, has_production: e.target.checked }))}
                      className="form-checkbox rounded border-gray-300 text-blue-600"
                    />
                    Production site (has a factory / production manager)
                  </label>
                  {wForm.has_production && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Production manager</label>
                      <select
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                                   focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                        value={wForm.production_manager_employee_id}
                        onChange={e => setWForm(p => ({ ...p, production_manager_employee_id: e.target.value }))}
                      >
                        <option value="">Not assigned yet</option>
                        {employees.map(e => (
                          <option key={e.id} value={e.id}>{e.full_name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
                  <button
                    onClick={() => setWOpen(false)}
                    className="px-3 py-2 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveWarehouse}
                    disabled={wSaving || !wForm.name}
                    className="inline-flex items-center gap-1 px-3 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {wSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    {wSaving ? 'Saving…' : 'Save warehouse'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Consignees tab ────────────────────────────────── */}
      {tab === 'consignees' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2 text-xs text-gray-500 max-w-md">
              <Info size={13} className="mt-0.5 shrink-0 text-blue-400" />
              <span>
                The consignee is the company that receives goods in Ethiopia — usually
                your own company, but can be a customer or freight forwarder. The
                consignee name appears on the Commercial Invoice, Packing List, and
                Truck Waybill as the receiver.
              </span>
            </div>
            <button
              onClick={() => {
                setCForm({ name: '', address: '', city: 'Addis Ababa', tin_number: '',
                           contact_person: '', phone: '', email: '', is_default: false })
                setCEditId(null)
                setCOpen(true)
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                         text-white text-xs rounded-lg hover:bg-blue-700
                         transition-colors shrink-0 ml-3"
            >
              <Plus size={13} /> Add consignee
            </button>
          </div>

          {consignees.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
              <Users size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">No consignees yet</p>
              <p className="text-xs text-gray-400 mb-4">
                Add your company as the first consignee. This will appear on all
                shipping documents.
              </p>
              <button
                onClick={() => setCOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                           text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus size={13} /> Add first consignee
              </button>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {consignees.map((c, i) => (
                <div
                  key={c.id}
                  className={`px-5 py-4 flex items-start justify-between
                    ${i < consignees.length - 1 ? 'border-b border-gray-50' : ''}`}
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium">{c.name}</p>
                      {c.is_default && (
                        <span className="text-xs px-2 py-0.5 bg-green-50 text-green-700
                                         rounded-full font-medium">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {[c.address, c.city, 'Ethiopia'].filter(Boolean).join(', ')}
                    </p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {c.tin_number && (
                        <span className="text-xs text-gray-400 font-mono">
                          TIN: {c.tin_number}
                        </span>
                      )}
                      {c.contact_person && (
                        <span className="text-xs text-gray-400">{c.contact_person}</span>
                      )}
                      {c.phone && (
                        <span className="text-xs text-gray-400">{c.phone}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {!c.is_default && (
                      <button
                        onClick={() => setDefault(c.id)}
                        className="text-xs px-2.5 py-1 border border-gray-200
                                   rounded-lg hover:bg-gray-50 transition-colors text-gray-500"
                      >
                        Set default
                      </button>
                    )}
                    <button
                      onClick={() => openEditConsignee(c)}
                      className="text-xs px-2.5 py-1 border border-gray-200
                                 rounded-lg hover:bg-gray-50 transition-colors text-gray-500"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Consignee modal */}
      {cOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setCOpen(false)}
        >
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh]
                          overflow-auto shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-medium">
                {cEditId ? 'Edit consignee' : 'New consignee'}
              </h2>
              <button onClick={() => setCOpen(false)}
                      className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Company name <span className="text-red-400">*</span>
                </label>
                <input
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                             focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={cForm.name}
                  onChange={e => setCForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Your Company PLC"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Address</label>
                <input
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                             focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={cForm.address}
                  onChange={e => setCForm(p => ({ ...p, address: e.target.value }))}
                  placeholder="Kaliti, Addis Ababa"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <label className="text-xs text-gray-500">TIN number</label>
                    <InfoTip text="Required on commercial invoice and customs declaration. Must match your ERCA registration." />
                  </div>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                    value={cForm.tin_number}
                    onChange={e => setCForm(p => ({ ...p, tin_number: e.target.value }))}
                    placeholder="0012345678"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Contact person</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={cForm.contact_person}
                    onChange={e => setCForm(p => ({ ...p, contact_person: e.target.value }))}
                    placeholder="Ato Kaleab"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Phone</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={cForm.phone}
                    onChange={e => setCForm(p => ({ ...p, phone: e.target.value }))}
                    placeholder="+251 911 000000"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Email</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                               focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={cForm.email}
                    onChange={e => setCForm(p => ({ ...p, email: e.target.value }))}
                    placeholder="info@yourcompany.com"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cForm.is_default}
                  onChange={e => setCForm(p => ({ ...p, is_default: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-xs text-gray-600">
                  Set as default consignee for new shipments
                </span>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button
                onClick={() => setCOpen(false)}
                className="px-4 py-2 text-xs text-gray-600 border border-gray-200
                           rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveConsignee}
                disabled={cSaving || !cForm.name}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white
                           text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50
                           transition-colors min-w-[110px] justify-center"
              >
                {cSaving
                  ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                  : <><Check size={12} /> {cEditId ? 'Save' : 'Add consignee'}</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}