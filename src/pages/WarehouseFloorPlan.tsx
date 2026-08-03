/* eslint-disable react-hooks/refs -- transient SVG drag geometry intentionally lives in refs to avoid state churn on every pointer move */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowRightLeft, Box, Building2, Copy, Hand, Layers3, Loader2, Lock,
  MapPin, MousePointer2, Package, Plus, Search, Trash2, X, ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react'
import {
  createWarehouseLocation, fetchFloorPlanData, moveInventoryLocation, updateLocationGeometry, updateWarehouseLocation,
} from '../api/warehouseOperations'
import type {
  FloorPlanProduct, LocationStockRow, LocationType, ManualLocationStatus, UnplacedStockRow, WarehouseLocation,
} from '../api/warehouseOperations'

const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())
const formatQuantity = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)

const LOCATION_TYPES: LocationType[] = ['zone', 'aisle', 'shelf', 'bin', 'rack', 'loading', 'damaged', 'workspace', 'staging', 'floor']
const STORAGE_AREA_TYPES = LOCATION_TYPES.filter(type => type !== 'floor')

type EffectiveStatus = 'empty' | 'partial' | 'occupied' | 'reserved' | 'restricted'
type AreaColorKey = 'lime' | 'blue' | 'teal' | 'violet' | 'amber' | 'rose' | 'slate'

function effectiveStatus(location: WarehouseLocation, stockQty: number): EffectiveStatus {
  if (location.manual_status) return location.manual_status
  if (stockQty <= 0) return 'empty'
  if (location.capacity != null && stockQty < location.capacity) return 'partial'
  return 'occupied'
}

const STATUS_COLOR: Record<EffectiveStatus, { fill: string; stroke: string; label: string }> = {
  empty: { fill: '#f3f4f6', stroke: '#9ca3af', label: 'Empty' },
  partial: { fill: '#fef3c7', stroke: '#d97706', label: 'Partially occupied' },
  occupied: { fill: '#d1fae5', stroke: '#059669', label: 'Occupied' },
  reserved: { fill: '#dbeafe', stroke: '#2563eb', label: 'Reserved' },
  restricted: { fill: '#fee2e2', stroke: '#dc2626', label: 'Restricted' },
}

const AREA_COLORS: Record<AreaColorKey, { fill: string; stroke: string; label: string }> = {
  lime: { fill: '#ecfccb', stroke: '#65a30d', label: 'Lime' },
  blue: { fill: '#dbeafe', stroke: '#2563eb', label: 'Blue' },
  teal: { fill: '#ccfbf1', stroke: '#0f766e', label: 'Teal' },
  violet: { fill: '#ede9fe', stroke: '#7c3aed', label: 'Violet' },
  amber: { fill: '#fef3c7', stroke: '#d97706', label: 'Amber' },
  rose: { fill: '#ffe4e6', stroke: '#e11d48', label: 'Rose' },
  slate: { fill: '#e2e8f0', stroke: '#475569', label: 'Slate' },
}

function areaColors(location: WarehouseLocation, status: EffectiveStatus) {
  const key = location.display_color as AreaColorKey | null
  return key && AREA_COLORS[key] ? AREA_COLORS[key] : STATUS_COLOR[status]
}

type Tool = 'select' | 'draw'
type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
interface Geometry { x: number; y: number; w: number; h: number }
interface ViewBox { x: number; y: number; w: number; h: number }

interface DragState {
  kind: 'move' | 'resize' | 'pan' | 'draw'
  locationId?: string
  handle?: Handle
  startPointer: { x: number; y: number }
  startGeometry?: Geometry
  startViewBox?: ViewBox
}

const MIN_SIZE = 24

function resizeGeometry(start: Geometry, handle: Handle, dx: number, dy: number): Geometry {
  let { x, y, w, h } = start
  if (handle.includes('e')) w = Math.max(MIN_SIZE, start.w + dx)
  if (handle.includes('s')) h = Math.max(MIN_SIZE, start.h + dy)
  if (handle.includes('w')) { w = Math.max(MIN_SIZE, start.w - dx); x = start.x + start.w - w }
  if (handle.includes('n')) { h = Math.max(MIN_SIZE, start.h - dy); y = start.y + start.h - h }
  return { x, y, w, h }
}

function svgPoint(svg: SVGSVGElement, viewBox: ViewBox, clientX: number, clientY: number) {
  const rect = svg.getBoundingClientRect()
  return {
    x: viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.w,
    y: viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.h,
  }
}

const DEFAULT_VIEWBOX: ViewBox = { x: 0, y: 0, w: 1000, h: 700 }

export function WarehouseFloorPlan() {
  const { warehouseId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const warehouseName = searchParams.get('name') ?? 'Warehouse'

  const [locations, setLocations] = useState<WarehouseLocation[]>([])
  const [stockByLocation, setStockByLocation] = useState<LocationStockRow[]>([])
  const [unplacedStock, setUnplacedStock] = useState<UnplacedStockRow[]>([])
  const [products, setProducts] = useState<FloorPlanProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [tool, setTool] = useState<Tool>('select')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewBox, setViewBox] = useState<ViewBox>(DEFAULT_VIEWBOX)
  const [query, setQuery] = useState('')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [draftRect, setDraftRect] = useState<Geometry | null>(null)
  const [newAreaPrompt, setNewAreaPrompt] = useState<Geometry | null>(null)
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null)
  const [showNewFloor, setShowNewFloor] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const localGeometry = useRef<Record<string, Geometry>>({})
  const [, forceRender] = useState(0)

  const load = useCallback(async () => {
    if (!warehouseId) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchFloorPlanData(warehouseId)
      setLocations(data.locations)
      setStockByLocation(data.stockByLocation)
      setUnplacedStock(data.unplacedStock)
      setProducts(data.products)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the floor plan.')
    } finally {
      setLoading(false)
    }
  }, [warehouseId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- route-scoped remote data load
  useEffect(() => { void load() }, [load])

  const stockByLocationId = useMemo(() => {
    const map = new Map<string, { total: number; lines: { productId: string; qty: number }[] }>()
    for (const row of stockByLocation) {
      const entry = map.get(row.location_id) ?? { total: 0, lines: [] }
      entry.total += row.quantity_on_hand
      entry.lines.push({ productId: row.product_id, qty: row.quantity_on_hand })
      map.set(row.location_id, entry)
    }
    return map
  }, [stockByLocation])

  const unplacedTotal = useMemo(() => unplacedStock.reduce((sum, row) => sum + row.quantity_on_hand, 0), [unplacedStock])
  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products])

  const geometryFor = useCallback((location: WarehouseLocation): Geometry =>
    localGeometry.current[location.id] ?? { x: location.pos_x, y: location.pos_y, w: location.width, h: location.height },
  [])

  const visibleLocations = locations.filter(location => location.is_active)
  const floors = visibleLocations.filter(location => location.location_type === 'floor')
  const floorAreas = visibleLocations.filter(location => location.location_type !== 'floor' && location.parent_location_id === selectedFloorId)
  const selected = floorAreas.find(location => location.id === selectedId) ?? null
  const hovered = floorAreas.find(location => location.id === hoveredId) ?? null
  const floorCapacity = floorAreas.reduce((sum, location) => sum + (location.capacity ?? 0), 0)
  const floorStock = floorAreas.reduce((sum, location) => sum + (stockByLocationId.get(location.id)?.total ?? 0), 0)
  const occupiedAreas = floorAreas.filter(location => effectiveStatus(location, stockByLocationId.get(location.id)?.total ?? 0) === 'occupied').length
  const floorLabel = selectedFloorId
    ? floors.find(floor => floor.id === selectedFloorId)?.name || floors.find(floor => floor.id === selectedFloorId)?.code || 'Floor'
    : 'Main floor'
  // Keeps resize-handle tap targets ~22 screen px regardless of zoom level or
  // device pixel density -- a fixed canvas-unit radius would shrink to
  // nothing when zoomed in and be needlessly huge when zoomed out.
  const handleHitRadius = (viewBox.w / (svgRef.current?.clientWidth || 1000)) * 22

  const matchedLocationIds = useMemo(() => {
    if (!query.trim()) return new Set<string>()
    const needle = query.trim().toLowerCase()
    const matchingProductIds = new Set(products.filter(product =>
      product.name.toLowerCase().includes(needle) || product.sku.toLowerCase().includes(needle),
    ).map(product => product.id))
    const ids = new Set<string>()
    for (const row of stockByLocation) {
      if (matchingProductIds.has(row.product_id)) ids.add(row.location_id)
    }
    return ids
  }, [query, products, stockByLocation])

  function focusLocation(location: WarehouseLocation) {
    const geometry = geometryFor(location)
    setSelectedId(location.id)
    setHighlightId(location.id)
    setViewBox(current => ({
      x: geometry.x + geometry.w / 2 - current.w / 2,
      y: geometry.y + geometry.h / 2 - current.h / 2,
      w: current.w,
      h: current.h,
    }))
    window.setTimeout(() => setHighlightId(null), 2200)
  }

  useEffect(() => {
    if (matchedLocationIds.size === 0) return
    const first = floorAreas.find(location => matchedLocationIds.has(location.id))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- search selection synchronizes the map viewport
    if (first) focusLocation(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedLocationIds])

  function fitAll() {
    if (floorAreas.length === 0) { setViewBox(DEFAULT_VIEWBOX); return }
    const minX = Math.min(...floorAreas.map(l => geometryFor(l).x)) - 40
    const minY = Math.min(...floorAreas.map(l => geometryFor(l).y)) - 40
    const maxX = Math.max(...floorAreas.map(l => geometryFor(l).x + geometryFor(l).w)) + 40
    const maxY = Math.max(...floorAreas.map(l => geometryFor(l).y + geometryFor(l).h)) + 40
    setViewBox({ x: minX, y: minY, w: Math.max(400, maxX - minX), h: Math.max(300, maxY - minY) })
  }

  function zoomBy(factor: number) {
    setViewBox(current => {
      const cx = current.x + current.w / 2
      const cy = current.y + current.h / 2
      const w = Math.min(4000, Math.max(200, current.w * factor))
      const h = Math.min(3000, Math.max(150, current.h * factor))
      return { x: cx - w / 2, y: cy - h / 2, w, h }
    })
  }

  function onWheel(event: React.WheelEvent<SVGSVGElement>) {
    event.preventDefault()
    zoomBy(event.deltaY > 0 ? 1.1 : 0.9)
  }

  function onPointerDownCanvas(event: React.PointerEvent<SVGSVGElement>) {
    if (!svgRef.current) return
    const point = svgPoint(svgRef.current, viewBox, event.clientX, event.clientY)
    if (tool === 'draw') {
      dragRef.current = { kind: 'draw', startPointer: point }
      setDraftRect({ x: point.x, y: point.y, w: 0, h: 0 })
    } else {
      setSelectedId(null)
      dragRef.current = { kind: 'pan', startPointer: point, startViewBox: viewBox }
    }
    svgRef.current.setPointerCapture(event.pointerId)
  }

  function onPointerDownArea(event: React.PointerEvent, location: WarehouseLocation) {
    if (tool !== 'select' || !svgRef.current) return
    event.stopPropagation()
    setSelectedId(location.id)
    const point = svgPoint(svgRef.current, viewBox, event.clientX, event.clientY)
    dragRef.current = { kind: 'move', locationId: location.id, startPointer: point, startGeometry: geometryFor(location) }
    svgRef.current.setPointerCapture(event.pointerId)
  }

  function onPointerDownHandle(event: React.PointerEvent, location: WarehouseLocation, handle: Handle) {
    if (!svgRef.current) return
    event.stopPropagation()
    const point = svgPoint(svgRef.current, viewBox, event.clientX, event.clientY)
    dragRef.current = { kind: 'resize', locationId: location.id, handle, startPointer: point, startGeometry: geometryFor(location) }
    svgRef.current.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (!drag || !svgRef.current) return
    const point = svgPoint(svgRef.current, viewBox, event.clientX, event.clientY)
    const dx = point.x - drag.startPointer.x
    const dy = point.y - drag.startPointer.y

    if (drag.kind === 'pan' && drag.startViewBox) {
      setViewBox({ ...drag.startViewBox, x: drag.startViewBox.x - dx, y: drag.startViewBox.y - dy })
    } else if (drag.kind === 'draw') {
      setDraftRect({
        x: Math.min(drag.startPointer.x, point.x),
        y: Math.min(drag.startPointer.y, point.y),
        w: Math.abs(dx),
        h: Math.abs(dy),
      })
    } else if (drag.kind === 'move' && drag.locationId && drag.startGeometry) {
      localGeometry.current[drag.locationId] = { ...drag.startGeometry, x: drag.startGeometry.x + dx, y: drag.startGeometry.y + dy }
      forceRender(n => n + 1)
    } else if (drag.kind === 'resize' && drag.locationId && drag.startGeometry && drag.handle) {
      localGeometry.current[drag.locationId] = resizeGeometry(drag.startGeometry, drag.handle, dx, dy)
      forceRender(n => n + 1)
    }
  }

  async function onPointerUp() {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return

    if (drag.kind === 'draw') {
      if (draftRect && draftRect.w > 10 && draftRect.h > 10) {
        setNewAreaPrompt(draftRect)
      }
      setDraftRect(null)
      setTool('select')
      return
    }
    if ((drag.kind === 'move' || drag.kind === 'resize') && drag.locationId) {
      const geometry = localGeometry.current[drag.locationId]
      if (!geometry) return
      try {
        await updateLocationGeometry(drag.locationId, { posX: geometry.x, posY: geometry.y, width: geometry.w, height: geometry.h })
        setLocations(current => current.map(location => location.id === drag.locationId
          ? { ...location, pos_x: geometry.x, pos_y: geometry.y, width: geometry.w, height: geometry.h }
          : location))
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not save the new position.')
      } finally {
        delete localGeometry.current[drag.locationId]
      }
    }
  }

  async function createArea(input: { code: string; name: string; locationType: LocationType; capacity: string; displayColor: AreaColorKey | null }) {
    if (!newAreaPrompt) return
    setSaving(true)
    setError(null)
    try {
      const id = await createWarehouseLocation({
        warehouseId,
        code: input.code,
        name: input.name || undefined,
        locationType: input.locationType,
        parentLocationId: selectedFloorId,
        posX: newAreaPrompt.x, posY: newAreaPrompt.y, width: newAreaPrompt.w, height: newAreaPrompt.h,
        capacity: input.capacity ? Number(input.capacity) : null,
        displayColor: input.displayColor,
      })
      setNewAreaPrompt(null)
      await load()
      setSelectedId(id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the area.')
    } finally {
      setSaving(false)
    }
  }

  async function createFloor(input: { code: string; name: string }) {
    setSaving(true)
    setError(null)
    try {
      const id = await createWarehouseLocation({
        warehouseId,
        code: input.code,
        name: input.name || undefined,
        locationType: 'floor',
        posX: 0,
        posY: 0,
        width: DEFAULT_VIEWBOX.w,
        height: DEFAULT_VIEWBOX.h,
      })
      await load()
      setSelectedFloorId(id)
      setSelectedId(null)
      setViewBox(DEFAULT_VIEWBOX)
      setShowNewFloor(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the floor.')
    } finally {
      setSaving(false)
    }
  }

  function addAreaAtCenter() {
    setTool('select')
    setSelectedId(null)
    setNewAreaPrompt({
      x: viewBox.x + viewBox.w / 2 - 80,
      y: viewBox.y + viewBox.h / 2 - 50,
      w: 160,
      h: 100,
    })
  }

  function switchFloor(floorId: string | null) {
    setSelectedFloorId(floorId)
    setSelectedId(null)
    setNewAreaPrompt(null)
    setViewBox(DEFAULT_VIEWBOX)
  }

  async function duplicateArea(location: WarehouseLocation) {
    setSaving(true)
    setError(null)
    try {
      let suffix = 2
      let code = `${location.code}-COPY`
      while (locations.some(item => item.code === code)) { code = `${location.code}-COPY${suffix}`; suffix += 1 }
      const id = await createWarehouseLocation({
        warehouseId,
        code,
        name: location.name ?? undefined,
        locationType: location.location_type,
        parentLocationId: location.parent_location_id,
        posX: location.pos_x + 24, posY: location.pos_y + 24, width: location.width, height: location.height,
        capacity: location.capacity,
        displayColor: location.display_color,
      })
      await load()
      setSelectedId(id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not duplicate the area.')
    } finally {
      setSaving(false)
    }
  }

  async function deactivateArea(location: WarehouseLocation) {
    setSaving(true)
    setError(null)
    try {
      await updateWarehouseLocation(location.id, { isActive: false })
      setSelectedId(null)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the area.')
    } finally {
      setSaving(false)
    }
  }

  async function saveProperties(location: WarehouseLocation, patch: {
    code: string; name: string; locationType: LocationType; parentLocationId: string | null; capacity: string; manualStatus: ManualLocationStatus; notes: string; displayColor: AreaColorKey | null
  }) {
    setSaving(true)
    setError(null)
    try {
      await updateWarehouseLocation(location.id, {
        code: patch.code,
        name: patch.name || null,
        locationType: patch.locationType,
        parentLocationId: patch.parentLocationId,
        capacity: patch.capacity ? Number(patch.capacity) : null,
        manualStatus: patch.manualStatus,
        notes: patch.notes || null,
        displayColor: patch.displayColor,
      })
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save changes.')
    } finally {
      setSaving(false)
    }
  }

  async function assignStock(toLocationId: string, input: { productId: string; fromLocationId: string | null; quantity: number; notes: string }) {
    setSaving(true)
    setError(null)
    try {
      await moveInventoryLocation({
        warehouseId,
        productId: input.productId,
        fromLocationId: input.fromLocationId,
        toLocationId,
        quantity: input.quantity,
        notes: input.notes || undefined,
      })
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not assign stock.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="floor-plan-loading"><Loader2 className="animate-spin" size={22} /><span>Loading floor plan…</span></div>
  }

  return (
    <div className="floor-plan-shell">
      <header className="floor-plan-header">
        <div className="floor-plan-header__identity">
          <Link to="/warehouse-operations?tab=locations" className="floor-plan-back" aria-label="Back to warehouse locations"><ArrowLeft size={18} /></Link>
          <div className="floor-plan-header__mark"><Building2 size={20} /></div>
          <div className="floor-plan-header__title"><span>Warehouse inventory locator</span><strong>{warehouseName}</strong></div>
        </div>
        <label className="floor-plan-search"><Search size={17} /><input aria-label="Search product or SKU" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search product or SKU" /></label>
        <div className="floor-plan-header__actions">
          <button type="button" className="floor-plan-secondary-action" onClick={() => setShowNewFloor(true)}><Layers3 size={17} /><span>Add floor</span></button>
          <button type="button" className="floor-plan-primary-action" onClick={addAreaAtCenter}><Plus size={17} /><span>Add storage area</span></button>
        </div>
      </header>

      {error && <div className="floor-plan-error"><span>{error}</span><button onClick={() => setError(null)}><X size={13} /></button></div>}

      <nav className="floor-plan-floorbar" aria-label="Warehouse floors">
        <div className="floor-plan-floorbar__label"><Layers3 size={16} /><span>Floors</span></div>
        <div className="floor-plan-floorbar__scroll">
          <button type="button" className={selectedFloorId === null ? 'is-active' : ''} onClick={() => switchFloor(null)}>
            <span>Main floor</span><small>{visibleLocations.filter(location => location.location_type !== 'floor' && !location.parent_location_id).length}</small>
          </button>
          {floors.map(floor => (
            <button type="button" key={floor.id} className={selectedFloorId === floor.id ? 'is-active' : ''} onClick={() => switchFloor(floor.id)}>
              <span>{floor.name || floor.code}</span><small>{visibleLocations.filter(location => location.parent_location_id === floor.id && location.location_type !== 'floor').length}</small>
            </button>
          ))}
        </div>
        <button type="button" className="floor-plan-floorbar__add" onClick={() => setShowNewFloor(true)} aria-label="Add another floor"><Plus size={16} /><span>New floor</span></button>
      </nav>

      <div className="floor-plan-body">
        <aside className="floor-plan-sidebar">
          <div className="floor-plan-sidebar__heading">
            <div><span>Now viewing</span><strong>{floorLabel}</strong></div>
            <span className="floor-plan-area-count">{floorAreas.length} areas</span>
          </div>

          <div className="floor-plan-summary">
            <div><strong>{occupiedAreas}</strong><span>Occupied</span></div>
            <div><strong>{Math.round(floorStock).toLocaleString()}</strong><span>Units placed</span></div>
            <div><strong>{floorCapacity ? `${Math.min(999, Math.round((floorStock / floorCapacity) * 100))}%` : '—'}</strong><span>Capacity used</span></div>
          </div>

          <div className="floor-plan-tools">
            <button className={tool === 'select' ? 'is-active' : ''} onClick={() => setTool('select')} aria-label="Select and move areas" title="Select and move"><MousePointer2 size={16} /><span>Select</span></button>
            <button className={tool === 'draw' ? 'is-active' : ''} onClick={() => setTool('draw')} aria-label="Draw a new storage area" title="Draw new area"><Plus size={16} /><span>Draw</span></button>
            <span className="floor-plan-tools__divider" />
            <button onClick={() => zoomBy(0.83)} aria-label="Zoom in" title="Zoom in"><ZoomIn size={16} /></button>
            <button onClick={() => zoomBy(1.2)} aria-label="Zoom out" title="Zoom out"><ZoomOut size={16} /></button>
            <button onClick={fitAll} aria-label="Fit all areas to view" title="Fit to view"><Maximize2 size={16} /></button>
          </div>
          <p className="floor-plan-hint"><Hand size={12} /> {tool === 'draw' ? 'Drag on the canvas to draw a new area.' : 'Drag an area to move it, or drag its edge/corner to resize. Drag empty space to pan.'}</p>
          {unplacedTotal > 0 && <div className="floor-plan-unplaced"><Package size={13} /> {Math.round(unplacedTotal)} units not yet placed on this plan</div>}
          <div className="floor-plan-arealist">
            <div className="floor-plan-arealist__head"><p>Storage areas</p><button type="button" onClick={addAreaAtCenter}><Plus size={14} /> Add</button></div>
            {floorAreas.length === 0 && <div className="floor-plan-arealist__empty">No areas on this floor yet.</div>}
            {floorAreas.map(location => {
              const stock = stockByLocationId.get(location.id)
              const status = effectiveStatus(location, stock?.total ?? 0)
              return (
                <button
                  key={location.id}
                  className={selectedId === location.id ? 'is-active' : ''}
                  onClick={() => focusLocation(location)}
                  onMouseEnter={() => setHoveredId(location.id)}
                  onMouseLeave={() => setHoveredId(current => current === location.id ? null : current)}
                  onFocus={() => setHoveredId(location.id)}
                  onBlur={() => setHoveredId(current => current === location.id ? null : current)}
                >
                  <i style={{ background: areaColors(location, status).stroke }} />
                  <span><b>{location.name || location.code}</b><small>{location.code} · {titleCase(location.location_type)}</small></span>
                  <em>{stock ? Math.round(stock.total).toLocaleString() : 'Empty'}</em>
                </button>
              )
            })}
          </div>
          <details className="floor-plan-legend">
            <summary>Occupancy legend</summary>
            <div className="floor-plan-legend__grid">
              {(Object.keys(STATUS_COLOR) as EffectiveStatus[]).map(status => (
                <div key={status}><i style={{ background: STATUS_COLOR[status].fill, borderColor: STATUS_COLOR[status].stroke }} />{STATUS_COLOR[status].label}</div>
              ))}
            </div>
          </details>
        </aside>

        <div className="floor-plan-canvas-wrap">
          <div className="floor-plan-canvas-label"><MapPin size={14} /><span>{floorLabel}</span><small>{floorAreas.length} mapped areas</small></div>
          <svg
            ref={svgRef}
            className="floor-plan-canvas"
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            onWheel={onWheel}
            onPointerDown={onPointerDownCanvas}
            onPointerMove={onPointerMove}
            onPointerUp={() => void onPointerUp()}
            onPointerLeave={() => void onPointerUp()}
          >
            <defs>
              <pattern id="floor-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e5e7eb" strokeWidth="1" />
              </pattern>
            </defs>
            <rect x={viewBox.x - 2000} y={viewBox.y - 2000} width={viewBox.w + 4000} height={viewBox.h + 4000} fill="url(#floor-grid)" />

            {floorAreas.map(location => {
              const geometry = geometryFor(location)
              const stock = stockByLocationId.get(location.id)
              const status = effectiveStatus(location, stock?.total ?? 0)
              const colors = areaColors(location, status)
              const isSelected = selectedId === location.id
              const isHighlighted = highlightId === location.id
              return (
                <g
                  key={location.id}
                  className={`${isHighlighted ? 'floor-plan-pulse ' : ''}${hoveredId === location.id ? 'is-hovered' : ''}`}
                  onMouseEnter={() => setHoveredId(location.id)}
                  onMouseLeave={() => setHoveredId(current => current === location.id ? null : current)}
                >
                  <rect
                    x={geometry.x} y={geometry.y} width={geometry.w} height={geometry.h}
                    rx={10} ry={10}
                    fill={colors.fill}
                    stroke={isSelected ? '#111827' : colors.stroke}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    onPointerDown={event => onPointerDownArea(event, location)}
                    style={{ cursor: tool === 'select' ? 'grab' : 'default' }}
                  />
                  {(status === 'restricted') && <MapPin x={geometry.x + 6} y={geometry.y + 6} size={14} color={colors.stroke} />}
                  <text x={geometry.x + geometry.w / 2} y={geometry.y + geometry.h / 2 - 4} textAnchor="middle" fontSize="13" fontWeight="600" fill="#111827">{location.code}</text>
                  <text x={geometry.x + geometry.w / 2} y={geometry.y + geometry.h / 2 + 13} textAnchor="middle" fontSize="10" fill="#4b5563">{stock ? `${Math.round(stock.total)} units` : titleCase(location.location_type)}</text>
                  {isSelected && tool === 'select' && (
                    <>
                      {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as Handle[]).map(handle => {
                        const hx = handle.includes('w') ? geometry.x : handle.includes('e') ? geometry.x + geometry.w : geometry.x + geometry.w / 2
                        const hy = handle.includes('n') ? geometry.y : handle.includes('s') ? geometry.y + geometry.h : geometry.y + geometry.h / 2
                        return (
                          <g key={handle} style={{ cursor: `${handle}-resize` }} onPointerDown={event => onPointerDownHandle(event, location, handle)}>
                            {/* Invisible larger hit-area so handles are easy to grab on touch, independent of the small visible dot */}
                            <circle cx={hx} cy={hy} r={handleHitRadius} fill="transparent" />
                            <rect x={hx - 6} y={hy - 6} width={12} height={12} fill="#111827" stroke="#fff" strokeWidth={1.5} rx={3} pointerEvents="none" />
                          </g>
                        )
                      })}
                    </>
                  )}
                </g>
              )
            })}

            {draftRect && <rect x={draftRect.x} y={draftRect.y} width={draftRect.w} height={draftRect.h} rx={10} fill="rgba(59,130,246,0.15)" stroke="#3b82f6" strokeDasharray="6 4" strokeWidth={2} />}
          </svg>
          {hovered && (
            <AreaHoverCard
              location={hovered}
              geometry={geometryFor(hovered)}
              viewBox={viewBox}
              stock={stockByLocationId.get(hovered.id)}
              productById={productById}
            />
          )}
          {floorAreas.length === 0 && !newAreaPrompt && (
            <div className="floor-plan-canvas-empty">
              <div><Layers3 size={22} /></div>
              <strong>Map your first storage area</strong>
              <p>Add a rack, zone, loading bay, or workspace to this floor.</p>
              <button type="button" onClick={addAreaAtCenter}><Plus size={16} /> Add storage area</button>
            </div>
          )}
        </div>

        <aside className={`floor-plan-properties ${newAreaPrompt || selected ? 'is-open' : ''}`} aria-label="Area details">
          {(newAreaPrompt || selected) && <button type="button" className="floor-plan-sheet-close" onClick={() => { setNewAreaPrompt(null); setSelectedId(null) }} aria-label="Close area details"><X size={18} /></button>}
          {newAreaPrompt ? (
            <NewAreaForm saving={saving} onCancel={() => setNewAreaPrompt(null)} onSave={createArea} />
          ) : selected ? (
            <AreaProperties
              key={selected.id}
              location={selected}
              stock={stockByLocationId.get(selected.id)}
              productById={productById}
              products={products}
              floors={floors}
              unplacedStock={unplacedStock}
              stockByLocationId={stockByLocationId}
              otherLocations={floorAreas.filter(item => item.id !== selected.id)}
              saving={saving}
              onSave={patch => void saveProperties(selected, patch)}
              onDuplicate={() => void duplicateArea(selected)}
              onDelete={() => void deactivateArea(selected)}
              onAssignStock={input => void assignStock(selected.id, input)}
            />
          ) : (
            <div className="floor-plan-properties__empty"><Box size={26} /><strong>Area details</strong><p>Select a storage area on the map or in the navigator to review stock and properties.</p></div>
          )}
        </aside>
      </div>

      {showNewFloor && (
        <div className="floor-plan-modal-backdrop" role="presentation">
          <section className="floor-plan-modal" role="dialog" aria-modal="true" aria-labelledby="new-floor-title">
            <div className="floor-plan-modal__icon"><Layers3 size={22} /></div>
            <NewFloorForm saving={saving} onCancel={() => setShowNewFloor(false)} onSave={createFloor} />
          </section>
        </div>
      )}
    </div>
  )
}

function AreaHoverCard({ location, geometry, viewBox, stock, productById }: {
  location: WarehouseLocation
  geometry: Geometry
  viewBox: ViewBox
  stock: { total: number; lines: { productId: string; qty: number }[] } | undefined
  productById: Map<string, FloorPlanProduct>
}) {
  const status = effectiveStatus(location, stock?.total ?? 0)
  const colors = areaColors(location, status)
  const x = ((geometry.x + geometry.w / 2 - viewBox.x) / viewBox.w) * 100
  const y = ((geometry.y - viewBox.y) / viewBox.h) * 100
  const showBelow = y < 34
  const usage = location.capacity && stock ? Math.min(999, Math.round((stock.total / location.capacity) * 100)) : null
  const visibleLines = stock?.lines.slice(0, 3) ?? []

  return (
    <div
      role="tooltip"
      className={`floor-plan-hover-card ${showBelow ? 'is-below' : ''}`}
      style={{
        left: `clamp(154px, ${x}%, calc(100% - 154px))`,
        top: `clamp(18px, ${y}%, calc(100% - 18px))`,
        '--floor-preview-accent': colors.stroke,
      } as React.CSSProperties}
    >
      <div className="floor-plan-hover-card__head">
        <div className="floor-plan-hover-card__icon" style={{ background: colors.fill, color: colors.stroke }}><Box size={17} /></div>
        <div><strong>{location.name || location.code}</strong><span>{location.code} · {titleCase(location.location_type)}</span></div>
        <span className="floor-plan-hover-card__status" style={{ color: STATUS_COLOR[status].stroke, background: STATUS_COLOR[status].fill }}>{STATUS_COLOR[status].label}</span>
      </div>
      <div className="floor-plan-hover-card__metrics">
        <div><strong>{Math.round(stock?.total ?? 0).toLocaleString()}</strong><span>Units stored</span></div>
        <div><strong>{location.capacity?.toLocaleString() ?? '∞'}</strong><span>Capacity</span></div>
        <div><strong>{usage == null ? '—' : `${usage}%`}</strong><span>Utilization</span></div>
      </div>
      <div className="floor-plan-hover-card__contents">
        <p><Package size={13} /> Area contents</p>
        {visibleLines.length ? visibleLines.map(line => (
          <div key={line.productId}><span>{productById.get(line.productId)?.name ?? 'Unknown product'}</span><b>{Math.round(line.qty).toLocaleString()}</b></div>
        )) : <small>No stock placed in this area.</small>}
        {(stock?.lines.length ?? 0) > 3 && <small>+{(stock?.lines.length ?? 0) - 3} more products</small>}
      </div>
      <div className="floor-plan-hover-card__footer">Click the area to view and edit details</div>
    </div>
  )
}

function NewAreaForm({ saving, onCancel, onSave }: {
  saving: boolean
  onCancel: () => void
  onSave: (input: { code: string; name: string; locationType: LocationType; capacity: string; displayColor: AreaColorKey | null }) => Promise<void>
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [locationType, setLocationType] = useState<LocationType>('shelf')
  const [capacity, setCapacity] = useState('')
  const [displayColor, setDisplayColor] = useState<AreaColorKey | null>(null)

  return (
    <form className="floor-plan-form" onSubmit={event => { event.preventDefault(); void onSave({ code, name, locationType, capacity, displayColor }) }}>
      <div className="floor-plan-form__intro"><span>New storage area</span><h3>Define this space</h3><p>You can move and resize it on the map after creating it.</p></div>
      <label htmlFor="new-area-code">Area code<input id="new-area-code" required autoFocus value={code} onChange={event => setCode(event.target.value)} placeholder="e.g. RACK-A1" /></label>
      <label htmlFor="new-area-name">Area name<input id="new-area-name" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Finished goods" /></label>
      <label htmlFor="new-area-type">Storage type<select id="new-area-type" value={locationType} onChange={event => setLocationType(event.target.value as LocationType)}>
        {STORAGE_AREA_TYPES.map(type => <option key={type} value={type}>{titleCase(type)}</option>)}
      </select></label>
      <label htmlFor="new-area-capacity">Capacity (optional)<input id="new-area-capacity" type="number" min="0" value={capacity} onChange={event => setCapacity(event.target.value)} placeholder="Maximum units" /></label>
      <AreaColorPicker value={displayColor} onChange={setDisplayColor} />
      <div className="floor-plan-form__actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" disabled={saving || !code.trim()} className="is-primary">{saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create</button>
      </div>
    </form>
  )
}

function NewFloorForm({ saving, onCancel, onSave }: {
  saving: boolean
  onCancel: () => void
  onSave: (input: { code: string; name: string }) => Promise<void>
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')

  return (
    <form className="floor-plan-form" onSubmit={event => { event.preventDefault(); void onSave({ code, name }) }}>
      <div className="floor-plan-form__intro"><span>New floor</span><h3 id="new-floor-title">Add another floor</h3><p>Create a separate map for another level or distinct storage area.</p></div>
      <label htmlFor="new-floor-code">Floor code<input id="new-floor-code" required autoFocus value={code} onChange={event => setCode(event.target.value)} placeholder="e.g. FLOOR-02" /></label>
      <label htmlFor="new-floor-name">Floor name<input id="new-floor-name" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Upper storage" /></label>
      <div className="floor-plan-form__actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" disabled={saving || !code.trim()} className="is-primary">{saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add floor</button>
      </div>
    </form>
  )
}

function AreaColorPicker({ value, onChange }: { value: AreaColorKey | null; onChange: (value: AreaColorKey | null) => void }) {
  return (
    <fieldset className="floor-plan-color-picker">
      <legend>Area color</legend>
      <p>Use colors to group areas. Occupancy status remains separate.</p>
      <div>
        <button type="button" className={value === null ? 'is-selected is-auto' : 'is-auto'} onClick={() => onChange(null)} aria-label="Automatically color by occupancy" aria-pressed={value === null}>
          <span /><small>Auto</small>
        </button>
        {(Object.entries(AREA_COLORS) as [AreaColorKey, (typeof AREA_COLORS)[AreaColorKey]][]).map(([key, color]) => (
          <button key={key} type="button" className={value === key ? 'is-selected' : ''} onClick={() => onChange(key)} aria-label={`Use ${color.label} for this area`} aria-pressed={value === key}>
            <span style={{ background: color.fill, borderColor: color.stroke }} /><small>{color.label}</small>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function AreaProperties({
  location, stock, productById, products, floors, unplacedStock, stockByLocationId, otherLocations, saving, onSave, onDuplicate, onDelete, onAssignStock,
}: {
  location: WarehouseLocation
  stock: { total: number; lines: { productId: string; qty: number }[] } | undefined
  productById: Map<string, FloorPlanProduct>
  products: FloorPlanProduct[]
  floors: WarehouseLocation[]
  unplacedStock: UnplacedStockRow[]
  stockByLocationId: Map<string, { total: number; lines: { productId: string; qty: number }[] }>
  otherLocations: WarehouseLocation[]
  saving: boolean
  onSave: (patch: { code: string; name: string; locationType: LocationType; parentLocationId: string | null; capacity: string; manualStatus: ManualLocationStatus; notes: string; displayColor: AreaColorKey | null }) => void
  onDuplicate: () => void
  onDelete: () => void
  onAssignStock: (input: { productId: string; fromLocationId: string | null; quantity: number; notes: string }) => void
}) {
  const [code, setCode] = useState(location.code)
  const [name, setName] = useState(location.name ?? '')
  const [locationType, setLocationType] = useState<LocationType>(location.location_type)
  const [parentLocationId, setParentLocationId] = useState(location.parent_location_id ?? '')
  const [capacity, setCapacity] = useState(location.capacity != null ? String(location.capacity) : '')
  const [manualStatus, setManualStatus] = useState<ManualLocationStatus>(location.manual_status)
  const [notes, setNotes] = useState(location.notes ?? '')
  const [displayColor, setDisplayColor] = useState<AreaColorKey | null>((location.display_color as AreaColorKey | null) ?? null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [assignProductId, setAssignProductId] = useState('')
  const [assignFromLocationId, setAssignFromLocationId] = useState('')
  const [assignQty, setAssignQty] = useState('')
  const [assignNotes, setAssignNotes] = useState('')
  const status = effectiveStatus(location, stock?.total ?? 0)
  const sourceInventory = assignFromLocationId
    ? stockByLocationId.get(assignFromLocationId)?.lines ?? []
    : unplacedStock.map(row => ({ productId: row.product_id, qty: row.quantity_on_hand }))
  const availableByProduct = new Map(sourceInventory.map(line => [line.productId, line.qty]))
  const selectedAvailable = assignProductId ? availableByProduct.get(assignProductId) ?? 0 : 0
  const requestedQuantity = Number(assignQty)
  const canAssign = Boolean(assignProductId && requestedQuantity > 0 && requestedQuantity <= selectedAvailable)
  const utilization = location.capacity && stock ? Math.min(999, Math.round((stock.total / location.capacity) * 100)) : null

  return (
    <form className="floor-plan-form" onSubmit={event => { event.preventDefault(); onSave({ code, name, locationType, parentLocationId: parentLocationId || null, capacity, manualStatus, notes, displayColor }) }}>
      <div className="floor-plan-form__head">
        <div><span>Area details</span><h3>{location.name || location.code}</h3></div>
        <span className="floor-plan-status-pill" style={{ background: STATUS_COLOR[status].fill, color: STATUS_COLOR[status].stroke, borderColor: STATUS_COLOR[status].stroke }}>{STATUS_COLOR[status].label}</span>
      </div>

      <section className="floor-plan-selected-contents" aria-label="Area inventory contents">
        <div className="floor-plan-selected-contents__summary">
          <div><Package size={17} /><span><strong>{formatQuantity(stock?.total ?? 0)}</strong><small>Units stored</small></span></div>
          <div><Box size={17} /><span><strong>{stock?.lines.length ?? 0}</strong><small>Products</small></span></div>
          <div><Maximize2 size={17} /><span><strong>{utilization == null ? '—' : `${utilization}%`}</strong><small>Capacity used</small></span></div>
        </div>
        <div className="floor-plan-selected-contents__list">
          {stock?.lines.length ? stock.lines.map(line => {
            const product = productById.get(line.productId)
            return (
              <div key={line.productId}>
                <span className="floor-plan-selected-contents__product-icon"><Package size={14} /></span>
                <span><strong>{product?.name ?? 'Unknown product'}</strong><small>{product?.sku ?? 'No SKU'}</small></span>
                <b>{formatQuantity(line.qty)} <small>units</small></b>
              </div>
            )
          }) : <div className="floor-plan-selected-contents__empty"><Package size={18} /><span>No inventory placed in this area yet.</span></div>}
        </div>
      </section>

      <div className="floor-plan-properties-section-label">Area configuration</div>

      <div className="floor-plan-form__grid">
        <label htmlFor={`area-code-${location.id}`}>Code<input id={`area-code-${location.id}`} required value={code} onChange={event => setCode(event.target.value)} /></label>
        <label htmlFor={`area-name-${location.id}`}>Name<input id={`area-name-${location.id}`} value={name} onChange={event => setName(event.target.value)} /></label>
      </div>
      <label htmlFor={`area-type-${location.id}`}>Type<select id={`area-type-${location.id}`} value={locationType} onChange={event => setLocationType(event.target.value as LocationType)}>
        {STORAGE_AREA_TYPES.map(type => <option key={type} value={type}>{titleCase(type)}</option>)}
      </select></label>
      <label htmlFor={`area-floor-${location.id}`}>Floor<select id={`area-floor-${location.id}`} value={parentLocationId} onChange={event => setParentLocationId(event.target.value)}>
        <option value="">Main floor</option>
        {floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name || floor.code}</option>)}
      </select></label>
      <label htmlFor={`area-capacity-${location.id}`}>Capacity<input id={`area-capacity-${location.id}`} type="number" min="0" value={capacity} onChange={event => setCapacity(event.target.value)} placeholder="Unlimited" /></label>
      <label htmlFor={`area-status-${location.id}`}>Manual status<select id={`area-status-${location.id}`} value={manualStatus ?? ''} onChange={event => setManualStatus((event.target.value || null) as ManualLocationStatus)}>
        <option value="">Auto (from stock level)</option>
        <option value="reserved">Reserved</option>
        <option value="restricted">Restricted</option>
      </select></label>
      <AreaColorPicker value={displayColor} onChange={setDisplayColor} />
      <label htmlFor={`area-notes-${location.id}`}>Notes<textarea id={`area-notes-${location.id}`} rows={2} value={notes} onChange={event => setNotes(event.target.value)} /></label>

      {assigning ? (
        <div className="floor-plan-contents floor-plan-assign">
          <div className="floor-plan-assign__head"><span><ArrowRightLeft size={15} /></span><div><strong>Assign inventory</strong><small>Move available stock into {location.code}</small></div></div>
          <label>Source<select value={assignFromLocationId} onChange={event => { setAssignFromLocationId(event.target.value); setAssignProductId(''); setAssignQty('') }}>
            <option value="">Unassigned inventory</option>
            {otherLocations.map(item => <option key={item.id} value={item.id}>{item.code}</option>)}
          </select></label>
          <label>Product<select required value={assignProductId} onChange={event => { setAssignProductId(event.target.value); setAssignQty('') }}>
            <option value="">Select a product</option>
            {products.map(product => {
              const available = availableByProduct.get(product.id) ?? 0
              return <option key={product.id} value={product.id} disabled={available <= 0}>{product.name} ({product.sku}) — {formatQuantity(available)} available</option>
            })}
          </select></label>
          <div className={`floor-plan-availability ${assignProductId ? 'has-selection' : ''}`}>
            <Package size={16} />
            {assignProductId ? <span><strong>{formatQuantity(selectedAvailable)}</strong> units available from this source</span> : <span>Select a product to see the available quantity.</span>}
          </div>
          <label>Quantity<input required type="number" min="0.001" max={selectedAvailable || undefined} step="0.001" value={assignQty} onChange={event => setAssignQty(event.target.value)} placeholder={assignProductId ? `Maximum ${formatQuantity(selectedAvailable)}` : 'Select a product first'} /></label>
          {assignQty && requestedQuantity > selectedAvailable && <p className="floor-plan-assign__error">Only {formatQuantity(selectedAvailable)} units are available from this source.</p>}
          <label>Notes<input value={assignNotes} onChange={event => setAssignNotes(event.target.value)} placeholder="Optional" /></label>
          <div className="floor-plan-form__actions">
            <button type="button" onClick={() => setAssigning(false)}>Cancel</button>
            <button
              type="button"
              className="is-primary"
              disabled={saving || !canAssign}
              onClick={() => {
                onAssignStock({ productId: assignProductId, fromLocationId: assignFromLocationId || null, quantity: Number(assignQty), notes: assignNotes })
                setAssigning(false)
                setAssignProductId(''); setAssignFromLocationId(''); setAssignQty(''); setAssignNotes('')
              }}
            >{saving ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />} Assign</button>
          </div>
        </div>
      ) : products.length === 0 ? (
        <p className="floor-plan-assign-empty">No stock recorded in this warehouse yet. Receive a shipment or record production output first — then it'll show up here to place.</p>
      ) : (
        <button type="button" className="floor-plan-assign-toggle" onClick={() => setAssigning(true)}><ArrowRightLeft size={14} /> Assign stock here</button>
      )}

      <div className="floor-plan-form__actions">
        <button type="button" onClick={onDuplicate}><Copy size={14} /> Duplicate</button>
        {confirmDelete ? (
          <button type="button" className="is-danger" onClick={onDelete}><Trash2 size={14} /> Confirm delete</button>
        ) : (
          <button type="button" className="is-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Delete</button>
        )}
        <button type="submit" disabled={saving} className="is-primary">{saving ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Save</button>
      </div>
    </form>
  )
}

export default WarehouseFloorPlan
