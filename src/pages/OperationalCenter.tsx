import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, ArrowRight, BellRing, Check, CircleCheck, Clock3, FileText, Inbox, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { completeWorkItem, loadCommandCenter, markNotificationRead, type AppNotification, type AuditEvent, type ErpDocument, type WorkItem } from '../api/operationalCore'
import { DOCUMENT_TYPE_LABELS } from '../lib/materialProfiles'
import { ROLE_LABELS, type Role } from '../lib/roles'
import { useAuth } from '../lib/auth'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import './OperationalCenter.css'

const ROLE_PLAYBOOK: Record<Role, { mission:string; actions:Array<{label:string;to:string}>; watch:string[] }> = {
  full_access:{mission:'Direct the company through exceptions, approvals and cross-company performance.',actions:[{label:'Company dashboard',to:'/'},{label:'Approval inbox',to:'/work'},{label:'Financial reports',to:'/reports'},{label:'Users & access',to:'/users'}],watch:['High-value approvals','Warehouse exceptions','Cash and payroll exposure']},
  accounting_finance:{mission:'Protect cash, approve financial consequences and keep operational postings reconciled.',actions:[{label:'Money tracking',to:'/money-tracking'},{label:'Payables',to:'/payables'},{label:'Payroll review',to:'/payroll'},{label:'Documents',to:'/documents'}],watch:['Payroll journals','Unposted receipts','Supplier commitments']},
  operations_marketing:{mission:'Move supplier commitments through packing, shipping, customs and warehouse receipt.',actions:[{label:'Proforma invoices',to:'/proforma-invoices'},{label:'Shipments',to:'/shipments'},{label:'Receiving',to:'/warehouse-operations'},{label:'Documents',to:'/documents'}],watch:['Packing discrepancies','Port milestones','Unreceived transfers']},
  manufacturing_sales:{mission:'Turn available materials into traceable finished goods and fulfill demand.',actions:[{label:'Production',to:'/warehouse-operations'},{label:'BOMs',to:'/boms'},{label:'Inventory',to:'/inventory'},{label:'Sales',to:'/sales'}],watch:['SKD shortages','Finished-goods posting','Reserved stock']},
  hr_system:{mission:'Maintain accountable people, access and payroll review across head office and warehouses.',actions:[{label:'Employees',to:'/employees'},{label:'Payroll',to:'/payroll'},{label:'Users & roles',to:'/users'},{label:'HR guidance',to:'/hr-notes'}],watch:['Pending access','Warehouse payroll submissions','Attendance exceptions']},
  warehouse_operations:{mission:'Receive, place, produce and transfer stock inside the warehouses assigned to you.',actions:[{label:'Warehouse workspace',to:'/warehouse-operations'},{label:'Receiving dock',to:'/warehouse-operations'},{label:'Documents',to:'/documents'},{label:'Guidance',to:'/documentation'}],watch:['Incoming loads','Unplaced inventory','Attendance and production tasks']},
}

export function OperationalCenter() {
  const { profile }=useAuth(); const role=(profile?.role==='pending'?null:profile?.role) as Role|null
  const [data,setData]=useState<{work:WorkItem[];notifications:AppNotification[];documents:ErpDocument[];audit:AuditEvent[];unavailable:string[]}>({work:[],notifications:[],documents:[],audit:[],unavailable:[]})
  const [loading,setLoading]=useState(true); const [error,setError]=useState<string|null>(null)
  const playbook=role?ROLE_PLAYBOOK[role]:null
  const load=()=>{setLoading(true);setError(null);loadCommandCenter().then(setData).catch(error=>setError(error.message)).finally(()=>setLoading(false))}
  useEffect(()=>{const timer=window.setTimeout(load,0);return()=>window.clearTimeout(timer)},[])
  const urgent=useMemo(()=>data.work.filter(item=>item.priority==='critical'||item.priority==='high'),[data.work])
  async function finish(id:string){try{await completeWorkItem(id);setData(current=>({...current,work:current.work.filter(item=>item.id!==id)}))}catch(error){setError(error instanceof Error?error.message:'Task could not be completed.')}}
  async function read(item:AppNotification){if(item.read_at)return;try{await markNotificationRead(item.id);setData(current=>({...current,notifications:current.notifications.map(value=>value.id===item.id?{...value,read_at:new Date().toISOString()}:value)}))}catch{/* notification remains unread */}}
  return <main className="ops-page">
    <PageHeader title="My work" subtitle="Approvals, exceptions and next actions assembled for your role." actions={<Button variant="secondary" icon={<RefreshCw size={15}/>} loading={loading} onClick={load}>Refresh</Button>} />
    {playbook&&<section className="role-brief"><div><span>{ROLE_LABELS[role!]}</span><h2>{playbook.mission}</h2><div className="role-actions">{playbook.actions.map(action=><Link key={action.to+action.label} to={action.to}>{action.label}<ArrowRight/></Link>)}</div></div><aside><b>Watch today</b>{playbook.watch.map(item=><span key={item}><ShieldCheck/>{item}</span>)}</aside></section>}
    {error&&<div className="ops-error">{error.includes('does not exist')?'Apply migration 20260820 to activate the command center.':error}</div>}
    {!!data.unavailable.length&&<div className="ops-notice"><AlertTriangle/>Some command-center sources are not deployed yet. Existing modules remain available.</div>}
    <section className="ops-kpis"><Kpi icon={<Inbox/>} label="Open work" value={data.work.length} note={`${urgent.length} high priority`} /><Kpi icon={<BellRing/>} label="Unread alerts" value={data.notifications.filter(item=>!item.read_at).length} note="Actionable notifications" /><Kpi icon={<FileText/>} label="Documents moving" value={data.documents.filter(item=>!['posted','cancelled'].includes(item.status)).length} note="Across the document lifecycle" /><Kpi icon={<Activity/>} label="Recent changes" value={data.audit.length} note="Visible accountability history" /></section>
    <div className="ops-grid">
      <section className="ops-panel work-queue"><header><div><span className="ops-eyebrow">Action queue</span><h2>What needs you</h2></div><b>{data.work.length}</b></header>{loading?<div className="ops-empty">Loading your work…</div>:data.work.length?data.work.map(item=><article key={item.id}><i className={`priority-${item.priority}`}><Clock3/></i><div><strong>{item.title}</strong><p>{item.description||item.work_type.replaceAll('_',' ')}</p><small>{item.due_at?`Due ${new Date(item.due_at).toLocaleString()}`:'No fixed deadline'}</small></div>{item.action_url&&<Link to={item.action_url} aria-label={`Open ${item.title}`}><ArrowRight/></Link>}<button onClick={()=>void finish(item.id)} aria-label={`Complete ${item.title}`}><Check/></button></article>):<div className="ops-empty"><CircleCheck/><h3>Queue is clear</h3><p>New approvals and exceptions will appear here.</p></div>}</section>
      <section className="ops-panel alert-feed"><header><div><span className="ops-eyebrow">Notifications</span><h2>Signals requiring attention</h2></div><Link to="/documents">Documents <ArrowRight/></Link></header>{data.notifications.length?data.notifications.map(item=><article key={item.id} className={`severity-${item.severity} ${item.read_at?'is-read':''}`} onClick={()=>void read(item)}><i><BellRing/></i><div><strong>{item.title}</strong><p>{item.message||item.category}</p><small>{new Date(item.created_at).toLocaleString()}</small></div>{item.action_url&&<Link to={item.action_url}>{item.action_label||'Open'}<ArrowRight/></Link>}</article>):<div className="ops-empty"><Sparkles/><h3>No active alerts</h3><p>Receiving, inventory, shipment, payroll and approval alerts will collect here.</p></div>}</section>
      <section className="ops-panel document-pulse"><header><div><span className="ops-eyebrow">Document lifecycle</span><h2>Recently moving records</h2></div><Link to="/documents">Open register <ArrowRight/></Link></header>{data.documents.length?data.documents.map(item=><Link to="/documents" key={item.id}><i><FileText/></i><span><strong>{item.document_number}</strong><small>{DOCUMENT_TYPE_LABELS[item.document_type]}</small></span><em className={`doc-status is-${item.status}`}>{item.status}</em><b>{Number(item.total_amount).toLocaleString()} {item.currency}</b></Link>):<div className="ops-empty">Universal documents will appear after migration.</div>}</section>
      <section className="ops-panel audit-feed"><header><div><span className="ops-eyebrow">Accountability</span><h2>Recent system history</h2></div><Activity/></header>{data.audit.length?data.audit.map(item=><article key={item.id}><i/><div><strong>{item.summary}</strong><p>{actorName(item)} · {new Date(item.created_at).toLocaleString()}</p></div></article>):<div className="ops-empty">Role, document, approval and posting changes will create an immutable history.</div>}</section>
    </div>
  </main>
}
function actorName(item:AuditEvent){const value=Array.isArray(item.profiles)?item.profiles[0]:item.profiles;return value?.full_name||'System'}
function Kpi({icon,label,value,note}:{icon:React.ReactNode;label:string;value:number;note:string}){return <article><i>{icon}</i><span>{label}<strong>{value}</strong><small>{note}</small></span></article>}
