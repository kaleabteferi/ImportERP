// src/pages/ProformaInvoiceDetail.tsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ArrowLeft, Plus, Loader2, X, Check, Package, Boxes, Pencil, Wand2, CircleDollarSign, Scale, Ship, Route, CalendarDays } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Modal } from '../components/ui/Modal'
import { SelectMenu } from '../components/ui/SelectMenu'
import {
  getProformaInvoice, listPiItems, addPiItem, updatePiItem, deletePiItem, fetchLastPiItemForProduct,
} from '../api/proformaInvoices'
import type { ProformaInvoice, PiItem } from '../api/proformaInvoices'
import { listContainers, createContainer, updateContainer, getAllocatedQuantities, getOrCreatePackingList, addPackingListItem } from '../api/containers'
import type { Container } from '../api/containers'
import { PackingListBuilder } from '../components/containers/PackingListBuilder'
import { GenerateShipmentButton } from '../components/containers/GenerateShipmentButton'
import { ContainerFillGauge } from '../components/containers/ContainerFillGauge'
import { containerCapacityM3, containerPayloadKg } from '../lib/containerSpecs'
import { estimateNewContainersNeeded, suggestPackingLayout, pickContainerTypeForDeficit, singleCartonExceedsContainer } from '../lib/packingSuggestion'
import './ProformaInvoices.css'

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
  const [editingContainerId, setEditingContainerId] = useState<string | null>(null)
  const [expandedContainer, setExpandedContainer] = useState<string | null>(null)
  const [containerVolumes, setContainerVolumes] = useState<Record<string, number>>({})
  const [containerWeights, setContainerWeights] = useState<Record<string, number>>({})
  const [allocatedUnits, setAllocatedUnits] = useState(0)
  const [suggesting, setSuggesting] = useState(false)
  // Synchronous re-entrancy lock for suggestLayout -- setSuggesting alone
  // isn't enough because the disabled-button re-render lags one tick behind
  // the click, so a manual click landing in that gap (or a fast double
  // click) can still race an in-flight auto-triggered run and corrupt the
  // packing (confirmed: this exact race scrambled a real multi-container
  // order's allocation). A ref updates immediately, before any await.
  const suggestingRef = useRef(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [suggestionSummary, setSuggestionSummary] = useState<{
    createdCount: number
    containers: { containerNumber: string; fillPct: number; isNew: boolean; lines: { description: string; cartonQty: number; units: number }[] }[]
    skippedNames: string[]
    unplacedNames: string[]
  } | null>(null)

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
      let packedUnits = 0
      for (const row of (plItemsRes.data ?? []) as any[]) {
        const containerId = row.packing_lists?.container_id
        if (!containerId) continue
        packedUnits += Number(row.total_units ?? 0)
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
      setAllocatedUnits(packedUnits)
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

  function openEditContainer(c: Container) {
    setContainerForm({
      container_number: c.container_number,
      container_type: c.container_type,
      vessel_name: c.vessel_name ?? '',
      eta_djibouti: c.eta_djibouti ?? '',
    })
    setEditingContainerId(c.id)
    setError(null)
    setContainerOpen(true)
  }

  async function saveContainer() {
    if (!id) return
    if (!containerForm.container_number) { setError('Container number is required'); return }
    setSavingContainer(true)
    setError(null)
    try {
      const payload = {
        container_number: containerForm.container_number,
        container_type: containerForm.container_type,
        vessel_name: containerForm.vessel_name || null,
        eta_djibouti: containerForm.eta_djibouti || null,
      }
      if (editingContainerId) {
        await updateContainer(editingContainerId, payload)
        setContainerOpen(false)
        setContainerForm({ ...EMPTY_CONTAINER })
        setEditingContainerId(null)
        await load()
      } else {
        const newId = await createContainer(id, payload)
        setContainerOpen(false)
        setContainerForm({ ...EMPTY_CONTAINER })
        await load()
        setExpandedContainer(newId)
      }
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
  // containers as the shortfall requires. Each round picks the SMALLEST
  // standard type (20GP < 40GP < 40HC) that can hold the whole remaining
  // shortfall in one container -- a small tail-end remainder gets a cheap
  // 20GP instead of always defaulting to the biggest box. New containers
  // get a placeholder number ("PENDING-N", since the real number isn't
  // known until it's booked) and packing re-runs against the larger set,
  // so every remaining unit really does end up somewhere. Only gives up on
  // an item whose own single carton is bigger than a full empty 40HC -- no
  // amount of extra containers fixes that; it's a data problem to go check.
  async function suggestLayout(auto = false) {
    if (!pi) return
    if (suggestingRef.current) return
    suggestingRef.current = true
    setSuggesting(true)
    setError(null)
    setNotice(null)
    setSuggestionSummary(null)
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

      const containerNumberById = new Map(containers.map(c => [c.id, c.container_number]))
      const capacityById = new Map(containers.map(c => [c.id, containerCapacityM3(c.container_type)]))
      let workingContainers = containers.map(c => ({
        containerId: c.id,
        capacityM3: containerCapacityM3(c.container_type),
        payloadKg: containerPayloadKg(c.container_type),
        usedM3: containerVolumes[c.id] ?? 0,
        usedKg: containerWeights[c.id] ?? 0,
      }))
      const baselineUsedById = new Map(workingContainers.map(w => [w.containerId, w.usedM3]))

      const STANDARD_TYPES_SMALLEST_FIRST = ['20GP', '40GP', '40HC'].map(type => ({
        type, capacityM3: containerCapacityM3(type), payloadKg: containerPayloadKg(type),
      }))
      const biggestType = STANDARD_TYPES_SMALLEST_FIRST[STANDARD_TYPES_SMALLEST_FIRST.length - 1]

      let result = suggestPackingLayout(suggestionItems, workingContainers)
      const createdContainerNumbers: string[] = []

      // Top up with fresh containers until nothing's left unplaced, capped
      // so a genuinely-impossible item (bigger than an empty container)
      // can't spin this into an endless container-creation loop.
      for (let attempt = 0; attempt < 8 && result.unplaced.length > 0; attempt++) {
        if (singleCartonExceedsContainer(result.unplaced, suggestionItems, biggestType.capacityM3, biggestType.payloadKg)) break

        const chosen = pickContainerTypeForDeficit(result.unplaced, suggestionItems, STANDARD_TYPES_SMALLEST_FIRST)
        const calculatedCount = estimateNewContainersNeeded(result.unplaced, suggestionItems, chosen.capacityM3, chosen.payloadKg)
        const containersToCreate = Math.min(calculatedCount, Math.max(0, 24 - workingContainers.length))
        if (!containersToCreate) break
        const { data: pending } = await supabase.from('containers').select('container_number').like('container_number', 'PENDING-%')
        let maxN = (pending ?? []).reduce((max: number, r: any) => {
          const n = parseInt(String(r.container_number).slice('PENDING-'.length), 10)
          return Number.isFinite(n) && n > max ? n : max
        }, 0)

        // Create the calculated capacity in one pass instead of discovering
        // one missing container per rerun. A subsequent pass only handles
        // bin-packing geometry that aggregate CBM/payload cannot predict.
        for (let index = 0; index < containersToCreate; index++) {
          maxN += 1
          const containerNumber = `PENDING-${maxN}`
          const newId = await createContainer(pi.id, { container_number: containerNumber, container_type: chosen.type })
          createdContainerNumbers.push(containerNumber)
          containerNumberById.set(newId, containerNumber)
          capacityById.set(newId, chosen.capacityM3)
          baselineUsedById.set(newId, 0)
          workingContainers = [...workingContainers, { containerId: newId, capacityM3: chosen.capacityM3, payloadKg: chosen.payloadKg, usedM3: 0, usedKg: 0 }]
        }
        result = suggestPackingLayout(suggestionItems, workingContainers)
      }

      const itemById = new Map(suggestionItems.map(it => [it.piItemId, it]))
      const skippedNames = result.skipped.map(s => items.find(x => x.id === s.piItemId)?.item_description ?? 'an item')
      const unplacedNames = result.unplaced.map(u => items.find(x => x.id === u.piItemId)?.item_description ?? 'an item')

      if (result.assignments.length === 0 && createdContainerNumbers.length === 0) {
        if (result.skipped.length > 0) {
          setNotice(`${skippedNames.join(', ')} ${skippedNames.length === 1 ? 'is' : 'are'} missing carton size or units-per-carton — set it on the Products page to allocate ${skippedNames.length === 1 ? 'it' : 'them'}.`)
        } else if (!auto) {
          // A manual click always gets a response, even a reassuring one --
          // an auto-triggered check (e.g. opening this tab) that finds
          // nothing to do stays silent instead of nagging every visit.
          setNotice('Nothing to suggest — every line item is already fully allocated to a container.')
        }
        return
      }

      const plIdByContainer = new Map<string, string>()
      for (const containerId of new Set(result.assignments.map(a => a.containerId))) {
        plIdByContainer.set(containerId, await getOrCreatePackingList(containerId, pi.id))
      }

      // Groups this run's assignments by container so the result can show
      // exactly what went where and how full each container ended up --
      // not just a count of new containers.
      const byContainer = new Map<string, { addedM3: number; lines: { description: string; cartonQty: number; units: number }[] }>()

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

        const it = itemById.get(a.piItemId)
        const addedM3 = a.cartonQty * (it?.cartonVolumeM3 ?? 0)
        const entry = byContainer.get(a.containerId) ?? { addedM3: 0, lines: [] }
        entry.addedM3 += addedM3
        entry.lines.push({ description: piItem.item_description, cartonQty: a.cartonQty, units: a.cartonQty * a.unitsPerCarton })
        byContainer.set(a.containerId, entry)
      }

      const summaryContainers = [...byContainer.entries()].map(([containerId, v]) => {
        const capacityM3 = capacityById.get(containerId) ?? biggestType.capacityM3
        const baseline = baselineUsedById.get(containerId) ?? 0
        const fillPct = Math.min(100, ((baseline + v.addedM3) / capacityM3) * 100)
        return {
          containerNumber: containerNumberById.get(containerId) ?? '?',
          fillPct,
          isNew: createdContainerNumbers.includes(containerNumberById.get(containerId) ?? ''),
          lines: v.lines,
        }
      }).sort((a, b) => a.containerNumber.localeCompare(b.containerNumber))

      setSuggestionSummary({
        createdCount: createdContainerNumbers.length,
        containers: summaryContainers,
        skippedNames,
        unplacedNames,
      })

      await load()
      setRefreshToken(t => t + 1)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSuggesting(false)
      suggestingRef.current = false
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Loading…</div>
  }
  if (!pi) {
    return <div className="p-5 text-sm text-gray-500">Proforma invoice not found. <Link to="/proforma-invoices" className="text-accent-foreground underline">Back to list</Link></div>
  }

  const routed = pi.buyer_company && pi.final_company && pi.buyer_company.name !== pi.final_company.name
  const totalUnits = items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0)
  const invoiceValue = items.reduce((sum, item) => sum + Number(item.total_price ?? 0), 0)
  const allocatedPct = totalUnits ? Math.min(100, allocatedUnits / totalUnits * 100) : 0

  return (
    <div className="proforma-detail p-5 max-w-7xl mx-auto">
      <Link to="/proforma-invoices" className="pi-detail-back">
        <ArrowLeft size={12} /> Proforma invoices
      </Link>

      <section className="pi-detail-hero">
      <PageHeader
        title={pi.pi_number}
        subtitle={<>
          {pi.suppliers?.name ?? '—'} · {pi.incoterm}
          {(pi.port_of_loading || pi.port_of_discharge) && <> · {pi.port_of_loading ?? 'origin TBD'} → {pi.port_of_discharge ?? 'destination TBD'}</>}
          {routed
            ? <> · routed via {pi.buyer_company?.name} → {pi.final_company?.name}{pi.markup_pct ? ` (+${pi.markup_pct}%)` : ''}</>
            : <> · {pi.final_company?.name ?? 'no company set'}</>}
        </>}
      />
      <div className="pi-detail-facts"><span><CalendarDays /><small>Issued</small><strong>{pi.issue_date}</strong></span><span><Route /><small>Trade route</small><strong>{pi.port_of_loading ?? 'Origin TBD'} → {pi.port_of_discharge ?? 'Destination TBD'}</strong></span><span><CircleDollarSign /><small>Invoice value</small><strong>${N(invoiceValue)} {pi.currency}</strong></span><span><Package /><small>Ordered</small><strong>{N(totalUnits)} units</strong></span></div>
      </section>

      <section className="pi-readiness"><div><span>Commercial order</span><strong>{items.length ? 'Line items entered' : 'Add line items'}</strong></div><i className={items.length ? 'done' : ''} /><div><span>Container allocation</span><strong>{N(allocatedPct)}% packed</strong></div><i className={allocatedPct >= 100 ? 'done' : ''} /><div><span>Shipment handoff</span><strong>{containers.some(container => container.shipment_id) ? 'Shipment generated' : 'Not generated'}</strong></div></section>

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
      {suggestionSummary && (
        <div className="mb-4 bg-white border border-gray-200 rounded-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-600">
              Suggested layout — {suggestionSummary.containers.length} container(s) updated
              {suggestionSummary.createdCount > 0 ? `, ${suggestionSummary.createdCount} newly created` : ''}
            </p>
            <button onClick={() => setSuggestionSummary(null)} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={14} /></button>
          </div>
          <div className="divide-y divide-gray-50">
            {suggestionSummary.containers.map(c => (
              <div key={c.containerNumber} className="px-4 py-2.5 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono font-medium">
                    {c.containerNumber}
                    {c.isNew && <span className="ml-2 text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">new</span>}
                  </span>
                  <span className={c.fillPct >= 90 ? 'text-amber-600 font-medium' : 'text-gray-500'}>{c.fillPct.toFixed(1)}% full</span>
                </div>
                <ul className="text-gray-500 space-y-0.5">
                  {c.lines.map((l, i) => (
                    <li key={i}>{l.description}: {l.cartonQty} cartons ({N(l.units)} units)</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {(suggestionSummary.skippedNames.length > 0 || suggestionSummary.unplacedNames.length > 0) && (
            <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-100 text-xs text-amber-700 space-y-1">
              {suggestionSummary.skippedNames.length > 0 && (
                <p>Skipped (missing carton size / units-per-carton on Products page): {suggestionSummary.skippedNames.join(', ')}</p>
              )}
              {suggestionSummary.unplacedNames.length > 0 && (
                <p>Still didn't fit (single carton bigger than a full container): {suggestionSummary.unplacedNames.join(', ')}</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="pi-inner-tabs" role="tablist" aria-label="Proforma workspace">
        <button onClick={() => setTab('items')}
          className={tab === 'items' ? 'active' : ''}>
          <Package size={15} /><span><strong>Line items</strong><small>Products, HS codes and customs value</small></span><b>{items.length}</b>
        </button>
        <button onClick={() => { setTab('containers'); suggestLayout(true) }}
          className={tab === 'containers' ? 'active' : ''}>
          <Boxes size={15} /><span><strong>Containers</strong><small>Cartons, dimensions, weight and filling</small></span><b>{containers.length}</b>
        </button>
      </div>

      {tab === 'items' && (
        <div className="pi-tab-workspace">
          <div className="pi-workspace-head">
            <div><span>Commercial classification</span><h2>Invoice line items</h2><p>Match the supplier document: product, quantity, price, origin and customs treatment.</p></div>
            <button onClick={openAddItem}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-foreground text-xs rounded-full hover:brightness-95 transition-colors">
              <Plus size={13} /> Add item
            </button>
          </div>

          {items.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-card p-10 text-center">
              <Package size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">No line items yet</p>
              <p className="text-xs text-gray-400 mb-4">Add each product from the supplier's proforma invoice before splitting into containers.</p>
              <button onClick={openAddItem}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-foreground text-xs rounded-full hover:brightness-95 transition-colors">
                <Plus size={13} /> Add first item
              </button>
            </div>
          ) : (
            <div className="pi-line-register">
              <table>
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
        <div className="pi-tab-workspace">
          <div className="pi-workspace-head">
            <div><span>Physical load planning</span><h2>Container filling</h2><p>Allocate every ordered unit, check CBM and payload, then generate the shared shipment.</p></div>
            <div className="flex items-center gap-2">
              <button onClick={() => suggestLayout()} disabled={suggesting || items.length === 0}
                title="Calculate the required containers and allocate remaining cartons"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-600 border border-gray-200 text-xs rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">
                {suggesting ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Smart fill
              </button>
              <GenerateShipmentButton containers={containers} onGenerated={() => load()} />
              <button onClick={() => { setContainerForm({ ...EMPTY_CONTAINER }); setEditingContainerId(null); setError(null); setContainerOpen(true) }}
                disabled={items.length === 0}
                title={items.length === 0 ? 'Add line items first' : undefined}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-foreground text-xs rounded-full hover:brightness-95 disabled:opacity-40 transition-colors">
                <Plus size={13} /> New container
              </button>
            </div>
          </div>

          {containers.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-card p-10 text-center">
              <Boxes size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">No containers yet</p>
              <p className="text-xs text-gray-400">Split this order's line items across one or more containers — they'll all share one shipment, each still tracked independently.</p>
            </div>
          ) : (
            <div className="pi-container-grid">
              {containers.map(c => (
                <article key={c.id} className={`pi-container-card ${expandedContainer === c.id ? 'expanded' : ''}`}>
                  <div className="pi-container-top"
                    onClick={() => setExpandedContainer(v => v === c.id ? null : c.id)}>
                    <div>
                      <span>{c.container_type}</span><h3>{c.container_number}</h3>
                      <p>{c.vessel_name || 'Vessel not assigned'}{c.eta_djibouti ? ` · ETA ${c.eta_djibouti}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.shipment_id && (
                        <span className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded-lg">In shipment</span>
                      )}
                      <button onClick={e => { e.stopPropagation(); openEditContainer(c) }}
                        className="text-gray-300 hover:text-blue-600 transition-colors"><Pencil size={13} /></button>
                    </div>
                  </div>
                  <div className="pi-container-gauge">
                    <ContainerFillGauge containerType={c.container_type} packedM3={containerVolumes[c.id] ?? 0} />
                  </div>
                  <div className="pi-container-facts"><span><Scale /><small>Payload</small><strong>{N(containerWeights[c.id] ?? 0)} / {N(containerPayloadKg(c.container_type))} kg</strong></span><span><Boxes /><small>Volume left</small><strong>{N(Math.max(0, containerCapacityM3(c.container_type) - (containerVolumes[c.id] ?? 0)))} m³</strong></span><span><Ship /><small>Shipment</small><strong>{c.shipments?.shipment_number ?? 'Not generated'}</strong></span></div>
                  {expandedContainer === c.id && (
                    <div className="pi-container-packing">
                      <PackingListBuilder piId={pi.id} containerId={c.id} piItems={items} onChanged={load} refreshToken={refreshToken} />
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add/edit item modal */}
      <Modal
        open={itemOpen}
        onClose={() => setItemOpen(false)}
        title={editingItemId ? 'Edit line item' : 'Add line item'}
        maxWidth="max-w-lg"
        footer={<>
          <button onClick={() => setItemOpen(false)} className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={saveItem} disabled={savingItem}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-accent-foreground text-xs rounded-full hover:brightness-95 disabled:opacity-50 transition-colors min-w-[100px] justify-center">
            {savingItem ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : <><Check size={12} /> {editingItemId ? 'Save changes' : 'Add item'}</>}
          </button>
        </>}
      >
              <div>
                <label className="block text-xs text-gray-500 mb-1">Product (optional until packing)</label>
                <SelectMenu
                  ariaLabel="Product"
                  searchable
                  value={itemForm.product_id}
                  onChange={productId => {
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
                  }}
                  options={products.map(p => ({ value: p.id, label: p.name, description: p.sku }))}
                  placeholder="— not linked yet —"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Description <span className="text-red-400">*</span></label>
                <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                  value={itemForm.item_description} onChange={e => setItemForm(p => ({ ...p, item_description: e.target.value }))} placeholder="e.g. Plastic chair, stackable" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">HS code <span className="text-red-400">*</span></label>
                  <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    value={itemForm.hs_code} onChange={e => setItemForm(p => ({ ...p, hs_code: e.target.value }))} placeholder="9401.61" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Country of origin</label>
                  <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    value={itemForm.country_of_origin} onChange={e => setItemForm(p => ({ ...p, country_of_origin: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Quantity <span className="text-red-400">*</span></label>
                  <input type="number" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    value={itemForm.quantity} onChange={e => setItemForm(p => ({ ...p, quantity: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Unit</label>
                  <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    value={itemForm.unit_of_measure} onChange={e => setItemForm(p => ({ ...p, unit_of_measure: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Unit price (USD) <span className="text-red-400">*</span></label>
                  <input type="number" step="0.01" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    value={itemForm.unit_price} onChange={e => setItemForm(p => ({ ...p, unit_price: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Customs (CD) value — editable, overrides invoice price for duty calc</label>
                <input type="number" step="0.01" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                  value={itemForm.customs_value} onChange={e => setItemForm(p => ({ ...p, customs_value: e.target.value }))} placeholder="Leave blank to use unit price × qty" />
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Duty %</label>
                  <input type="number" step="0.1" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    value={itemForm.duty_rate_pct} onChange={e => setItemForm(p => ({ ...p, duty_rate_pct: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">VAT %</label>
                  <input type="number" step="0.1" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    value={itemForm.vat_rate_pct} onChange={e => setItemForm(p => ({ ...p, vat_rate_pct: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Surtax %</label>
                  <input type="number" step="0.1" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    value={itemForm.surtax_rate_pct} onChange={e => setItemForm(p => ({ ...p, surtax_rate_pct: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Excise %</label>
                  <input type="number" step="0.1" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    value={itemForm.excise_rate_pct} onChange={e => setItemForm(p => ({ ...p, excise_rate_pct: e.target.value }))} />
                </div>
              </div>
      </Modal>

      {/* New container modal */}
      <Modal
        open={containerOpen}
        onClose={() => setContainerOpen(false)}
        title={editingContainerId ? 'Edit container' : 'New container'}
        footer={<>
          <button onClick={() => setContainerOpen(false)} className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={saveContainer} disabled={savingContainer}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-accent-foreground text-xs rounded-full hover:brightness-95 disabled:opacity-50 transition-colors min-w-[100px] justify-center">
            {savingContainer ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : <><Check size={12} /> {editingContainerId ? 'Save changes' : 'Create'}</>}
          </button>
        </>}
      >
              <div>
                <label className="block text-xs text-gray-500 mb-1">Container number <span className="text-red-400">*</span></label>
                <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                  value={containerForm.container_number} onChange={e => setContainerForm(p => ({ ...p, container_number: e.target.value }))} placeholder="e.g. CSNU4832156" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Type</label>
                  <SelectMenu
                    ariaLabel="Container type"
                    value={containerForm.container_type}
                    onChange={value => setContainerForm(p => ({ ...p, container_type: value }))}
                    options={[
                      { value: '20GP', label: '20GP' },
                      { value: '40GP', label: '40GP' },
                      { value: '40HC', label: '40HC' },
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ETA Djibouti</label>
                  <input type="date" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                    value={containerForm.eta_djibouti} onChange={e => setContainerForm(p => ({ ...p, eta_djibouti: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Vessel name</label>
                <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                  value={containerForm.vessel_name} onChange={e => setContainerForm(p => ({ ...p, vessel_name: e.target.value }))} />
              </div>
      </Modal>
    </div>
  )
}
