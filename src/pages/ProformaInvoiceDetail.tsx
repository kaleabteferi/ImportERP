// src/pages/ProformaInvoiceDetail.tsx
import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ArrowLeft, Plus, Loader2, X, Check, Package, Boxes, Pencil, Wand2 } from 'lucide-react'
import {
  getProformaInvoice, listPiItems, addPiItem, updatePiItem, deletePiItem, fetchLastPiItemForProduct,
} from '../api/proformaInvoices'
import type { ProformaInvoice, PiItem } from '../api/proformaInvoices'
import { listContainers, createContainer, getAllocatedQuantities, getOrCreatePackingList, addPackingListItem } from '../api/containers'
import type { Container } from '../api/containers'
import { PackingListBuilder } from '../components/containers/PackingListBuilder'
import { GenerateShipmentButton } from '../components/containers/GenerateShipmentButton'
import { ContainerFillGauge } from '../components/containers/ContainerFillGauge'
import { containerCapacityM3, containerPayloadKg } from '../lib/containerSpecs'
import { suggestPackingLayout, estimateNewContainersNeeded, singleCartonExceedsContainer } from '../lib/packingSuggestion'

interface Product { id: string; name: string; sku: string; default_customs_value: number | null }

const N = (n: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 2 }).format(n)

const EMPTY_ITEM = {
  product_id: '', item_description: '', hs_code: '', country_of_origin: 'China',
  quantity: '', unit_of_measure: 'PCS', unit_price: '',
  customs_value: '', duty_rate_pct: '', vat_rate_pct: '15', surtax_rate_pct: '10', excise_rate_pct: '0',
}

const EMPTY_CONTAINER = { container_number: '', container_type: '40HC', vessel_name: '', eta_djibouti: '' }

type Tab = 'items' | 'containers'

export function ProformaInvoiceDetail() {
  const { id } = useParams<{ id: string }>()
  const [pi, setPi] = useState<(ProformaInvoice & { suppliers: { name: string } | null; buyer_company: { name: string } | null; final_company: { name: string } | null }) | null>(null)
  const [items, setItems] = useState<PiItem[]>([])
  // PostgREST embeds packing_lists as a single object here (not an array) --
  // it detects the UNIQUE constraint on packing_lists.container_id and
  // infers a to-one relationship, unlike a normal one-to-many child embed.
  const [containers, setContainers] = useState<(Container & { packing_lists: { id: string } | null; shipments: { shipment_number: string } | null })[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('items')
  const [error, setError] = useState<string | null>(null)

  const [itemOpen, setItemOpen] = useState(false)
  const [itemForm, setItemForm] = useState({ ...EMPTY_ITEM })
  const [savingItem, setSavingItem] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)

  const [containerOpen, setContainerOpen] = useState(false)
  const [containerForm, setContainerForm] = useState({ ...EMPTY_CONTAINER })
  const [savingContainer, setSavingContainer] = useState(false)
  const [expandedContainer, setExpandedContainer] = useState<string | null>(null)
  const [containerVolumes, setContainerVolumes] = useState<Record<string, number>>({})
  const [containerWeights, setContainerWeights] = useState<Record<string, number>>({})
  const [suggesting, setSuggesting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [piData, itemsData, containersData, prodRes, plItemsRes] = await Promise.all([
        getProformaInvoice(id),
        listPiItems(id),
        listContainers(id),
        supabase.from('products').select('id, name, sku, default_customs_value').eq('is_active', true).order('name'),
        // packing_lists.total_volume_m3 is a cached summary column nothing in
        // the app ever writes to -- sum straight from pl_items.total_volume_m3
        // (a real generated column) instead of trusting that stale cache.
        // Falls back to the product's own per-unit volume x units packed when
        // a line has no carton dimensions entered yet, so fill % shows a real
        // estimate immediately for any product that already has a volume set
        // on the Products page, rather than reading 0 until someone measures
        // every carton by hand.
        supabase.from('pl_items')
          .select('total_volume_m3, total_units, carton_qty, gross_weight_per_ctn, pi_items(products(volume_m3, weight_kg)), packing_lists!inner(pi_id, container_id)')
          .eq('packing_lists.pi_id', id),
      ])
      setPi(piData as any)
      setItems(itemsData as any)
      setContainers(containersData as any)
      setProducts(prodRes.data ?? [])
      const volumes: Record<string, number> = {}
      const weights: Record<string, number> = {}
      for (const row of (plItemsRes.data ?? []) as any[]) {
        const containerId = row.packing_lists?.container_id
        if (!containerId) continue
        const dimensionVolume = Number(row.total_volume_m3 ?? 0)
        const productVolumePerUnit = row.pi_items?.products?.volume_m3
        const effectiveVolume = dimensionVolume > 0
          ? dimensionVolume
          : (productVolumePerUnit ? Number(productVolumePerUnit) * Number(row.total_units ?? 0) : 0)
        volumes[containerId] = (volumes[containerId] ?? 0) + effectiveVolume

        // Same "real figure if entered, else the product's own per-unit
        // weight x units packed" fallback as volume above.
        const realWeight = row.gross_weight_per_ctn ? Number(row.gross_weight_per_ctn) * Number(row.carton_qty ?? 0) : 0
        const productWeightPerUnit = row.pi_items?.products?.weight_kg
        const effectiveWeight = realWeight > 0
          ? realWeight
          : (productWeightPerUnit ? Number(productWeightPerUnit) * Number(row.total_units ?? 0) : 0)
        weights[containerId] = (weights[containerId] ?? 0) + effectiveWeight
      }
      setContainerVolumes(volumes)
      setContainerWeights(weights)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  function openAddItem() {
    setItemForm({ ...EMPTY_ITEM })
    setEditingItemId(null)
    setError(null)
    setItemOpen(true)
  }

  function openEditItem(it: PiItem) {
    setItemForm({
      product_id: it.product_id ?? '',
      item_description: it.item_description,
      hs_code: it.hs_code,
      country_of_origin: it.country_of_origin,
      quantity: String(it.quantity),
      unit_of_measure: it.unit_of_measure,
      unit_price: String(it.unit_price),
      customs_value: it.customs_value != null ? String(it.customs_value) : '',
      duty_rate_pct: it.duty_rate_pct != null ? String(it.duty_rate_pct) : '',
      vat_rate_pct: it.vat_rate_pct != null ? String(it.vat_rate_pct) : '15',
      surtax_rate_pct: it.surtax_rate_pct != null ? String(it.surtax_rate_pct) : '10',
      excise_rate_pct: it.excise_rate_pct != null ? String(it.excise_rate_pct) : '0',
    })
    setEditingItemId(it.id)
    setError(null)
    setItemOpen(true)
  }

  async function saveItem() {
    if (!id) return
    if (!itemForm.item_description || !itemForm.hs_code || !itemForm.quantity || !itemForm.unit_price) {
      setError('Description, HS code, quantity, and unit price are required'); return
    }
    setSavingItem(true)
    setError(null)
    const payload = {
      product_id: itemForm.product_id || null,
      item_description: itemForm.item_description,
      hs_code: itemForm.hs_code,
      country_of_origin: itemForm.country_of_origin,
      quantity: parseFloat(itemForm.quantity),
      unit_of_measure: itemForm.unit_of_measure,
      unit_price: parseFloat(itemForm.unit_price),
      customs_value: itemForm.customs_value ? parseFloat(itemForm.customs_value) : null,
      duty_rate_pct: itemForm.duty_rate_pct ? parseFloat(itemForm.duty_rate_pct) : null,
      vat_rate_pct: parseFloat(itemForm.vat_rate_pct || '15'),
      surtax_rate_pct: parseFloat(itemForm.surtax_rate_pct || '10'),
      excise_rate_pct: parseFloat(itemForm.excise_rate_pct || '0'),
    }
    try {
      if (editingItemId) {
        await updatePiItem(editingItemId, payload)
      } else {
        await addPiItem(id, payload)
      }
      setItemOpen(false)
      setItemForm({ ...EMPTY_ITEM })
      setEditingItemId(null)
      await load()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
    setSavingItem(false)
  }

  async function removeItem(itemId: string) {
    try {
      await deletePiItem(itemId)
      await load()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
  }

  async function saveContainer() {
    if (!id) return
    if (!containerForm.container_number) { setError('Container number is required'); return }
    setSavingContainer(true)
    setError(null)
    try {
      const newId = await createContainer(id, {
        container_number: containerForm.container_number,
        container_type: containerForm.container_type,
        vessel_name: containerForm.vessel_name || null,
        eta_djibouti: containerForm.eta_djibouti || null,
      })
      setContainerOpen(false)
      setContainerForm({ ...EMPTY_CONTAINER })
      await load()
      setExpandedContainer(newId)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
    setSavingContainer(false)
  }

  // Bin-packs each line item's remaining (unallocated) cartons across all of
  // this PI's containers -- a starting layout, not a final one. Only ever
  // adds new pl_items for whatever's still unallocated; it never touches a
  // line someone already packed by hand.
  //
  // If the existing containers don't have room for everything, this doesn't
  // just report "some of it didn't fit" -- it creates as many additional
  // 40HC containers as the shortfall requires (a placeholder number,
  // "PENDING-N", since the real container number isn't known until it's
  // booked) and re-packs against the larger set, so every remaining unit
  // really does end up in a container. Only gives up on an item whose own
  // single carton is bigger than an entirely empty container -- no amount
  // of extra containers fixes that; it's a data problem to go check.
  async function suggestLayout() {
    if (!pi) return
    setSuggesting(true)
    setError(null)
    setNotice(null)
    try {
      const allocated = await getAllocatedQuantities(pi.id)
      const suggestionItems = items.map(it => {
        const remainingUnits = Number(it.quantity) - (allocated[it.id] ?? 0)
        const p = (it as any).products
        const unitsPerCarton = p?.default_units_per_carton ? Number(p.default_units_per_carton) : null
        const cartonVolumeM3 = (p?.carton_length_cm && p?.carton_width_cm && p?.carton_height_cm)
          ? (Number(p.carton_length_cm) * Number(p.carton_width_cm) * Number(p.carton_height_cm)) / 1_000_000
          : (p?.volume_m3 && unitsPerCarton ? Number(p.volume_m3) * unitsPerCarton : null)
        const cartonWeightKg = (p?.weight_kg && unitsPerCarton) ? Number(p.weight_kg) * unitsPerCarton : null
        return { piItemId: it.id, remainingUnits, unitsPerCarton, cartonVolumeM3, cartonWeightKg }
      })

      let workingContainers = containers.map(c => ({
        containerId: c.id,
        capacityM3: containerCapacityM3(c.container_type),
        payloadKg: containerPayloadKg(c.container_type),
        usedM3: containerVolumes[c.id] ?? 0,
        usedKg: containerWeights[c.id] ?? 0,
      }))

      const NEW_CONTAINER_TYPE = '40HC'
      const freshCapacityM3 = containerCapacityM3(NEW_CONTAINER_TYPE)
      const freshPayloadKg = containerPayloadKg(NEW_CONTAINER_TYPE)

      let result = suggestPackingLayout(suggestionItems, workingContainers)
      const createdContainerNumbers: string[] = []

      // Top up with fresh containers until nothing's left unplaced, capped
      // so a genuinely-impossible item (bigger than an empty container)
      // can't spin this into an endless container-creation loop.
      for (let attempt = 0; attempt < 5 && result.unplaced.length > 0; attempt++) {
        if (singleCartonExceedsContainer(result.unplaced, suggestionItems, freshCapacityM3, freshPayloadKg)) break

        const needed = estimateNewContainersNeeded(result.unplaced, suggestionItems, freshCapacityM3, freshPayloadKg)
        const { data: pending } = await supabase.from('containers').select('container_number').like('container_number', 'PENDING-%')
        let maxN = (pending ?? []).reduce((max: number, r: any) => {
          const n = parseInt(String(r.container_number).slice('PENDING-'.length), 10)
          return Number.isFinite(n) && n > max ? n : max
        }, 0)

        const freshContainers = []
        for (let i = 0; i < needed; i++) {
          maxN += 1
          const containerNumber = `PENDING-${maxN}`
          const newId = await createContainer(pi.id, { container_number: containerNumber, container_type: NEW_CONTAINER_TYPE })
          createdContainerNumbers.push(containerNumber)
          freshContainers.push({ containerId: newId, capacityM3: freshCapacityM3, payloadKg: freshPayloadKg, usedM3: 0, usedKg: 0 })
        }
        workingContainers = [...workingContainers, ...freshContainers]
        result = suggestPackingLayout(suggestionItems, workingContainers)
      }

      if (result.assignments.length === 0 && createdContainerNumbers.length === 0) {
        setNotice(result.skipped.length > 0
          ? `Nothing to suggest — every remaining item is missing ${result.skipped[0].reason}. Set it on the Products page and try again.`
          : 'Nothing to suggest — every line item is already fully allocated to a container.')
        setSuggesting(false)
        return
      }

      const plIdByContainer = new Map<string, string>()
      for (const containerId of new Set(result.assignments.map(a => a.containerId))) {
        plIdByContainer.set(containerId, await getOrCreatePackingList(containerId, pi.id))
      }
      for (const a of result.assignments) {
        const piItem = items.find(x => x.id === a.piItemId)
        if (!piItem) continue
        const p = (piItem as any).products
        await addPackingListItem(plIdByContainer.get(a.containerId)!, {
          pi_item_id: a.piItemId,
          carton_qty: a.cartonQty,
          units_per_carton: a.unitsPerCarton,
          unit_price_foreign: piItem.unit_price,
          // Carries the product's real carton dims onto the line whenever
          // they're the reason the suggestion could size this item at all,
          // so total_volume_m3 reads as a real measurement, not "no size"
          // (the per-unit volume_m3 fallback path has no dims to carry).
          length_cm: p?.carton_length_cm ? Number(p.carton_length_cm) : null,
          width_cm: p?.carton_width_cm ? Number(p.carton_width_cm) : null,
          height_cm: p?.carton_height_cm ? Number(p.carton_height_cm) : null,
        })
      }

      const notes: string[] = []
      if (createdContainerNumbers.length > 0) {
        notes.push(`Created ${createdContainerNumbers.length} new container(s) (${createdContainerNumbers.join(', ')}) to fit everything — rename them to the real container number once booked.`)
      }
      if (result.unplaced.length > 0) {
        notes.push(`${result.unplaced.length} item(s) still didn't fit — a single carton is bigger than a full container, so check its carton size on the Products page.`)
      }
      if (result.skipped.length > 0) {
        notes.push(`${result.skipped.length} item(s) skipped — missing carton size or units-per-carton on the Products page.`)
      }
      setNotice(notes.length > 0 ? notes.join(' ') : 'Suggested layout applied — review and adjust each container as needed.')

      await load()
      setRefreshToken(t => t + 1)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
    setSuggesting(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading…</div>
  }
  if (!pi) {
    return <div className="p-5 text-sm text-gray-500">Proforma invoice not found. <Link to="/proforma-invoices" className="text-blue-600 underline">Back to list</Link></div>
  }

  const routed = pi.buyer_company && pi.final_company && pi.buyer_company.name !== pi.final_company.name

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <Link to="/proforma-invoices" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-3 transition-colors">
        <ArrowLeft size={12} /> Proforma invoices
      </Link>

      <div className="mb-5">
        <h1 className="text-lg font-medium">{pi.pi_number}</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          {pi.suppliers?.name ?? '—'} · {pi.incoterm} · {pi.port_of_loading ?? '—'} → {pi.port_of_discharge ?? '—'}
          {routed
            ? <> · routed via {pi.buyer_company?.name} → {pi.final_company?.name}{pi.markup_pct ? ` (+${pi.markup_pct}%)` : ''}</>
            : <> · {pi.final_company?.name ?? 'no company set'}</>}
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <X size={12} className="cursor-pointer" onClick={() => setError(null)} /> {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          <X size={12} className="cursor-pointer" onClick={() => setNotice(null)} /> {notice}
        </div>
      )}

      <div className="flex items-center gap-1.5 mb-5 border-b border-gray-100 pb-3">
        <button onClick={() => setTab('items')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${tab === 'items' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
          <Package size={12} /> Line items ({items.length})
        </button>
        <button onClick={() => setTab('containers')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${tab === 'containers' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
          <Boxes size={12} /> Containers ({containers.length})
        </button>
      </div>

      {tab === 'items' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium">Line items</p>
            <button onClick={openAddItem}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition-colors">
              <Plus size={13} /> Add item
            </button>
          </div>

          {items.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
              <Package size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">No line items yet</p>
              <p className="text-xs text-gray-400 mb-4">Add each product from the supplier's proforma invoice before splitting into containers.</p>
              <button onClick={openAddItem}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition-colors">
                <Plus size={13} /> Add first item
              </button>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-2.5 font-medium text-gray-400 uppercase tracking-wide">Item</th>
                    <th className="text-left px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">HS code</th>
                    <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">Qty</th>
                    <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">Unit price</th>
                    <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">Total</th>
                    <th className="text-right px-3 py-2.5 font-medium text-gray-400 uppercase tracking-wide">CD value</th>
                    <th className="w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map(it => (
                    <tr key={it.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{it.item_description}</p>
                        <p className="text-xs text-gray-400">{(it as any).products?.name ?? 'no product linked'}</p>
                      </td>
                      <td className="px-3 py-3 font-mono text-gray-500">{it.hs_code}</td>
                      <td className="px-3 py-3 text-right font-mono">{N(it.quantity)} {it.unit_of_measure}</td>
                      <td className="px-3 py-3 text-right font-mono text-gray-600">${it.unit_price}</td>
                      <td className="px-3 py-3 text-right font-mono font-medium text-blue-700">${it.total_price != null ? N(it.total_price) : '—'}</td>
                      <td className="px-3 py-3 text-right font-mono text-gray-500">{it.customs_value != null ? `$${N(it.customs_value)}` : '—'}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button onClick={() => openEditItem(it)} className="text-gray-300 hover:text-blue-600 transition-colors"><Pencil size={13} /></button>
                          <button onClick={() => removeItem(it.id)} className="text-gray-300 hover:text-red-500 transition-colors"><X size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'containers' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium">Containers</p>
            <div className="flex items-center gap-2">
              <button onClick={suggestLayout} disabled={suggesting || containers.length === 0 || items.length === 0}
                title={containers.length === 0 ? 'Add a container first' : 'Auto-split remaining items across containers'}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-600 border border-gray-200 text-xs rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">
                {suggesting ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Suggest layout
              </button>
              <GenerateShipmentButton containers={containers} onGenerated={() => load()} />
              <button onClick={() => { setContainerForm({ ...EMPTY_CONTAINER }); setError(null); setContainerOpen(true) }}
                disabled={items.length === 0}
                title={items.length === 0 ? 'Add line items first' : undefined}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">
                <Plus size={13} /> New container
              </button>
            </div>
          </div>

          {containers.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
              <Boxes size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">No containers yet</p>
              <p className="text-xs text-gray-400">Split this order's line items across one or more containers — they'll all share one shipment, each still tracked independently.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {containers.map(c => (
                <div key={c.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 pt-3 cursor-pointer"
                    onClick={() => setExpandedContainer(v => v === c.id ? null : c.id)}>
                    <div>
                      <p className="text-sm font-medium font-mono">{c.container_number}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{c.vessel_name || 'vessel TBD'}{c.eta_djibouti ? ` · ETA ${c.eta_djibouti}` : ''}</p>
                    </div>
                    {c.shipment_id && (
                      <span className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded-lg shrink-0">In shipment</span>
                    )}
                  </div>
                  <div className="px-4 pt-3 pb-1 max-w-md">
                    <ContainerFillGauge containerType={c.container_type} packedM3={containerVolumes[c.id] ?? 0} />
                  </div>
                  {expandedContainer === c.id && (
                    <div className="px-4 pb-4 border-t border-gray-50">
                      <PackingListBuilder piId={pi.id} containerId={c.id} piItems={items} onChanged={load} refreshToken={refreshToken} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add/edit item modal */}
      {itemOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setItemOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-medium">{editingItemId ? 'Edit line item' : 'Add line item'}</h2>
              <button onClick={() => setItemOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Product (optional until packing)</label>
                <select className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  value={itemForm.product_id} onChange={e => {
                    const productId = e.target.value
                    const product = products.find(p => p.id === productId)
                    setItemForm(p => ({
                      ...p,
                      product_id: productId,
                      // Pre-fill from the product's default CD value, only when
                      // the field is still blank -- never overwrites a value
                      // the user already typed for this specific PI line.
                      customs_value: !p.customs_value && product?.default_customs_value != null
                        ? String(product.default_customs_value) : p.customs_value,
                    }))
                    if (!productId) return
                    // Real historical data, not a fabricated HS-code lookup:
                    // the most recent prior PI line for this product tells us
                    // what we actually declared and paid last time. Only fills
                    // fields still blank -- same rule as the CD-value prefill.
                    fetchLastPiItemForProduct(productId).then(last => {
                      if (!last) return
                      setItemForm(p => (p.product_id !== productId ? p : {
                        ...p,
                        hs_code: p.hs_code || last.hs_code,
                        unit_price: p.unit_price || String(last.unit_price),
                        country_of_origin: (!p.country_of_origin || p.country_of_origin === EMPTY_ITEM.country_of_origin) ? last.country_of_origin : p.country_of_origin,
                      }))
                    }).catch(() => {})
                  }}>
                  <option value="">— not linked yet —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Description <span className="text-red-400">*</span></label>
                <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={itemForm.item_description} onChange={e => setItemForm(p => ({ ...p, item_description: e.target.value }))} placeholder="e.g. Plastic chair, stackable" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">HS code <span className="text-red-400">*</span></label>
                  <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={itemForm.hs_code} onChange={e => setItemForm(p => ({ ...p, hs_code: e.target.value }))} placeholder="9401.61" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Country of origin</label>
                  <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={itemForm.country_of_origin} onChange={e => setItemForm(p => ({ ...p, country_of_origin: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Quantity <span className="text-red-400">*</span></label>
                  <input type="number" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={itemForm.quantity} onChange={e => setItemForm(p => ({ ...p, quantity: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Unit</label>
                  <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={itemForm.unit_of_measure} onChange={e => setItemForm(p => ({ ...p, unit_of_measure: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Unit price (USD) <span className="text-red-400">*</span></label>
                  <input type="number" step="0.01" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={itemForm.unit_price} onChange={e => setItemForm(p => ({ ...p, unit_price: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Customs (CD) value — editable, overrides invoice price for duty calc</label>
                <input type="number" step="0.01" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={itemForm.customs_value} onChange={e => setItemForm(p => ({ ...p, customs_value: e.target.value }))} placeholder="Leave blank to use unit price × qty" />
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Duty %</label>
                  <input type="number" step="0.1" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={itemForm.duty_rate_pct} onChange={e => setItemForm(p => ({ ...p, duty_rate_pct: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">VAT %</label>
                  <input type="number" step="0.1" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={itemForm.vat_rate_pct} onChange={e => setItemForm(p => ({ ...p, vat_rate_pct: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Surtax %</label>
                  <input type="number" step="0.1" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={itemForm.surtax_rate_pct} onChange={e => setItemForm(p => ({ ...p, surtax_rate_pct: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Excise %</label>
                  <input type="number" step="0.1" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={itemForm.excise_rate_pct} onChange={e => setItemForm(p => ({ ...p, excise_rate_pct: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setItemOpen(false)} className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={saveItem} disabled={savingItem}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors min-w-[100px] justify-center">
                {savingItem ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : <><Check size={12} /> {editingItemId ? 'Save changes' : 'Add item'}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New container modal */}
      {containerOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setContainerOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-medium">New container</h2>
              <button onClick={() => setContainerOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Container number <span className="text-red-400">*</span></label>
                <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={containerForm.container_number} onChange={e => setContainerForm(p => ({ ...p, container_number: e.target.value }))} placeholder="e.g. CSNU4832156" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Type</label>
                  <select className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    value={containerForm.container_type} onChange={e => setContainerForm(p => ({ ...p, container_type: e.target.value }))}>
                    <option value="20GP">20GP</option>
                    <option value="40GP">40GP</option>
                    <option value="40HC">40HC</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ETA Djibouti</label>
                  <input type="date" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={containerForm.eta_djibouti} onChange={e => setContainerForm(p => ({ ...p, eta_djibouti: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Vessel name</label>
                <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={containerForm.vessel_name} onChange={e => setContainerForm(p => ({ ...p, vessel_name: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setContainerOpen(false)} className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={saveContainer} disabled={savingContainer}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors min-w-[100px] justify-center">
                {savingContainer ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : <><Check size={12} /> Create</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
