import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Anchor, Box, ChevronRight, Container, Loader2, Search, Ship, Truck } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface MobileShipment { id: string; shipment_number: string; container_number: string | null; status: string; eta_djibouti: string | null; arrived_addis_date: string | null; suppliers: { name: string } | { name: string }[] | null }
const ACTIVE = ['ORDERED', 'IN_PRODUCTION', 'SHIPPED', 'AT_DJIBOUTI', 'IN_TRANSIT', 'AT_CUSTOMS']
const one = <T,>(value: T | T[] | null): T | null => Array.isArray(value) ? value[0] ?? null : value

export function MobileShipments() {
  const [rows, setRows] = useState<MobileShipment[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState<'active' | 'arrived' | 'all'>('active')
  const load = useCallback(async () => { setLoading(true); setError(null); const { data, error } = await supabase.from('shipments').select('id, shipment_number, container_number, status, eta_djibouti, arrived_addis_date, suppliers(name)').order('created_at', { ascending: false }).limit(100); if (error) setError(error.message); else setRows((data ?? []) as MobileShipment[]); setLoading(false) }, [])
  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])
  const visible = useMemo(() => rows.filter(row => { const arrived = ['WAREHOUSE_RECEIVED', 'COMPLETED'].includes(row.status); const group = filter === 'all' || (filter === 'arrived' ? arrived : ACTIVE.includes(row.status)); return group && `${row.shipment_number} ${row.container_number ?? ''} ${one(row.suppliers)?.name ?? ''}`.toLowerCase().includes(search.toLowerCase()) }), [rows, search, filter])
  const inTransit = rows.filter(row => ['SHIPPED', 'AT_DJIBOUTI', 'IN_TRANSIT', 'AT_CUSTOMS'].includes(row.status)).length
  return <div className="mobile-surface mobile-shipments">
    <header className="mobile-page-intro"><div><span>Inbound logistics</span><h1>Shipment board</h1><p>Track containers from supplier to warehouse receipt.</p></div><button className="mobile-icon-button" onClick={load} aria-label="Refresh shipments"><Ship /></button></header>
    <section className="mobile-shipment-stats"><div><Ship /><span>Moving now<b>{inTransit}</b></span></div><div><Anchor /><span>At port/customs<b>{rows.filter(row => ['AT_DJIBOUTI', 'AT_CUSTOMS'].includes(row.status)).length}</b></span></div><div><Box /><span>Received<b>{rows.filter(row => ['WAREHOUSE_RECEIVED', 'COMPLETED'].includes(row.status)).length}</b></span></div></section>
    <div className="mobile-money-tools"><div><Search /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Shipment or container" /></div></div>
    <div className="mobile-periods">{(['active', 'arrived', 'all'] as const).map(value => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value === 'active' ? 'In progress' : value === 'arrived' ? 'Received' : 'All'}</button>)}</div>
    {error && <div className="mobile-alert is-error">{error}</div>}
    {loading ? <div className="mobile-state"><Loader2 className="animate-spin" />Loading shipments…</div> : <div className="mobile-shipment-list">{visible.map(row => { const supplier = one(row.suppliers)?.name ?? 'Supplier not assigned'; const date = row.arrived_addis_date ?? row.eta_djibouti; return <Link to={`/shipments/${row.id}`} key={row.id}><i><Container /></i><div><span className={`shipment-state state-${row.status.toLowerCase()}`}>{row.status.replaceAll('_', ' ')}</span><b>{row.shipment_number}</b><small>{supplier}{row.container_number ? ` · ${row.container_number}` : ''}</small><em>{date ? `${row.arrived_addis_date ? 'Arrived' : 'ETA'} ${new Date(date).toLocaleDateString()}` : 'Schedule not set'}</em></div><ChevronRight /></Link> })}{!visible.length && <div className="mobile-state"><Truck /><span>No shipments match this view.</span></div>}</div>}
  </div>
}
