// src/pages/ShipmentDetail.tsx

import { useState, useEffect, useCallback, Fragment } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  ArrowLeft, Plus, Loader2, X, Check,
  RefreshCw, Package, Receipt, Calculator,
  FileText, Lock, Info, Paperclip, Trash2, ClipboardPaste, Landmark,
  AlertOctagon,
} from 'lucide-react'
import { addShortageNote } from '../api/shortageNotes'
import { useConfirm } from '../hooks/useConfirm'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ContainerTimelineTabs } from '../components/shipments/ContainerTimelineTabs'
import { ShipmentStatusStepper } from '../components/shipments/ShipmentStatusStepper'
import { MarginAnalysis } from '../components/shipments/MarginAnalysis'
import { TrendingUp, Calendar } from 'lucide-react'
import { ExpenseForm } from '../components/shipments/ExpenseForm'
import { CustomsTab } from '../components/shipments/CustomsTab'
import { SupplierPayableBanner } from '../components/shipments/SupplierPayableBanner'
import { ShipmentAttachments } from '../components/shipments/ShipmentAttachments'
import { DeleteShipmentModal } from '../components/shipments/DeleteShipmentModal'
import { BulkImportModal } from '../components/BulkImportModal'
import type { BulkImportColumn } from '../components/BulkImportModal'
import { SearchableSelect } from '../components/SearchableSelect'
import { receiveShipmentToInventory, resolveAssemblyType } from '../lib/inventoryReceive'

const ITEM_IMPORT_COLUMNS: BulkImportColumn[] = [
  { key: 'sku', label: 'SKU', required: true, width: '110px' },
  { key: 'quantity', label: 'Quantity', required: true, width: '80px' },
  { key: 'unit_price_usd', label: 'Unit price (USD)', required: true, width: '100px' },
  { key: 'unit_of_measure', label: 'Unit', width: '70px' },
  { key: 'pieces_per_carton', label: 'Pieces/carton', width: '90px' },
]
const ITEM_IMPORT_EXAMPLE = `sku,quantity,unit_price_usd,unit_of_measure,pieces_per_carton
TV-55-DMD,50,220.00,PCS,
STV-2B-SCH,20,35.50,CTN,4`



// -- Types -----------------------------------------------------

interface Shipment {
  id: string
  shipment_number: string
  container_number: string | null
  status: string
  allocation_method: string
  eta_djibouti: string | null
  arrived_addis_date: string | null
  vessel_name: string | null
  bl_number: string | null
  notes: string | null
  supplier_id: string
  warehouse_id: string | null
  djibouti_received_at: string | null
  suppliers: {
    name: string; 
    contact_person?: string | null; // Added ? to make optional
    email?: string | null;          // Added ? to make optional
  } | null
}

interface Warehouse {
  id: string
  name: string
  code: string | null
  city: string | null
}

interface ShipmentItem {
  id: string
  product_id: string
  container_id: string | null
  quantity: number
  unit_price_usd: number
  unit_of_measure?: string | null
  units_per_carton?: number | null
  carton_qty?: number | null
  weight_kg_total: number | null
  volume_m3_total: number | null
  allocated_cost_etb: number | null
  unit_landed_cost_etb: number | null
  cost_status: string
  products: {
    name: string
    sku: string
    unit_of_measure: string
    weight_kg: number | null
    volume_m3: number | null
  } | null
  containers?: { container_number: string } | null
}

interface Expense {
  id: string
  category: string
  description: string
  amount: number
  currency: string
  amount_etb: number | null
  exchange_rate: number | null
  cost_status: string
  vendor_name: string | null
  expense_date: string
  receipt_ref: string | null
}

interface Product {
  id: string
  name: string
  sku: string
  unit_of_measure: string
  weight_kg: number | null
  volume_m3: number | null
}

// -- Constants -------------------------------------------------

const STATUS: Record<string, { label: string; cls: string }> = {
  ORDERED:            { label: 'Ordered',       cls: 'bg-gray-100 text-gray-600'    },
  IN_PRODUCTION:      { label: 'In production', cls: 'bg-gray-100 text-gray-600'    },
  SHIPPED:            { label: 'Shipped',       cls: 'bg-blue-50 text-blue-700'     },
  AT_DJIBOUTI:        { label: 'At Djibouti',  cls: 'bg-amber-50 text-amber-700'   },
  IN_TRANSIT:         { label: 'In transit',    cls: 'bg-purple-50 text-purple-700' },
  AT_CUSTOMS:         { label: 'At customs',    cls: 'bg-red-50 text-red-700'       },
  WAREHOUSE_RECEIVED: { label: 'Received',      cls: 'bg-green-50 text-green-700'   },
  COMPLETED:          { label: 'Completed',     cls: 'bg-green-100 text-green-800'  },
}

const CAT_LABELS: Record<string, string> = {
  CHINA_ORIGIN:     'China Origin',
  OCEAN_FREIGHT:    'Ocean Freight',
  DJIBOUTI_PORT:    'Djibouti Port',
  TRUCKING:         'Trucking',
  ETHIOPIA_CUSTOMS: 'Customs',
  OTHER:            'Other',
}

type TabKey = 'items' | 'expenses' | 'customs' | 'costs' | 'timeline' | 'margin' | 'documents'

// Commercial invoice / Packing list / Truck waybill used to also render
// inline here, duplicating (and, after the multi-container change, drifting
// from) the same documents already generated on the dedicated Documents
// page (`/shipments/:id/documents`, linked below) -- removed in favor of
// that one place to view/print them.
const TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: 'items',      label: 'PI Items',          icon: Package   },
  { key: 'expenses',   label: 'Expenses',          icon: Receipt   },
  { key: 'customs',    label: 'Customs',           icon: Landmark  },
  { key: 'costs',      label: 'Cost breakdown',    icon: Calculator},
  { key: 'timeline', label: 'Timeline & dates',  icon: Calendar    },
  { key: 'margin',   label: 'Margin analysis',   icon: TrendingUp  },
  { key: 'documents', label: 'Documents',        icon: Paperclip   },
]

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

const EMPTY_ITEM = {
  product_id: '', quantity: '', unit_price_usd: '',
  weight_kg_total: '', volume_m3_total: '',
  unit_of_measure: 'PCS', pieces_per_carton: '',
}

// -- Info tooltip component ------------------------------------

function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-block">
      <button
        onClick={() => setShow(v => !v)}
        className="text-blue-400 hover:text-blue-600 transition-colors"
        aria-label="More information"
      >
        <Info size={14} />
      </button>
      {show && (
        <div
          onClick={() => setShow(false)}
          className="fixed inset-0 z-40"
        />
      )}
      {show && (
        <div className="absolute left-5 top-0 z-50 w-64 p-3 bg-white border
                        border-blue-200 rounded-xl shadow-lg text-xs
                        text-gray-700 leading-relaxed">
          {text}
        </div>
      )}
    </span>
  )
}

// -- Main component --------------------------------------------

export function ShipmentDetail() {
  const { confirm, close, state } = useConfirm();
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showItemImport, setShowItemImport] = useState(false)
  const [shortageTarget, setShortageTarget] = useState<{ itemId: string; productId: string; name: string } | null>(null)
  const [shortageForm, setShortageForm] = useState({ quantity_short: '', notes: '' })
  const [savingShortage, setSavingShortage] = useState(false)
  const [shortageError, setShortageError] = useState<string | null>(null)

  const [shipment, setShipment]   = useState<Shipment | null>(null)
  const [items, setItems]         = useState<ShipmentItem[]>([])
  const [expenses, setExpenses]   = useState<Expense[]>([])
  const [products, setProducts]   = useState<Product[]>([])
  const [fxRate, setFxRate]       = useState(131.20)
  const [loading, setLoading]     = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('items')
  const [expOpen, setExpOpen]     = useState(false)
  const [itemOpen, setItemOpen]   = useState(false)
  const [itemForm, setItemForm]   = useState({ ...EMPTY_ITEM })
  const [saving, setSaving]       = useState(false)
  const [recalcing, setRecalcing] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [editExpId, setEditExpId] = useState<string | null>(null)
  const [receiving, setReceiving] = useState(false)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('')
  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)

    const [shRes, itemsRes, expRes, prodRes, fxRes, whRes] = await Promise.all([
      supabase.from('shipments')
        .select('*, suppliers(name, contact_person, email)')
        .eq('id', id)
        .single(),
      supabase.from('shipment_items').select('*, containers(container_number)').eq('shipment_id', id),
      supabase.from('shipment_expenses').select('*').eq('shipment_id', id),
      supabase.from('products').select('*').eq('is_active', true),
      supabase.from('forex_rates').select('rate')
        .eq('from_currency', 'USD').eq('to_currency', 'ETB').eq('rate_type', 'CUSTOMS')
        .order('effective_date', { ascending: false }).limit(1),
      supabase.from('warehouses').select('*').order('name'),
    ])

    const prodMap = new Map((prodRes.data ?? []).map((p: Product) => [p.id, p]))
    const enrichedItems: ShipmentItem[] = (itemsRes.data ?? []).map((item: ShipmentItem) => ({
      ...item,
      products: prodMap.get(item.product_id) ?? null,
    }))

    if (shRes.error) setError(shRes.error.message)
    else {
      setShipment(shRes.data)
      setItems(enrichedItems)
      setExpenses(expRes.data ?? [])
      setProducts(prodRes.data ?? [])
      setFxRate(fxRes.data?.[0]?.rate ?? 131.20)
      setWarehouses(whRes.data ?? [])
      const defaultWarehouse = shRes.data?.warehouse_id
        || whRes.data?.[0]?.id
        || ''
      setSelectedWarehouseId(defaultWarehouse)
    }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const setIF = (f: string, v: string) => setItemForm(p => ({ ...p, [f]: v }))

  // -- Add PI item -------------------------------------------

  async function saveItem() {
  if (!itemForm.product_id) { setError('Select a product'); return }
  if (!itemForm.quantity || !itemForm.unit_price_usd) {
    setError('Quantity and unit price are required'); return
  }
  setSaving(true)
  setError(null)

  const prod = products.find(p => p.id === itemForm.product_id)
  const qty  = parseFloat(itemForm.quantity)
  const isCarton = itemForm.unit_of_measure === 'CTN'
  const pcsPerCtn = isCarton ? parseFloat(itemForm.pieces_per_carton || '1') : 1

  // Total pieces - used for cost-per-unit calculations downstream
  const totalPieces = isCarton ? qty * pcsPerCtn : qty

  const { error: err } = await supabase.from('shipment_items').insert({
    shipment_id:       id,
    product_id:        itemForm.product_id,
    quantity:          qty,                    // as entered (could be CTN count)
    unit_of_measure:   itemForm.unit_of_measure,
    units_per_carton:  isCarton ? pcsPerCtn : null,
    carton_qty:        isCarton ? qty : Math.ceil(totalPieces / (parseFloat(itemForm.pieces_per_carton || '2') || 2)),
    unit_price_usd:    parseFloat(itemForm.unit_price_usd),
    weight_kg_total:   itemForm.weight_kg_total
      ? parseFloat(itemForm.weight_kg_total)
      : prod?.weight_kg ? prod.weight_kg * totalPieces : null,
    volume_m3_total:   itemForm.volume_m3_total
      ? parseFloat(itemForm.volume_m3_total)
      : prod?.volume_m3 ? prod.volume_m3 * totalPieces : null,
    cost_status: 'PROVISIONAL',
  })

  if (err) { setError(err.message); setSaving(false); return }
  setSaving(false)
  setItemOpen(false)
  setItemForm({ ...EMPTY_ITEM })
  load()
}

  async function handleItemBulkImport(rows: Record<string, string>[]) {
    const errors: string[] = []
    let succeeded = 0
    for (const row of rows) {
      const sku = row.sku?.trim().toUpperCase()
      const prod = products.find(p => p.sku.toUpperCase() === sku)
      if (!prod) { errors.push(`"${row.sku}" doesn't match any product SKU — add the product first.`); continue }
      const qty = parseFloat(row.quantity)
      const unitPrice = parseFloat(row.unit_price_usd)
      if (!qty || !unitPrice) { errors.push(`${sku}: quantity and unit price are required.`); continue }

      const uom = (row.unit_of_measure || 'PCS').trim().toUpperCase()
      const isCarton = uom === 'CTN'
      const pcsPerCtn = isCarton ? (parseFloat(row.pieces_per_carton) || 1) : 1
      const totalPieces = isCarton ? qty * pcsPerCtn : qty

      const { error } = await supabase.from('shipment_items').insert({
        shipment_id: id, product_id: prod.id, quantity: qty, unit_of_measure: uom,
        units_per_carton: isCarton ? pcsPerCtn : null,
        carton_qty: isCarton ? qty : Math.ceil(totalPieces / (parseFloat(row.pieces_per_carton) || 2)),
        unit_price_usd: unitPrice,
        weight_kg_total: prod.weight_kg ? prod.weight_kg * totalPieces : null,
        volume_m3_total: prod.volume_m3 ? prod.volume_m3 * totalPieces : null,
        cost_status: 'PROVISIONAL',
      })
      if (error) errors.push(`${sku}: ${error.message}`)
      else succeeded++
    }
    return { succeeded, errors }
  }

  // -- Edit expense ------------------------------------------

  function openEditExp(exp: Expense) {
    setEditExpId(exp.id)
    setError(null)
    setExpOpen(true)
  }

  async function deleteExpense(expId: string, desc: string) {
    confirm({
      title: 'Delete expense?',
      message: `"${desc}" will be permanently removed. The landed cost will need to be recalculated.`,
      onConfirm: async () => {
        await supabase.from('shipment_expenses').delete().eq('id', expId)
        close()
        load()
      }
    })
  }


  async function deleteItem(itemId: string, name: string) {
    confirm({
      title: 'Remove item?',
      message: `"${name}" will be removed from this shipment. Any calculated costs will need to be recalculated.`,
      onConfirm: async () => {
        await supabase.from('shipment_items').delete().eq('id', itemId)
        close()
        load()
      }
    })
  }

  // "Yaltechane" tracking -- flags a product as having come up short on this
  // shipment, against the supplier, so it resurfaces as a reminder when
  // starting the next order with the same supplier (src/pages/ProformaInvoices.tsx).
  async function saveShortageNote() {
    if (!shortageTarget || !shipment) return
    setSavingShortage(true)
    setShortageError(null)
    try {
      await addShortageNote({
        supplierId: shipment.supplier_id,
        productId: shortageTarget.productId,
        shipmentId: id,
        quantityShort: shortageForm.quantity_short ? parseFloat(shortageForm.quantity_short) : null,
        notes: shortageForm.notes || null,
      })
      setShortageTarget(null)
      setShortageForm({ quantity_short: '', notes: '' })
    } catch (e: any) {
      setShortageError(e?.message ?? String(e))
    } finally {
      setSavingShortage(false)
    }
  }

  async function updateShipmentWarehouse(warehouseId: string) {
    if (!id || !shipment) return
    setSelectedWarehouseId(warehouseId)
    await supabase.from('shipments').update({ warehouse_id: warehouseId }).eq('id', id)
    setShipment({ ...shipment, warehouse_id: warehouseId })
  }

  async function receiveIntoInventory() {
    if (!id || items.length === 0) return
    if (!selectedWarehouseId) {
      setError('Select a warehouse before receiving this shipment.')
      return
    }
    setReceiving(true)
    setError(null)
    try {
      const { data: prodMeta } = await supabase
        .from('products')
        .select('id, assembly_type, is_assembled')
        .in('id', items.map(i => i.product_id))

      const metaMap = new Map((prodMeta ?? []).map(p => [p.id, p]))

      await receiveShipmentToInventory(
        id,
        items.map(item => ({
          shipment_item_id:     item.id,
          product_id:           item.product_id,
          product_name:         item.products?.name ?? '',
          quantity:             item.quantity,
          unit_landed_cost_etb: item.unit_landed_cost_etb,
          assembly_type:        resolveAssemblyType(metaMap.get(item.product_id) ?? {}),
        })),
        fxRate,
        selectedWarehouseId,
      )
      load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setReceiving(false)
    }
  }


  // -- Cost calculation --------------------------------------

  async function recalculate() {
    if (items.length === 0) {
      setError('Add at least one product before calculating costs.')
      return
    }
    if (expenses.length === 0) {
      setError('Add at least one expense before calculating costs.')
      return
    }
    setRecalcing(true)
    setError(null)

    const totalOverhead = expenses.reduce(
      (s, e) => s + (e.amount_etb ?? e.amount), 0
    )
    const method = shipment?.allocation_method ?? 'QUANTITY'

    const bases = items.map(item => {
      switch (method) {
        case 'WEIGHT': return item.weight_kg_total ?? item.quantity
        case 'VOLUME': return item.volume_m3_total ?? item.quantity
        case 'VALUE':  return item.quantity * item.unit_price_usd * fxRate
        default:       return item.quantity
      }
    })

    const totalBasis = bases.reduce((s, b) => s + b, 0)
    if (totalBasis === 0) {
      setError('All items have zero basis. Check that quantities are entered.')
      setRecalcing(false)
      return
    }

    for (let i = 0; i < items.length; i++) {
      const item      = items[i]
      const share     = bases[i] / totalBasis
      const overhead  = totalOverhead * share
      const prodCost  = item.unit_price_usd * fxRate
      const unitLanded = Math.round((prodCost + overhead / item.quantity) * 100) / 100

      await supabase.from('shipment_items')
        .update({
          allocated_cost_etb:   Math.round(overhead * 100) / 100,
          unit_landed_cost_etb: unitLanded,
          cost_calculated_at:   new Date().toISOString(),
        })
        .eq('id', item.id)
    }

    setRecalcing(false)
    load()
  }

  // -- Derived -----------------------------------------------

  const totalExpEtb  = expenses.reduce((s, e) => s + (e.amount_etb ?? 0), 0)
  // Customs has its own dedicated tab now — this is what the Expenses tab's
  // own "Total" actually itemizes below it (totalExpEtb above stays the true
  // all-in landed-cost figure used everywhere else, unchanged).
  const nonCustomsExpenses = expenses.filter(e => e.category !== 'ETHIOPIA_CUSTOMS')
  const customsExpenses = expenses.filter(e => e.category === 'ETHIOPIA_CUSTOMS')
  const nonCustomsExpEtb = nonCustomsExpenses.reduce((s, e) => s + (e.amount_etb ?? 0), 0)
  const freightUsd = expenses
    .filter(e => e.category === 'OCEAN_FREIGHT' && e.currency === 'USD')
    .reduce((s, e) => s + e.amount, 0)
  const insuranceUsd = expenses
    .filter(e => e.category === 'OCEAN_FREIGHT' && /insurance/i.test(e.description))
    .reduce((s, e) => s + (e.currency === 'USD' ? e.amount : e.amount / fxRate), 0)
  const totalFobUsd  = items.reduce((s, i) => s + i.quantity * i.unit_price_usd, 0)
  const st           = shipment ? (STATUS[shipment.status] ?? STATUS['ORDERED']) : null
  const allProvisional = items.some(i => i.cost_status === 'PROVISIONAL')

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
      <Loader2 size={18} className="animate-spin" /> Loading…
    </div>
  )

  if (!shipment) return (
    <div className="p-5 text-center text-gray-400">Shipment not found.</div>
  )

  const supplier = shipment.suppliers as any

  return (
    <div className="p-5 max-w-6xl mx-auto">

      {/* Back */}
      <Link to="/shipments"
            className="inline-flex items-center gap-1 text-xs text-gray-400
                       hover:text-gray-600 mb-4 transition-colors">
        <ArrowLeft size={13} /> Back to shipments
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-lg font-medium">{shipment.shipment_number}</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {supplier?.name ?? '-'}
            {shipment.container_number && ` · ${shipment.container_number}`}
            {shipment.vessel_name && ` · ${shipment.vessel_name}`}
            {shipment.eta_djibouti && ` · ETA Djibouti ${shipment.eta_djibouti}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${st?.cls}`}>
            {st?.label}
          </span>
          {allProvisional && items.length > 0 && expenses.length > 0 && (
            <Link
              to={`/shipments/${id}/finalize`}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-50
                         border border-amber-300 text-amber-700 rounded-lg
                         hover:bg-amber-100 transition-colors"
            >
              <Lock size={12} /> Finalize costs
            </Link>
            
            
          )}
          <Link
              to={`/shipments/${id}/documents`}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border
                          border-gray-200 bg-white text-gray-600 rounded-lg
                          hover:bg-gray-50 transition-colors"
              >
              <FileText size={12} /> Documents
            </Link>
            <button
              onClick={() => setShowDeleteModal(true)}
              title="Delete shipment"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border
                          border-gray-200 bg-white text-gray-400 rounded-lg
                          hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
              >
              <Trash2 size={12} />
            </button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          {
            label: 'FOB value',
            val: `$${N(totalFobUsd)}`,
            sub: 'Ex-factory USD',
            tip: 'FOB (Free on Board) is the product price before freight and insurance. This comes directly from your Proforma Invoice.',
          },
          {
            label: 'Total expenses',
            val: `${N(totalExpEtb)} ETB`,
            sub: 'All landed costs',
            tip: 'Sum of all costs attached to this shipment: freight, Djibouti port fees, trucking, customs duty, VAT, and other charges.',
          },
          {
            label: 'Items',
            val: String(items.length),
            sub: `${items.filter(i => i.unit_landed_cost_etb).length} with costs`,
            tip: 'Number of product lines in this shipment. Each line corresponds to one row on your Proforma Invoice.',
          },
          {
            label: 'Exchange rate',
            val: `${fxRate} ETB`,
            sub: 'Per 1 USD (customs)',
            tip: 'The National Bank of Ethiopia (NBE) customs rate used to convert USD costs to ETB. Update this in Settings → Forex Rates before calculating.',
          },
        ].map(s => (
          <div key={s.label} className="bg-gray-50 rounded-xl px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1">
              <p className="text-xs text-gray-400">{s.label}</p>
              <InfoTip text={s.tip} />
            </div>
            <p className="text-sm font-medium font-mono">{s.val}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <ShipmentStatusStepper status={shipment.status} />

      {/* Shipment already landed at Ali's Djibouti warehouse — receiving it
          again here directly into a warehouse would double-credit
          inventory on top of whatever the Djibouti dispatch/receive cycle
          transfers. That flow owns getting it into the final warehouse. */}
      {items.length > 0 && shipment.djibouti_received_at && !['WAREHOUSE_RECEIVED', 'COMPLETED'].includes(shipment.status) && (
        <div className="flex items-start gap-2 px-4 py-3 mb-5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>
            This shipment already landed at Ali's Djibouti warehouse. Get it into your warehouse via{' '}
            <Link to="/djibouti" className="underline font-medium">Djibouti Forwarder</Link> (request → dispatch → confirm receipt),
            not by receiving it directly here — that would double-count the stock.
          </span>
        </div>
      )}

      {/* Receive into inventory */}
      {items.length > 0 && !shipment.djibouti_received_at && !['WAREHOUSE_RECEIVED', 'COMPLETED'].includes(shipment.status) && (
        <div className="flex flex-col gap-3 px-4 py-3 mb-5 bg-green-50 border border-green-200 rounded-xl md:flex-row md:items-center md:justify-between">
          <div className="text-xs text-green-800">
            <p className="font-medium">Ready for warehouse receipt</p>
            <p className="mt-0.5 text-green-700">
              Inventory entries will be created for each shipment line and routed to assembly components or finished stock based on the product type.
            </p>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <label className="text-xs text-green-800 flex flex-col gap-1">
              Warehouse
              <select
                value={selectedWarehouseId}
                onChange={e => updateShipmentWarehouse(e.target.value)}
                className="w-full min-w-[220px] px-3 py-2 text-sm border border-green-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-green-400"
              >
                <option value="">Select warehouse</option>
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}{w.city ? ` — ${w.city}` : ''}</option>
                ))}
              </select>
            </label>
            <button
              onClick={receiveIntoInventory}
              disabled={receiving || !selectedWarehouseId}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 text-white
                         text-xs rounded-lg hover:bg-green-800 disabled:opacity-50 shrink-0"
            >
              {receiving
                ? <><Loader2 size={12} className="animate-spin" /> Receiving…</>
                : <><Package size={12} /> Receive into inventory</>
              }
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1.5 mb-5 border-b border-gray-100
                      pb-3 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg
                        border transition-colors whitespace-nowrap shrink-0
              ${activeTab === tab.key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            <tab.icon size={12} />
            {tab.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            onClick={recalculate}
            disabled={recalcing || items.length === 0 || expenses.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border
                       border-gray-200 rounded-lg hover:bg-gray-50
                       disabled:opacity-40 transition-colors text-gray-600"
          >
            <RefreshCw size={12} className={recalcing ? 'animate-spin' : ''} />
            {recalcing ? 'Calculating…' : 'Recalculate'}
          </button>
        </div>
      </div>

      {/* Global error */}
      {error && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border
                        border-red-200 rounded-xl text-xs text-red-700 mb-4">
          <X size={14} className="shrink-0 mt-0.5 cursor-pointer"
             onClick={() => setError(null)} />
          {error}
        </div>
      )}

      {/* PI ITEMS TAB */}
      {activeTab === 'items' && (
        <div>
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Proforma Invoice items</p>
                <InfoTip text="Enter one row per product exactly as it appears on your supplier's Proforma Invoice (PI). This is the official document that lists what you ordered, quantities, HS codes, and unit prices in USD. The system uses this to calculate customs duty and allocate landed costs." />
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Enter items exactly as on your PI document
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setError(null); setShowItemImport(true) }}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 bg-white
                           text-gray-600 text-xs rounded-lg hover:bg-gray-50 transition-colors"
              >
                <ClipboardPaste size={13} /> Paste PI items
              </button>
              <button
                onClick={() => { setItemForm({ ...EMPTY_ITEM }); setError(null); setItemOpen(true) }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                           text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus size={13} /> Add item
              </button>
            </div>
          </div>

          {shipment && (
            <SupplierPayableBanner
              shipmentId={shipment.id}
              supplierId={shipment.supplier_id}
              supplierName={shipment.suppliers?.name ?? 'this supplier'}
              totalFobUsd={totalFobUsd}
            />
          )}

          {showItemImport && (
            <BulkImportModal
              title="Paste PI items"
              columns={ITEM_IMPORT_COLUMNS}
              exampleCsv={ITEM_IMPORT_EXAMPLE}
              helpText="Paste rows straight from your supplier's Proforma Invoice. Match SKUs to products already in the system (add any missing products first) — quantity and unit price (USD) are required."
              onImport={handleItemBulkImport}
              onClose={() => setShowItemImport(false)}
              onImported={load}
            />
          )}

          {items.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
              <Package size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">No items yet</p>
              <p className="text-xs text-gray-400 mb-2 max-w-sm mx-auto">
                Add each product line from your Proforma Invoice. You need at least
                one product here before you can calculate landed costs.
              </p>
              <div className="flex items-center justify-center gap-1 text-xs
                              text-blue-600 mb-4">
                <Info size={12} />
                <span>
                  Make sure you have added your products in the{' '}
                  <Link to="/products" className="underline">Products page</Link>
                  {' '}first.
                </span>
              </div>
              <button
                onClick={() => setItemOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                           text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus size={13} /> Add first item
              </button>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-2.5 font-medium text-gray-400 uppercase tracking-wide">Product</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">Qty</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">Unit price (USD)</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">Total (USD)</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">Weight (kg)</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">
                        <div className="flex items-center justify-end gap-1">
                          Unit landed (ETB)
                          <InfoTip text="The total cost per unit including product cost + allocated freight, customs, port, and trucking costs. This is your true cost price and the basis for your selling price. Recalculate after adding all expenses." />
                        </div>
                      </th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">Status</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(() => {
                      // Group by container so a shipment holding several
                      // containers with different items shows which is
                      // which -- only rendered when there's more than one
                      // group, so single-container/manual shipments look
                      // exactly as before.
                      const byContainer = new Map<string, { label: string; rows: ShipmentItem[] }>()
                      for (const item of items) {
                        const key = item.container_id ?? '__none__'
                        const label = item.containers?.container_number ?? 'Ungrouped'
                        if (!byContainer.has(key)) byContainer.set(key, { label, rows: [] })
                        byContainer.get(key)!.rows.push(item)
                      }
                      const groups = [...byContainer.values()].sort((a, b) =>
                        a.label === 'Ungrouped' ? 1 : b.label === 'Ungrouped' ? -1 : a.label.localeCompare(b.label))

                      return groups.map(group => (
                        <Fragment key={group.label}>
                          {groups.length > 1 && (
                            <tr className="bg-gray-100">
                              <td colSpan={8} className="px-4 py-1.5 text-xs font-bold text-gray-600 uppercase tracking-wide">
                                {group.label} ({group.rows.length} item{group.rows.length !== 1 ? 's' : ''})
                              </td>
                            </tr>
                          )}
                          {group.rows.map(item => {
                    const prod     = item.products
                    const totalUsd = item.quantity * item.unit_price_usd
                    return (
                        <tr key={item.id} className="hover:bg-gray-50/50">
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">
                              {prod?.name ?? '-'}
                            </p>
                            <p className="text-xs font-mono text-gray-400 mt-0.5">
                              {prod?.sku ?? '-'}
                            </p>
                          </td>
                          <td className="px-3 py-3 text-right font-mono">
                            {N(item.quantity)}{' '}
                            <span className="text-gray-400 font-normal">
                              {item.unit_of_measure ?? 'PCS'}
                            </span>
                            {item.unit_of_measure === 'CTN' && item.units_per_carton && (
                              <div className="text-xs text-gray-400 mt-0.5">
                                = {N(item.quantity * item.units_per_carton)} pcs
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-gray-600">
                            ${item.unit_price_usd}
                          </td>
                          <td className="px-3 py-3 text-right font-mono font-medium text-blue-700">
                            ${N(totalUsd)}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-gray-500">
                            {item.weight_kg_total ? N(item.weight_kg_total) : '-'}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {item.unit_landed_cost_etb ? (
                              <span className="font-medium font-mono text-green-700">
                                {N(item.unit_landed_cost_etb)} ETB
                              </span>
                            ) : (
                              <span className="text-gray-300 italic">not calculated</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium
                              ${item.cost_status === 'FINAL'
                                ? 'bg-green-50 text-green-700'
                                : 'bg-amber-50 text-amber-700'}`}>
                              {item.cost_status === 'FINAL' ? 'Final' : 'Provisional'}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2 justify-end">
                              <button
                                onClick={() => { setShortageTarget({ itemId: item.id, productId: item.product_id, name: prod?.name ?? 'this item' }); setShortageError(null) }}
                                title="Flag a shortage against this supplier"
                                className="text-gray-300 hover:text-amber-500 transition-colors"
                              >
                                <AlertOctagon size={13} />
                              </button>
                              <button
                                onClick={() => deleteItem(item.id, prod?.name ?? 'this item')}
                                className="text-gray-300 hover:text-red-500 transition-colors"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                    )
                          })}
                        </Fragment>
                      ))
                    })()}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t border-gray-100 font-medium">
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {items.length} products
                      </td>
                      <td className="px-3 py-3 text-right font-mono">
                        {N(items.reduce((s, i) => s + i.quantity, 0))}
                      </td>
                      <td></td>
                      <td className="px-3 py-3 text-right font-mono text-blue-700">
                        ${N(totalFobUsd)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-gray-500">
                        {N(items.reduce((s, i) => s + (i.weight_kg_total ?? 0), 0))} kg
                      </td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Recalculate prompt */}
              {items.length > 0 && expenses.length > 0 &&
               items.some(i => !i.unit_landed_cost_etb) && (
                <div className="px-4 py-3 bg-amber-50 border-t border-amber-100
                                flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-amber-700">
                    <Info size={13} />
                    <span>
                      You have {expenses.length} expense{expenses.length !== 1 ? 's' : ''} but
                      unit landed costs haven't been calculated yet.
                    </span>
                  </div>
                  <button
                    onClick={recalculate}
                    disabled={recalcing}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5
                               bg-amber-600 text-white rounded-lg hover:bg-amber-700
                               disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw size={12} className={recalcing ? 'animate-spin' : ''} />
                    Calculate now
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* EXPENSES TAB */}
      {activeTab === 'expenses' && (
        <div>
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Shipment expenses</p>
                <InfoTip text="Record every cost attached to this shipment here. This includes: ocean freight, Djibouti port handling, trucking to Addis, Ethiopian customs duty, VAT, surtax, withholding tax, and clearing agent fees. These costs are allocated across your products to calculate the true unit landed cost. Add ALL costs before finalizing." />
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Total: <span className="font-medium text-gray-700">{N(nonCustomsExpEtb)} ETB</span>
                {nonCustomsExpenses.some(e => e.cost_status === 'PROVISIONAL') && (
                  <span className="text-amber-600 ml-1">(some provisional)</span>
                )}
                <span className="ml-1">· customs tracked separately in the Customs tab</span>
              </p>
            </div>
            <button
              onClick={() => { setEditExpId(null); setError(null); setExpOpen(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                         text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={13} /> Add expense
            </button>
          </div>

          {/* Info guide */}
          <div className="flex items-start gap-2 px-4 py-3 bg-blue-50 border
                          border-blue-100 rounded-xl text-xs text-blue-800 mb-4">
            <Info size={14} className="shrink-0 mt-0.5 text-blue-500" />
            <div>
              <p className="font-medium mb-1">How expenses work</p>
              <p className="text-blue-700 leading-relaxed">
                Add each cost as you receive the invoices. Estimates (Provisional) are
                fine to start - you can update them when final invoices arrive.
                ETB amounts are calculated automatically using today's customs rate ({fxRate} ETB/USD).
                After adding all expenses, click <strong>Recalculate</strong> to update unit landed costs.
                When all invoices are confirmed, use <strong>Finalize costs</strong> to lock permanently.
              </p>
            </div>
          </div>

          {nonCustomsExpenses.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
              <Receipt size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">No expenses yet</p>
              <p className="text-xs text-gray-400 mb-4 max-w-sm mx-auto">
                Start by adding the ocean freight invoice. Then add Djibouti port and
                trucking costs as you receive them — customs has its own tab.
              </p>
              <button
                onClick={() => setExpOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                           text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus size={13} /> Add first expense
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(CAT_LABELS).filter(([cat]) => cat !== 'ETHIOPIA_CUSTOMS').map(([cat, catLabel]) => {
                const catExps = expenses.filter(e => e.category === cat)
                if (!catExps.length) return null
                const catTotal = catExps.reduce((s, e) => s + (e.amount_etb ?? 0), 0)
                return (
                  <div key={cat}
                       className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5
                                    bg-gray-50 border-b border-gray-100">
                      <span className="text-xs font-medium text-gray-600">{catLabel}</span>
                      <span className="text-xs font-mono font-medium text-gray-700">
                        {N(catTotal)} ETB
                      </span>
                    </div>
                    {catExps.map((exp, i) => (
                      <div
                        key={exp.id}
                        className={`flex items-start gap-3 px-4 py-3
                          ${i < catExps.length - 1 ? 'border-b border-gray-50' : ''}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-medium text-gray-800 truncate">
                              {exp.description}
                            </p>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full
                                              font-medium shrink-0
                              ${exp.cost_status === 'FINAL'
                                ? 'bg-green-50 text-green-700'
                                : 'bg-amber-50 text-amber-700'}`}>
                              {exp.cost_status === 'FINAL' ? 'Final' : 'Estimated'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 flex-wrap text-xs">
                            <span className="font-mono font-medium text-gray-700">
                              {N(exp.amount_etb ?? 0)} ETB
                            </span>
                            {exp.currency !== 'ETB' && (
                              <span className="text-gray-400">
                                ({exp.amount} {exp.currency}
                                {exp.exchange_rate ? ` @ ${exp.exchange_rate}` : ''})
                              </span>
                            )}
                            {exp.vendor_name && (
                              <span className="text-gray-400">{exp.vendor_name}</span>
                            )}
                            <span className="text-gray-400">{exp.expense_date}</span>
                            {exp.receipt_ref && (
                              <span className="font-mono text-gray-400">{exp.receipt_ref}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => openEditExp(exp)}
                            className="text-xs px-2 py-1 border border-gray-200
                                       rounded-lg hover:bg-gray-50 transition-colors text-gray-500"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteExpense(exp.id, exp.description)}
                            className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}

              <div className="flex items-center justify-between px-4 py-3
                              bg-white border border-gray-200 rounded-xl font-medium">
                <span className="text-sm text-gray-600">Total (excl. customs)</span>
                <span className="text-base font-mono text-gray-900">{N(nonCustomsExpEtb)} ETB</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CUSTOMS TAB */}
      {activeTab === 'customs' && (
        <CustomsTab
          shipmentId={id!}
          shipmentItems={items.map(i => ({
            id: i.id,
            product_name: i.products?.name ?? '—',
            quantity: i.quantity,
            unit_price_usd: i.unit_price_usd,
          }))}
          fxRate={fxRate}
          freightUsd={freightUsd}
          insuranceUsd={insuranceUsd}
          customsExpenses={customsExpenses}
          onSaved={load}
          onEdit={expId => {
            const exp = expenses.find(e => e.id === expId)
            if (exp) openEditExp(exp)
          }}
          onDelete={deleteExpense}
        />
      )}

      {/*  COST BREAKDOWN TAB */}
      {activeTab === 'costs' && (
        <div>
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Landed cost allocation</p>
                <InfoTip text="This shows how the total overhead (all expenses) is split across products. The allocation method determines the split: By Quantity divides equally per unit, By Weight splits proportionally by kg, By Value splits by USD value. The unit landed cost is what you must cover per unit before making any profit." />
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Method: <strong>{shipment.allocation_method}</strong> ·
                Rate: <strong>{fxRate} ETB/USD</strong>
              </p>
            </div>
            <button
              onClick={recalculate}
              disabled={recalcing || items.length === 0 || expenses.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600
                         text-white text-xs rounded-lg hover:bg-blue-700
                         disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={12} className={recalcing ? 'animate-spin' : ''} />
              {recalcing ? 'Calculating…' : 'Calculate now'}
            </button>
          </div>

          {/* Step-by-step guide */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-4">
            <div className="flex items-center gap-2 text-xs text-blue-800 font-medium mb-2">
              <Info size={13} />
              How to use the cost engine - step by step
            </div>
            <ol className="text-xs text-blue-700 space-y-1.5 ml-4 list-decimal leading-relaxed">
              <li>Add all products from your PI in the <strong>PI Items</strong> tab.</li>
              <li>Add all costs (freight, customs, port, trucking) in the <strong>Expenses</strong> tab.</li>
              <li>Make sure the exchange rate above matches the NBE customs rate for your shipment date.</li>
              <li>Click <strong>Calculate now</strong> - the system allocates overhead proportionally and shows the unit landed cost per product.</li>
              <li>When all final invoices arrive and you've updated any estimated amounts, click <strong>Finalize costs</strong> to lock permanently.</li>
            </ol>
          </div>

          {items.length === 0 || expenses.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
              <Calculator size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-2">
                Not ready to calculate
              </p>
              <p className="text-xs text-gray-400 max-w-xs mx-auto">
                {items.length === 0 && 'Add PI items first. '}
                {expenses.length === 0 && 'Add at least one expense. '}
                Then click Calculate now.
              </p>
              <div className="flex items-center justify-center gap-3 mt-4">
                {items.length === 0 && (
                  <button
                    onClick={() => setActiveTab('items')}
                    className="text-xs px-3 py-1.5 bg-blue-600 text-white
                               rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    → Add items
                  </button>
                )}
                {expenses.length === 0 && (
                  <button
                    onClick={() => setActiveTab('expenses')}
                    className="text-xs px-3 py-1.5 bg-blue-600 text-white
                               rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    → Add expenses
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-2.5 font-medium text-gray-400 uppercase tracking-wide">Product</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">Qty</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">
                        <div className="flex items-center justify-end gap-1">
                          Product cost/unit
                          <InfoTip text="Unit price in USD converted to ETB at the customs rate. This is the factory cost before any Ethiopia-side expenses." />
                        </div>
                      </th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">
                        <div className="flex items-center justify-end gap-1">
                          Overhead/unit
                          <InfoTip text="Your share of freight, customs, port, and trucking costs allocated to each unit of this product. Calculated proportionally based on your chosen allocation method." />
                        </div>
                      </th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">
                        <div className="flex items-center justify-end gap-1">
                          Unit landed cost
                          <InfoTip text="Product cost + overhead per unit. This is your true cost floor - you must sell above this to make profit. Suggested selling price = Unit landed cost ÷ (1 − target margin). E.g. for 30% margin: landed ÷ 0.70." />
                        </div>
                      </th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {items.map(item => {
                      const prod        = item.products
                      const productCost = Math.round(item.unit_price_usd * fxRate)
                      const overhead    = item.unit_landed_cost_etb
                        ? item.unit_landed_cost_etb - productCost
                        : null
                      return (
                        <tr key={item.id} className="hover:bg-gray-50/50">
                          <td className="px-4 py-3">
                            <p className="font-medium">{prod?.name ?? '-'}</p>
                            <p className="text-xs font-mono text-gray-400 mt-0.5">
                              {prod?.sku ?? '-'}
                            </p>
                          </td>
                          <td className="px-3 py-3 text-right font-mono">
                            {N(item.quantity)}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-gray-600">
                            {N(productCost)} ETB
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-amber-700">
                            {overhead !== null ? `${N(overhead)} ETB` : '-'}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {item.unit_landed_cost_etb ? (
                              <span className="font-medium font-mono text-green-700 text-sm">
                                {N(item.unit_landed_cost_etb)} ETB
                              </span>
                            ) : (
                              <span className="text-gray-300 italic">run calculation</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className={`inline-flex px-2 py-0.5 rounded-full
                                              text-xs font-medium
                              ${item.cost_status === 'FINAL'
                                ? 'bg-green-50 text-green-700'
                                : 'bg-amber-50 text-amber-700'}`}>
                              {item.cost_status === 'FINAL' ? 'Final' : 'Provisional'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t border-gray-100 font-medium text-sm">
                      <td className="px-4 py-3 text-xs text-gray-500">Total overhead</td>
                      <td colSpan={2}></td>
                      <td className="px-3 py-3 text-right font-mono text-amber-700">
                        {N(totalExpEtb)} ETB
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Finalize CTA */}
              {items.some(i => i.unit_landed_cost_etb) &&
               items.some(i => i.cost_status === 'PROVISIONAL') && (
                <div className="px-4 py-3 bg-green-50 border-t border-green-100
                                flex items-center justify-between">
                  <div className="flex items-start gap-2 text-xs text-green-800">
                    <Info size={13} className="mt-0.5 shrink-0" />
                    <span>
                      Costs calculated. When all expense invoices are confirmed and
                      final, click Finalize to lock these costs permanently.
                    </span>
                  </div>
                  <Link
                    to={`/shipments/${id}/finalize`}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 shrink-0
                               bg-green-700 text-white rounded-lg hover:bg-green-800
                               transition-colors ml-3"
                  >
                    <Lock size={12} /> Finalize costs
                  </Link>
                  <Link
  to={`/shipments/${id}/documents`}
  className="flex items-center gap-1.5 text-xs px-3 py-1.5 border
             border-gray-200 bg-white text-gray-600 rounded-lg
             hover:bg-gray-50 transition-colors"
>
  <FileText size={12} /> Documents
</Link>
                </div>
              )}
            </div>
          )}
        </div>
      )}


      {activeTab === 'timeline' && (
  <ContainerTimelineTabs
    shipmentId={id!}
    fxRate={fxRate}
    containerVolumeM3={items.reduce((s, i) => s + (i.volume_m3_total ?? 0), 0)}
    djiboutiReceivedAt={shipment?.djibouti_received_at}
  />
)}

{activeTab === 'margin' && (
  <MarginAnalysis
    items={items.map(i => ({
      product_name:          i.products?.name ?? '-',
      sku:                   i.products?.sku  ?? i.product_id,
      quantity:              i.quantity,
      unit_landed_cost_etb:  i.unit_landed_cost_etb,
      unit_price_usd:        i.unit_price_usd,
    }))}
    fxRate={fxRate}
  />
)}

      {activeTab === 'documents' && id && (
        <ShipmentAttachments shipmentId={id} />
      )}

      {/* MODALS */}

      {/* Add PI Item modal */}
      {itemOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setItemOpen(false)}
        >
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh]
                          overflow-auto shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-sm font-medium">Add PI line item</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Enter details exactly as on your Proforma Invoice
                </p>
              </div>
              <button onClick={() => setItemOpen(false)}
                      className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">

              <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50
                              border border-blue-100 rounded-lg text-xs text-blue-700">
                <Info size={12} className="shrink-0 mt-0.5" />
                <span>
                  One row per product, exactly as it appears on your PI.
                  If a product isn't listed,{' '}
                  <Link to="/products" className="underline" onClick={() => setItemOpen(false)}>
                    add it to the Products catalog
                  </Link>
                  {' '}first.
                </span>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Product <span className="text-red-400">*</span>
                </label>
                {products.length === 0 ? (
                  <div className="px-3 py-2 bg-amber-50 border border-amber-200
                                  rounded-lg text-xs text-amber-700">
                    No products found.{' '}
                    <Link to="/products" className="underline font-medium"
                          onClick={() => setItemOpen(false)}>
                      Add products first →
                    </Link>
                  </div>
                ) : (
                  <SearchableSelect
                    options={products.map(p => ({ id: p.id, label: p.name, sublabel: p.sku }))}
                    value={itemForm.product_id}
                    onChange={id => setIF('product_id', id)}
                    placeholder="- select product -"
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
  <div>
    <div className="flex items-center gap-1 mb-1">
      <label className="text-xs text-gray-500">
        Quantity <span className="text-red-400">*</span>
      </label>
      <InfoTip text="Total number of units in this shipment for this product. Must match the PI exactly." />
    </div>
    <input
      type="number" min="1"
      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                 focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
      value={itemForm.quantity}
      onChange={e => setIF('quantity', e.target.value)}
      placeholder="e.g. 300"
    />
  </div>
  <div>
    <div className="flex items-center gap-1 mb-1">
      <label className="text-xs text-gray-500">
        Unit <span className="text-red-400">*</span>
      </label>
      <InfoTip text="The unit the quantity refers to. PCS = individual pieces. CTN = cartons (boxes). SET = matched sets. This flows through to the Packing List automatically." />
    </div>
    <select
      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
      value={itemForm.unit_of_measure}
      onChange={e => setIF('unit_of_measure', e.target.value)}
    >
      <option value="PCS">PCS - Pieces</option>
      <option value="CTN">CTN - Cartons</option>
      <option value="SET">SET - Sets</option>
      <option value="PAIR">PAIR - Pairs</option>
      <option value="BOX">BOX - Boxes</option>
      <option value="KG">KG - Kilograms</option>
      <option value="DZN">DZN - Dozens</option>
    </select>
  </div>
</div>

<div className="grid grid-cols-2 gap-3">
  <div>
    <div className="flex items-center gap-1 mb-1">
      <label className="text-xs text-gray-500">
        Unit price USD <span className="text-red-400">*</span>
      </label>
      <InfoTip text="Price per unit (per the Unit selected above) in USD as shown on the PI. If Unit is CTN, this is price per carton, not per piece." />
    </div>
    <input
      type="number" step="0.01" min="0"
      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                 focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
      value={itemForm.unit_price_usd}
      onChange={e => setIF('unit_price_usd', e.target.value)}
      placeholder="e.g. 85.00"
    />
  </div>
  {itemForm.unit_of_measure === 'CTN' && (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <label className="text-xs text-gray-500">Pieces per carton</label>
        <InfoTip text="If your unit is CTN (cartons), enter how many individual pieces are in each carton. This is used to calculate total piece count for the Packing List." />
      </div>
      <input
        type="number" min="1"
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                   focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
        value={(itemForm as any).pieces_per_carton ?? ''}
        onChange={e => setIF('pieces_per_carton' as any, e.target.value)}
        placeholder="e.g. 2"
      />
    </div>
  )}
</div>

              {/* Live total */}
              {itemForm.quantity && itemForm.unit_price_usd && (
                <div className="flex items-center justify-between px-3 py-2
                                bg-blue-50 rounded-lg">
                  <span className="text-xs text-blue-700">Total PI value</span>
                  <span className="text-sm font-medium font-mono text-blue-700">
                    ${N(parseFloat(itemForm.quantity) * parseFloat(itemForm.unit_price_usd))} USD
                  </span>
                </div>
              )}

              <div>
                <div className="flex items-center gap-1 mb-2">
                  <p className="text-xs text-gray-500">
                    Weight & volume
                  </p>
                  <InfoTip text="Enter total weight and volume for all units of this product combined. If left blank, the system will calculate from the per-unit values in the product catalog. These are used for By Weight and By Volume cost allocation methods." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Total weight (kg)
                    </label>
                    <input
                      type="number" step="0.01"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                                 focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                      value={itemForm.weight_kg_total}
                      onChange={e => setIF('weight_kg_total', e.target.value)}
                      placeholder="auto-calculated if blank"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Total volume (m³)
                    </label>
                    <input
                      type="number" step="0.001"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                                 focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                      value={itemForm.volume_m3_total}
                      onChange={e => setIF('volume_m3_total', e.target.value)}
                      placeholder="auto-calculated if blank"
                    />
                  </div>
                </div>
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
              <button onClick={() => setItemOpen(false)}
                      className="px-4 py-2 text-xs text-gray-600 border border-gray-200
                                 rounded-lg hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button
                onClick={saveItem}
                disabled={saving || products.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white
                           text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50
                           transition-colors min-w-[120px] justify-center"
              >
                {saving
                  ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                  : <><Check size={12} /> Add to shipment</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Expense modal */}
      {expOpen && (
        <ExpenseForm
          shipmentId={id!}
          fxRate={fxRate}
          editExpense={editExpId ? expenses.find(e => e.id === editExpId) : undefined}
          onSave={() => {
            setExpOpen(false)
            setEditExpId(null)
            load()
          }}
          onClose={() => {
            setExpOpen(false)
            setEditExpId(null)
          }}
        />
      )}
      <ConfirmDialog
        open={state.open}
        title={state.title}
        message={state.message}
        danger={state.danger}
        onConfirm={state.onConfirm}
        onClose={close}
      />
      {showDeleteModal && shipment && (
        <DeleteShipmentModal
          shipmentId={shipment.id}
          shipmentNumber={shipment.shipment_number}
          status={shipment.status}
          onCancel={() => setShowDeleteModal(false)}
          onDeleted={() => navigate('/shipments')}
        />
      )}
      {shortageTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setShortageTarget(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-medium">Flag shortage — {shortageTarget.name}</h2>
              <button onClick={() => setShortageTarget(null)} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-gray-400">
                Noted against {shipment?.suppliers?.name ?? 'this supplier'} — shows as a reminder when you start their next order.
              </p>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Quantity short (optional)</label>
                <input type="number" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={shortageForm.quantity_short} onChange={e => setShortageForm(p => ({ ...p, quantity_short: e.target.value }))} placeholder="e.g. 15" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <textarea rows={2} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                  value={shortageForm.notes} onChange={e => setShortageForm(p => ({ ...p, notes: e.target.value }))} placeholder="What was missing or short?" />
              </div>
              {shortageError && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{shortageError}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setShortageTarget(null)} className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={saveShortageNote} disabled={savingShortage}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 text-white text-xs rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors min-w-[90px] justify-center">
                {savingShortage ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Flag it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
