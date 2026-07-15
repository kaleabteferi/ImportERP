import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  ArrowLeft, Printer, Edit2, Save, X,
  FileText, Package, Truck, Loader2
} from 'lucide-react'

interface DocData {
  shipment: any
  items: any[]
  company: any
  consignee: any
  fxRate: number
}

type DocType = 'commercial' | 'packing' | 'waybill'

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

export function ShipmentDocuments() {
  const { id } = useParams<{ id: string }>()
  const printRef = useRef<HTMLDivElement>(null)

  const [data, setData]       = useState<DocData | null>(null)
  const [docType, setDocType] = useState<DocType>('commercial')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)

  // Editable overrides (don't change DB, just for this print)
  const [overrides, setOverrides] = useState({
    invoiceNo: '',
    invoiceDate: '',
    plNo: '',
    wbNo: '',
    portLoading: 'Shenzhen, China',
    portDischarge: 'Djibouti, Djibouti',
    finalDest: 'Addis Ababa, Ethiopia',
    paymentTerms: '',
    truckPlate: '',
    sealNo: '',
    driverName: '',
    departureDate: '',
    arrivalDate: '',
    blNo: '',
    vesselName: '',
    voyageNo: '',
  })

  async function load() {
  if (!id) return
  setLoading(true)

  const [shRes, rawItemsRes, coRes, cnRes, fxRes, prodRes] = await Promise.all([
    supabase.from('shipments')
      .select('*, suppliers(name, contact_person, email, country)')
      .eq('id', id).single(),
    supabase.from('shipment_items')
      .select('id, product_id, quantity, unit_price_usd, weight_kg_total, volume_m3_total, hs_code, country_of_origin, carton_qty, units_per_carton, gross_weight_per_ctn, net_weight_per_ctn, carton_number_from, carton_number_to, carton_marks')
      .eq('shipment_id', id)
      .order('created_at'),
    supabase.from('company_settings').select('*').single(),
    supabase.from('consignees').select('*').eq('is_default', true).maybeSingle(),
    supabase.from('forex_rates').select('rate')
      .eq('from_currency', 'USD').eq('to_currency', 'ETB').eq('rate_type', 'CUSTOMS')
      .order('effective_date', { ascending: false }).limit(1),
    supabase.from('products').select('id, name, sku, unit_of_measure').eq('is_active', true),
  ])

  // JS join — no FK required
  const prodMap = new Map((prodRes.data ?? []).map((p: any) => [p.id, p]))
  const enrichedItems = (rawItemsRes.data ?? []).map((item: any) => ({
    ...item,
    products: prodMap.get(item.product_id) ?? null,
  }))

  const sh = shRes.data
  if (sh) {
    setOverrides(prev => ({
      ...prev,
      invoiceNo:     sh.shipment_number?.replace('SHP', 'CI') ?? '',
      invoiceDate:   new Date().toISOString().split('T')[0],
      plNo:          sh.shipment_number?.replace('SHP', 'PL') ?? '',
      wbNo:          sh.shipment_number?.replace('SHP', 'WB') ?? '',
      portLoading:   sh.port_of_loading ?? 'Shenzhen, China',
      paymentTerms:  sh.payment_terms ?? 'TT 30% + 70% LC',
      truckPlate:    sh.truck_plate ?? '',
      sealNo:        sh.seal_number ?? '',
      driverName:    sh.driver_name ?? '',
      blNo:          sh.bl_number ?? '',
      vesselName:    sh.vessel_name ?? '',
      voyageNo:      sh.voyage_number ?? '',
      departureDate: sh.loaded_to_truck_date ?? '',
      arrivalDate:   sh.arrived_addis_date ?? '',
    }))
  }

  setData({
    shipment:  sh,
    items:     enrichedItems,
    company:   coRes.data,
    consignee: cnRes.data,
    fxRate:    fxRes.data?.[0]?.rate ?? 131.20,
  })
  setLoading(false)
}

  useEffect(() => { load() }, [id])

  async function saveOverrides() {
    if (!id || !data) return
    setSaving(true)
    await supabase.from('shipments').update({
      port_of_loading:       overrides.portLoading,
      payment_terms:         overrides.paymentTerms,
      truck_plate:           overrides.truckPlate || null,
      seal_number:           overrides.sealNo || null,
      driver_name:           overrides.driverName || null,
      bl_number:             overrides.blNo || null,
      vessel_name:           overrides.vesselName || null,
      voyage_number:         overrides.voyageNo || null,
      loaded_to_truck_date:  overrides.departureDate || null,
      arrived_addis_date:    overrides.arrivalDate || null,
      updated_at:            new Date().toISOString(),
    }).eq('id', id)
    setSaving(false)
    setEditing(false)
  }

  function print() {
    window.print()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
      <Loader2 size={18} className="animate-spin" /> Loading documents…
    </div>
  )

  if (!data) return (
    <div className="p-5 text-center text-gray-400">Shipment not found.</div>
  )

  const { shipment, items, company, consignee, fxRate: customsRate } = data
  const supplier  = shipment?.suppliers
  const totalFob  = items.reduce((s: number, i: any) => s + i.quantity * i.unit_price_usd, 0)
  const totalWt   = items.reduce((s: number, i: any) => s + (i.weight_kg_total ?? 0), 0)
  const totalVol  = items.reduce((s: number, i: any) => s + (i.volume_m3_total ?? 0), 0)
  const totalCtns = items.reduce((s: number, i: any) => s + (i.carton_qty ?? Math.ceil(i.quantity / 2)), 0)
  const today     = new Date().toLocaleDateString('en-ET', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  })

  return (
    <div>
      {/* Toolbar — hidden on print */}
      <div className="p-5 max-w-5xl mx-auto print:hidden">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <Link to={`/shipments/${id}`}
                  className="inline-flex items-center gap-1 text-xs text-gray-400
                             hover:text-gray-600 transition-colors">
              <ArrowLeft size={13} /> Back
            </Link>
            <h1 className="text-lg font-medium">Shipping documents</h1>
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button
                  onClick={() => setEditing(false)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 border
                             border-gray-200 rounded-lg hover:bg-gray-50 transition-colors
                             text-gray-600"
                >
                  <X size={12} /> Cancel
                </button>
                <button
                  onClick={saveOverrides}
                  disabled={saving}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-700
                             text-white rounded-lg hover:bg-green-800 transition-colors
                             disabled:opacity-50"
                >
                  {saving
                    ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                    : <><Save size={12} /> Save to shipment</>
                  }
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 border
                           border-gray-200 rounded-lg hover:bg-gray-50 transition-colors
                           text-gray-600"
              >
                <Edit2 size={12} /> Edit document details
              </button>
            )}
            <button
              onClick={print}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-600
                         text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Printer size={12} /> Print / Save PDF
            </button>
          </div>
        </div>

        {/* Document selector */}
        <div className="flex gap-2 mb-5">
          {([
            { key: 'commercial', label: 'Commercial invoice', icon: FileText },
            { key: 'packing',    label: 'Packing list',       icon: Package  },
            { key: 'waybill',    label: 'Truck waybill',      icon: Truck    },
          ] as const).map(d => (
            <button
              key={d.key}
              onClick={() => setDocType(d.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg
                          border transition-colors
                ${docType === d.key
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
            >
              <d.icon size={13} />
              {d.label}
            </button>
          ))}
        </div>

        {/* Edit panel */}
        {editing && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
            <p className="text-xs font-medium text-amber-800 mb-3">
              Edit document details — changes are saved to the shipment record
            </p>
            <div className="grid grid-cols-3 gap-3">
              {docType === 'commercial' && (
                <>
                  <div>
                    <label className="block text-xs text-amber-700 mb-1">Invoice number</label>
                    <input className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                           value={overrides.invoiceNo} onChange={e => setOverrides(p => ({ ...p, invoiceNo: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-amber-700 mb-1">Invoice date</label>
                    <input type="date" className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded-lg bg-white focus:outline-none"
                           value={overrides.invoiceDate} onChange={e => setOverrides(p => ({ ...p, invoiceDate: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-amber-700 mb-1">Payment terms</label>
                    <input className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded-lg bg-white focus:outline-none"
                           value={overrides.paymentTerms} onChange={e => setOverrides(p => ({ ...p, paymentTerms: e.target.value }))} placeholder="30% TT + 70% LC" />
                  </div>
                  <div>
                    <label className="block text-xs text-amber-700 mb-1">Vessel / vessel name</label>
                    <input className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded-lg bg-white focus:outline-none"
                           value={overrides.vesselName} onChange={e => setOverrides(p => ({ ...p, vesselName: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-amber-700 mb-1">BL number</label>
                    <input className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded-lg bg-white focus:outline-none font-mono"
                           value={overrides.blNo} onChange={e => setOverrides(p => ({ ...p, blNo: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-amber-700 mb-1">Port of loading</label>
                    <input className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded-lg bg-white focus:outline-none"
                           value={overrides.portLoading} onChange={e => setOverrides(p => ({ ...p, portLoading: e.target.value }))} />
                  </div>
                </>
              )}
              {docType === 'waybill' && (
                <>
                  <div>
                    <label className="block text-xs text-amber-700 mb-1">Waybill number</label>
                    <input className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded-lg bg-white focus:outline-none"
                           value={overrides.wbNo} onChange={e => setOverrides(p => ({ ...p, wbNo: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-amber-700 mb-1">Truck plate</label>
                    <input className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded-lg bg-white focus:outline-none font-mono"
                           value={overrides.truckPlate} onChange={e => setOverrides(p => ({ ...p, truckPlate: e.target.value }))} placeholder="AA-12345" />
                  </div>
                  <div>
                    <label className="block text-xs text-amber-700 mb-1">Seal number</label>
                    <input className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded-lg bg-white focus:outline-none font-mono"
                           value={overrides.sealNo} onChange={e => setOverrides(p => ({ ...p, sealNo: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-amber-700 mb-1">Driver name</label>
                    <input className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded-lg bg-white focus:outline-none"
                           value={overrides.driverName} onChange={e => setOverrides(p => ({ ...p, driverName: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-amber-700 mb-1">Departure date</label>
                    <input type="date" className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded-lg bg-white focus:outline-none"
                           value={overrides.departureDate} onChange={e => setOverrides(p => ({ ...p, departureDate: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-amber-700 mb-1">Expected arrival</label>
                    <input type="date" className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded-lg bg-white focus:outline-none"
                           value={overrides.arrivalDate} onChange={e => setOverrides(p => ({ ...p, arrivalDate: e.target.value }))} />
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ══ PRINT AREA ═════════════════════════════════════════ */}
      {/* doc-light: these are printable paper documents (invoice, packing
          list, customs declaration) — always rendered light regardless of
          app theme, since they represent a physical/printed artifact. */}
      <div ref={printRef} className="doc-light max-w-4xl mx-auto px-6 print:px-8 print:max-w-none">
        <style>{`
          @media print {
            @page { size: A4; margin: 15mm; }
            .print\\:hidden { display: none !important; }
            body { font-size: 11px; }
          }
        `}</style>

        {/* ══ COMMERCIAL INVOICE ═════════════════════════════ */}
        {docType === 'commercial' && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden
                          print:border-none print:rounded-none">

            {/* Header */}
            <div className="px-8 py-6 border-b-2 border-gray-900">
              <div className="flex justify-between items-start">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 tracking-wide">
                    COMMERCIAL INVOICE
                  </h1>
                  <p className="text-sm text-gray-500 mt-1">Original · Rate {customsRate} ETB/USD</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-gray-900">{company?.company_name}</p>
                  <p className="text-xs text-gray-500 mt-1">{company?.address}</p>
                  <p className="text-xs text-gray-500">{company?.city}, Ethiopia</p>
                  {company?.tin_number && (
                    <p className="text-xs text-gray-500">TIN: {company.tin_number}</p>
                  )}
                  {company?.email && (
                    <p className="text-xs text-gray-500">{company.email}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Invoice meta */}
            <div className="grid grid-cols-3 border-b border-gray-200">
              <div className="px-6 py-3 border-r border-gray-200">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Invoice no.</p>
                <p className="text-sm font-bold mt-0.5">{overrides.invoiceNo}</p>
              </div>
              <div className="px-6 py-3 border-r border-gray-200">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Date</p>
                <p className="text-sm font-medium mt-0.5">{overrides.invoiceDate || today}</p>
              </div>
              <div className="px-6 py-3">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Payment terms</p>
                <p className="text-sm font-medium mt-0.5">{overrides.paymentTerms || '—'}</p>
              </div>
            </div>

            {/* Seller / Buyer */}
            <div className="grid grid-cols-2 border-b border-gray-200">
              <div className="px-6 py-4 border-r border-gray-200">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                  Seller / Exporter
                </p>
                <p className="text-sm font-bold">{supplier?.name ?? '—'}</p>
                <p className="text-xs text-gray-600 mt-0.5">
                  {supplier?.country ?? 'China'}
                </p>
                {supplier?.contact_person && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Attn: {supplier.contact_person}
                  </p>
                )}
                {supplier?.email && (
                  <p className="text-xs text-gray-500">{supplier.email}</p>
                )}
              </div>
              <div className="px-6 py-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                  Buyer / Consignee
                </p>
                <p className="text-sm font-bold">
                  {consignee?.name ?? company?.company_name ?? '—'}
                </p>
                <p className="text-xs text-gray-600 mt-0.5">
                  {consignee?.address ?? company?.address ?? '—'}
                </p>
                <p className="text-xs text-gray-600">
                  {consignee?.city ?? 'Addis Ababa'}, Ethiopia
                </p>
                {(consignee?.tin_number ?? company?.tin_number) && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    TIN: {consignee?.tin_number ?? company?.tin_number}
                  </p>
                )}
              </div>
            </div>

            {/* Shipping details */}
            <div className="grid grid-cols-4 border-b border-gray-200">
              {[
                { label: 'Vessel / carrier', val: overrides.vesselName || '—' },
                { label: 'BL number',        val: overrides.blNo || shipment?.container_number || '—' },
                { label: 'Port of loading',  val: overrides.portLoading },
                { label: 'Port of discharge',val: overrides.portDischarge },
              ].map((f, i) => (
                <div key={f.label}
                     className={`px-6 py-3 ${i < 3 ? 'border-r border-gray-200' : ''}`}>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">{f.label}</p>
                  <p className="text-xs font-medium mt-0.5">{f.val}</p>
                </div>
              ))}
            </div>

            {/* Items table */}
            <div className="px-0">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-900 text-white">
                    <th className="text-left px-4 py-2.5 font-medium">Description of goods</th>
                    <th className="text-left px-3 py-2.5 font-medium">HS code</th>
                    <th className="text-left px-3 py-2.5 font-medium">Country of origin</th>
                    <th className="text-right px-3 py-2.5 font-medium">Qty</th>
                    <th className="text-left px-3 py-2.5 font-medium">Unit</th>
                    <th className="text-right px-3 py-2.5 font-medium">Unit price (USD)</th>
                    <th className="text-right px-3 py-2.5 font-medium">Total (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any, i: number) => {
                    const prod = item.products
                    return (
                      <tr key={item.id}
                          className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-2.5 font-medium">
                          {prod?.name ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-gray-500">
                          {item.hs_code || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-gray-500">
                          {item.country_of_origin || 'China'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">
                          {N(item.quantity)}
                        </td>
                        <td className="px-3 py-2.5 text-gray-500">
                          {prod?.unit_of_measure ?? 'PCS'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">
                          USD {item.unit_price_usd.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-medium">
                          USD {N(item.quantity * item.unit_price_usd)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 border-t-2 border-gray-400 font-bold">
                    <td colSpan={3} className="px-4 py-2.5 text-xs text-gray-600">
                      TOTAL
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      {N(items.reduce((s: number, i: any) => s + i.quantity, 0))}
                    </td>
                    <td></td>
                    <td></td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      USD {N(totalFob)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    I/We hereby certify that the information on this invoice is
                    true and correct and that the contents and value of this
                    consignment are as stated above.
                  </p>
                  {company?.bank_name && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-gray-600">
                        Banking details:
                      </p>
                      <p className="text-xs text-gray-500">
                        {company.bank_name}
                        {company.bank_account && ` · Acc: ${company.bank_account}`}
                      </p>
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 mb-8">
                    Authorized signature & stamp
                  </p>
                  <div className="border-t border-gray-300 pt-1">
                    <p className="text-xs text-gray-500">{company?.company_name}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ PACKING LIST ════════════════════════════════════ */}
        {docType === 'packing' && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden
                          print:border-none print:rounded-none">

            <div className="px-8 py-6 border-b-2 border-gray-900">
              <div className="flex justify-between items-start">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 tracking-wide">
                    PACKING LIST
                  </h1>
                  <p className="text-xs text-gray-500 mt-1">
                    PL No: {overrides.plNo} · Date: {overrides.invoiceDate || today}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-base font-bold">{company?.company_name}</p>
                  <p className="text-xs text-gray-500">{company?.address}, {company?.city}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 border-b border-gray-200">
              <div className="px-6 py-4 border-r border-gray-200">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Shipper</p>
                <p className="text-sm font-bold">{supplier?.name ?? '—'}</p>
                <p className="text-xs text-gray-500">{supplier?.country ?? 'China'}</p>
              </div>
              <div className="px-6 py-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Consignee</p>
                <p className="text-sm font-bold">{consignee?.name ?? company?.company_name ?? '—'}</p>
                <p className="text-xs text-gray-500">
                  {consignee?.address ?? company?.address}, {consignee?.city ?? 'Addis Ababa'}, Ethiopia
                </p>
                {(consignee?.tin_number ?? company?.tin_number) && (
                  <p className="text-xs text-gray-500">
                    TIN: {consignee?.tin_number ?? company?.tin_number}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-4 border-b border-gray-200">
              {[
                { label: 'Container no.', val: shipment?.container_number ?? '—' },
                { label: 'Vessel', val: overrides.vesselName || '—' },
                { label: 'Port of loading', val: overrides.portLoading },
                { label: 'Port of discharge', val: overrides.portDischarge },
              ].map((f, i) => (
                <div key={f.label}
                     className={`px-6 py-2.5 ${i < 3 ? 'border-r border-gray-200' : ''}`}>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">{f.label}</p>
                  <p className="text-xs font-medium mt-0.5">{f.val}</p>
                </div>
              ))}
            </div>

            <div className="px-0">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-900 text-white">
                    <th className="text-left px-4 py-2.5 font-medium">#</th>
                    <th className="text-left px-3 py-2.5 font-medium">Description</th>
                    <th className="text-right px-3 py-2.5 font-medium">Ctns</th>
                    <th className="text-right px-3 py-2.5 font-medium">Pcs/Ctn</th>
                    <th className="text-right px-3 py-2.5 font-medium">Total pcs</th>
                    <th className="text-right px-3 py-2.5 font-medium">G.W (kg)</th>
                    <th className="text-right px-3 py-2.5 font-medium">N.W (kg)</th>
                    <th className="text-right px-3 py-2.5 font-medium">Vol (m³)</th>
                    <th className="text-right px-3 py-2.5 font-medium">Unit (USD)</th>
                    <th className="text-right px-3 py-2.5 font-medium">Total (USD)</th>
                    <th className="text-left px-3 py-2.5 font-medium">Ctn nos.</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any, i: number) => {
                    const prod = item.products
  const isCarton = item.unit_of_measure === 'CTN'

  // Use real data when available, fall back to estimate
  const ctns = isCarton
    ? item.quantity                                    // already in cartons
    : item.carton_qty ?? Math.ceil(item.quantity / 2)   // estimate for PCS

  const ppc = isCarton
    ? (item.units_per_carton ?? 1)
    : (item.units_per_carton ?? 2)

  const totalPcs = isCarton
    ? item.quantity * ppc
    : item.quantity
                    const gwCtn   = item.gross_weight_per_ctn
                    const nwCtn   = item.net_weight_per_ctn
                    const gw      = item.weight_kg_total ?? (gwCtn ? gwCtn * ctns : null)
                    const nw      = nwCtn ? nwCtn * ctns : null
                    const vol     = item.volume_m3_total ??
                      (item.length_cm && item.width_cm && item.height_cm
                        ? item.length_cm * item.width_cm * item.height_cm / 1000000 * ctns
                        : null)
                    const ctnFrom = item.carton_number_from
                    const ctnTo   = item.carton_number_to
                    return (
                      <tr key={item.id}
                          className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                        <td className="px-3 py-2">
                          <p className="font-medium">{prod?.name ?? '—'}</p>
                          {item.hs_code && (
                            <p className="font-mono text-gray-400 text-xs">
                              HS: {item.hs_code}
                            </p>
                          )}
                          {item.carton_marks && (
                            <p className="text-gray-400 text-xs">{item.carton_marks}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{ctns}</td>
                        <td className="px-3 py-2 text-right font-mono">{ppc}</td>
                        <td className="px-3 py-2 text-right font-mono font-medium">
                          {N(totalPcs)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {gw ? N(gw) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-gray-500">
                          {nw ? N(nw) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {vol ? vol.toFixed(3) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {item.unit_price_usd.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-medium">
                          {N(item.quantity * item.unit_price_usd)}
                        </td>
                        <td className="px-3 py-2 font-mono text-gray-500">
                          {ctnFrom && ctnTo ? `${ctnFrom}–${ctnTo}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 border-t-2 border-gray-400 font-bold">
                    <td colSpan={2} className="px-4 py-2.5 text-xs">TOTAL</td>
                    <td className="px-3 py-2.5 text-right font-mono">{N(totalCtns)}</td>
                    <td></td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      {N(items.reduce((s: number, i: any) => s + i.quantity, 0))}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      {totalWt > 0 ? N(totalWt) : '—'}
                    </td>
                    <td></td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      {totalVol > 0 ? totalVol.toFixed(3) : '—'}
                    </td>
                    <td></td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      USD {N(totalFob)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="px-6 py-4 border-t border-gray-200">
              <div className="grid grid-cols-3 gap-4 text-xs text-gray-600">
                <div>
                  <p className="font-medium">Total packages:</p>
                  <p className="text-lg font-bold mt-0.5">{N(totalCtns)} cartons</p>
                </div>
                <div>
                  <p className="font-medium">Total gross weight:</p>
                  <p className="text-lg font-bold mt-0.5">
                    {totalWt > 0 ? `${N(totalWt)} KG` : '—'}
                  </p>
                </div>
                <div>
                  <p className="font-medium">Total volume:</p>
                  <p className="text-lg font-bold mt-0.5">
                    {totalVol > 0 ? `${totalVol.toFixed(3)} CBM` : '—'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ TRUCK WAYBILL ══════════════════════════════════ */}
        {docType === 'waybill' && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden
                          print:border-none print:rounded-none">

            <div className="px-8 py-6 border-b-2 border-gray-900">
              <div className="flex justify-between items-start">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 tracking-wide">
                    ROAD TRANSPORT WAYBILL
                  </h1>
                  <p className="text-xs text-gray-500 mt-1">
                    WB No: {overrides.wbNo} · Date: {overrides.invoiceDate || today}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 font-medium">
                    Djibouti → Addis Ababa, Ethiopia
                  </p>
                  <p className="text-xs text-gray-400">~900 km, International road transport</p>
                </div>
              </div>
            </div>

            {/* Transport details */}
            <div className="grid grid-cols-4 border-b border-gray-200">
              {[
                { label: 'Container no.', val: shipment?.container_number ?? '—' },
                { label: 'Truck plate no.',val: overrides.truckPlate || '—' },
                { label: 'Seal number',    val: overrides.sealNo || '—' },
                { label: 'Driver name',    val: overrides.driverName || '—' },
              ].map((f, i) => (
                <div key={f.label}
                     className={`px-6 py-3 ${i < 3 ? 'border-r border-gray-200' : ''}`}>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">{f.label}</p>
                  <p className="text-xs font-bold mt-0.5">{f.val}</p>
                </div>
              ))}
            </div>

            {/* Sender / Receiver */}
            <div className="grid grid-cols-2 border-b border-gray-200">
              <div className="px-6 py-4 border-r border-gray-200">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                  Consignor (Sender)
                </p>
                <p className="text-sm font-bold">
                  {supplier?.name ?? 'Clearing Agent'}, Djibouti
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Port of Djibouti, Republic of Djibouti</p>
              </div>
              <div className="px-6 py-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                  Consignee (Receiver)
                </p>
                <p className="text-sm font-bold">
                  {consignee?.name ?? company?.company_name ?? '—'}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {consignee?.address ?? company?.address}, {consignee?.city ?? 'Addis Ababa'}, Ethiopia
                </p>
                {(consignee?.tin_number ?? company?.tin_number) && (
                  <p className="text-xs text-gray-500">
                    TIN: {consignee?.tin_number ?? company?.tin_number}
                  </p>
                )}
              </div>
            </div>

            {/* Route */}
            <div className="grid grid-cols-4 border-b border-gray-200 bg-gray-50">
              {[
                { label: 'Place of loading',  val: 'Port of Djibouti' },
                { label: 'Place of delivery', val: consignee?.city ?? 'Addis Ababa, Ethiopia' },
                { label: 'Departure date',    val: overrides.departureDate || '—' },
                { label: 'Expected arrival',  val: overrides.arrivalDate || '—' },
              ].map((f, i) => (
                <div key={f.label}
                     className={`px-6 py-3 ${i < 3 ? 'border-r border-gray-200' : ''}`}>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">{f.label}</p>
                  <p className="text-xs font-bold mt-0.5">{f.val}</p>
                </div>
              ))}
            </div>

            {/* Cargo */}
            <div className="px-0">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-900 text-white">
                    <th className="text-left px-4 py-2.5 font-medium">Description of goods</th>
                    <th className="text-left px-3 py-2.5 font-medium">HS code</th>
                    <th className="text-right px-3 py-2.5 font-medium">Packages</th>
                    <th className="text-right px-3 py-2.5 font-medium">Quantity</th>
                    <th className="text-right px-3 py-2.5 font-medium">Gross weight</th>
                    <th className="text-right px-3 py-2.5 font-medium">Volume</th>
                    <th className="text-right px-3 py-2.5 font-medium">Value (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any, i: number) => {
                    const prod = item.products
                    const ctns = item.carton_qty ?? Math.ceil(item.quantity / 2)
                    return (
                      <tr key={item.id}
                          className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-2.5 font-medium">{prod?.name ?? '—'}</td>
                        <td className="px-3 py-2.5 font-mono text-gray-500">
                          {item.hs_code || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">
                          {ctns} ctns
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">
                          {N(item.quantity)} {prod?.unit_of_measure ?? 'PCS'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">
                          {item.weight_kg_total ? `${N(item.weight_kg_total)} KG` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">
                          {item.volume_m3_total ? `${item.volume_m3_total.toFixed(3)} CBM` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">
                          USD {N(item.quantity * item.unit_price_usd)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 border-t-2 border-gray-400 font-bold">
                    <td colSpan={2} className="px-4 py-2.5 text-xs">TOTAL</td>
                    <td className="px-3 py-2.5 text-right font-mono">{N(totalCtns)} ctns</td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      {N(items.reduce((s: number, i: any) => s + i.quantity, 0))} pcs
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      {totalWt > 0 ? `${N(totalWt)} KG` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      {totalVol > 0 ? `${totalVol.toFixed(3)} CBM` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      USD {N(totalFob)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Signatures */}
            <div className="px-6 py-6 border-t border-gray-200">
              <p className="text-xs text-gray-500 mb-6 leading-relaxed">
                This waybill constitutes the contract of carriage for the above-described
                goods transported by road from Djibouti to Ethiopia. The carrier confirms
                receipt of the goods in apparent good order and condition unless otherwise
                noted. Goods are subject to Ethiopian Customs authority inspection.
              </p>
              <div className="grid grid-cols-3 gap-6">
                {['Consignor signature & stamp', 'Carrier / driver signature', 'Consignee received by'].map(label => (
                  <div key={label}>
                    <div className="border-b border-gray-300 mb-2 h-12"></div>
                    <p className="text-xs text-gray-400 text-center">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}