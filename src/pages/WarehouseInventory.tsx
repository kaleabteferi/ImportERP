import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowDownUp, Boxes, ChevronDown, ChevronRight, Factory, Map, PackageOpen, Search, Truck, Warehouse } from 'lucide-react'
import { fetchWarehouseInventory, listWarehouses, type WarehouseInventoryWorkspace, type WarehouseSummary } from '../api/warehouseInventory'
import './WarehouseInventory.css'

const N = (value: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(value)
const MONEY = (value: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(value)

export default function WarehouseInventory() {
  const { warehouseId = '' } = useParams()
  const navigate = useNavigate()
  const [warehouses, setWarehouses] = useState<WarehouseSummary[]>([])
  const [data, setData] = useState<WarehouseInventoryWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [classification, setClassification] = useState('ALL')
  const [placement, setPlacement] = useState<'ALL' | 'PLACED' | 'UNPLACED'>('ALL')
  const [sortBy, setSortBy] = useState<'NAME' | 'QUANTITY' | 'VALUE' | 'UNPLACED'>('NAME')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => { listWarehouses().then(setWarehouses).catch(error => setError(error.message)) }, [])
  useEffect(() => {
    if (!warehouseId) return
    const timer = window.setTimeout(() => {
      setLoading(true); setError(null)
      fetchWarehouseInventory(warehouseId).then(setData).catch(error => setError(error.message)).finally(() => setLoading(false))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [warehouseId])

  const items = useMemo(() => (data?.items ?? []).filter(item => {
    const matchesText = `${item.name} ${item.sku}`.toLowerCase().includes(query.toLowerCase())
    const matchesPlacement = placement === 'ALL' || (placement === 'UNPLACED' ? item.unplaced > 0 : item.unplaced <= 0)
    return matchesText && matchesPlacement && (classification === 'ALL' || item.assemblyType === classification)
  }).sort((a, b) => {
    if (sortBy === 'QUANTITY') return b.quantity - a.quantity
    if (sortBy === 'VALUE') return b.value - a.value
    if (sortBy === 'UNPLACED') return b.unplaced - a.unplaced
    return a.name.localeCompare(b.name)
  }), [data, query, classification, placement, sortBy])
  const totalUnits = (data?.items ?? []).reduce((sum, item) => sum + item.quantity, 0)
  const totalValue = (data?.items ?? []).reduce((sum, item) => sum + item.value, 0)
  const unplaced = (data?.items ?? []).reduce((sum, item) => sum + Math.max(0, item.unplaced), 0)

  return <main className="warehouse-inventory-page">
    <header className="wi-header">
      <div><Link to={`/warehouse-operations?unit=all&tab=locations`} className="wi-back">Warehouse operations</Link><h1>Warehouse inventory</h1><p>See what this warehouse holds, where it sits, and its latest movement.</p></div>
      <div className="wi-header-actions">
        <select aria-label="Warehouse" value={warehouseId} onChange={event => navigate(`/warehouse-operations/inventory/${event.target.value}`)}>{warehouses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <Link className="wi-button secondary" to={`/warehouse-operations/floor-plan/${warehouseId}?name=${encodeURIComponent(data?.warehouse.name ?? 'Warehouse')}`}><Map size={16} /> Inventory locations</Link>
        <Link className="wi-button primary" to={`/warehouse-operations/receiving/${warehouseId}`}><Truck size={16} /> Receive truck</Link>
      </div>
    </header>

    {error && <div className="wi-error">{error}</div>}
    {loading ? <div className="wi-loading">Loading warehouse inventory…</div> : data && <>
      <section className="wi-metrics">
        <Metric icon={<Boxes />} label="Products held" value={N(data.items.length)} note={`${new Set(data.items.map(item => item.assemblyType)).size} classifications`} />
        <Metric icon={<PackageOpen />} label="Units on hand" value={N(totalUnits)} note={`${N(data.items.reduce((sum, item) => sum + item.placed, 0))} placed`} />
        <Metric icon={<Map />} label="Needs placement" value={N(unplaced)} note={unplaced ? 'Assign to a floor-plan area' : 'Everything has a location'} alert={unplaced > 0} />
        <Metric icon={<Warehouse />} label="Inventory value" value={`${MONEY(totalValue)} ETB`} note={`${data.locations.length} active storage areas`} />
      </section>

      <section className="wi-panel">
        <div className="wi-view-strip" aria-label="Inventory placement views">
          <button className={placement === 'ALL' ? 'active' : ''} onClick={() => setPlacement('ALL')}><span>All products</span><b>{N(data.items.length)}</b></button>
          <button className={placement === 'PLACED' ? 'active' : ''} onClick={() => setPlacement('PLACED')}><span>Fully located</span><b>{N(data.items.filter(item => item.unplaced <= 0).length)}</b></button>
          <button className={placement === 'UNPLACED' ? 'active attention' : 'attention'} onClick={() => setPlacement('UNPLACED')}><span>Needs placement</span><b>{N(data.items.filter(item => item.unplaced > 0).length)}</b></button>
        </div>
        <div className="wi-toolbar">
          <div className="wi-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search product or SKU" /></div>
          <div className="wi-toolbar-right">
            <div className="wi-filters">{['ALL', 'FULL', 'IMPORTED', 'SKD', 'CKD'].map(value => <button key={value} className={classification === value ? 'active' : ''} onClick={() => setClassification(value)}>{value === 'ALL' ? 'All classes' : value}</button>)}</div>
            <label className="wi-sort"><ArrowDownUp size={15} /><span>Sort</span><select value={sortBy} onChange={event => setSortBy(event.target.value as typeof sortBy)}><option value="NAME">Product name</option><option value="QUANTITY">Highest stock</option><option value="VALUE">Highest value</option><option value="UNPLACED">Needs placement</option></select></label>
          </div>
        </div>
        <div className="wi-list-heading"><span>Product</span><span>Classification</span><span>Placement</span><span>On hand</span><span>Value</span></div>
        <div className="wi-list">
          {items.map(item => {
            const open = expanded === item.productId
            const placementPct = item.quantity > 0 ? Math.min(100, item.placed / item.quantity * 100) : 100
            return <article key={item.productId} className={`wi-item ${open ? 'open' : ''}`}>
              <button className="wi-item-summary" onClick={() => setExpanded(open ? null : item.productId)}>
                <span className="wi-product"><i>{open ? <ChevronDown /> : <ChevronRight />}</i><b>{item.name}<small>{item.sku} · {item.unitOfMeasure}</small></b></span>
                <span><em className={`wi-type type-${item.assemblyType.toLowerCase()}`}>{item.assemblyType}</em></span>
                <span className="wi-placement"><span><b>{N(item.placed)}</b> placed · <b>{N(item.unplaced)}</b> unassigned</span><i><u style={{ width: `${placementPct}%` }} /></i></span>
                <strong>{N(item.quantity)}</strong><strong>{MONEY(item.value)} ETB</strong>
              </button>
              {open && <div className="wi-detail">
                <div><h3>Storage locations</h3>{item.locations.length ? item.locations.map(location => <div className="wi-detail-row" key={location.id}><span><Map size={14} />{location.code}<small>{location.name}</small></span><b>{N(location.quantity)} {item.unitOfMeasure}</b></div>) : <p>No stock has been assigned to a location yet.</p>}{item.unplaced > 0 && <Link to={`/warehouse-operations/floor-plan/${warehouseId}?name=${encodeURIComponent(data.warehouse.name)}`}>Place {N(item.unplaced)} unassigned units on floor plan →</Link>}</div>
                <div><h3>Recent movement</h3>{item.movements.length ? item.movements.map(movement => <div className="wi-detail-row" key={movement.id}><span>{movement.type.replaceAll('_', ' ')}<small>{new Date(movement.date).toLocaleDateString()}</small></span><b className={movement.quantity >= 0 ? 'positive' : 'negative'}>{movement.quantity >= 0 ? '+' : ''}{N(movement.quantity)}</b></div>) : <p>No recent movements.</p>}</div>
                <div className="wi-product-facts"><h3>Item details</h3><dl><div><dt>Average unit cost</dt><dd>{MONEY(item.averageCost)} ETB</dd></div><div><dt>Total value</dt><dd>{MONEY(item.value)} ETB</dd></div><div><dt>Assembly class</dt><dd>{item.assemblyType}</dd></div><div><dt>Warehouse</dt><dd>{data.warehouse.name}</dd></div></dl></div>
              </div>}
            </article>
          })}
          {!items.length && <div className="wi-empty"><Factory /><h2>No matching inventory</h2><p>Change the search or classification filter.</p></div>}
        </div>
      </section>
    </>}
  </main>
}

function Metric({ icon, label, value, note, alert }: { icon: ReactNode; label: string; value: string; note: string; alert?: boolean }) {
  return <article className={alert ? 'alert' : ''}><i>{icon}</i><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>
}
