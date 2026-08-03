import { useEffect, useMemo, useState } from 'react'
import { Archive, ArrowRight, ChevronDown, ChevronRight, CircleDollarSign, FilePlus2, FileText, Link2, PackageCheck, Plus, Search, Send, X } from 'lucide-react'
import { createErpDocument, listErpDocuments, transitionErpDocument, type DocumentStatus, type DocumentType, type ErpDocument, type ErpDocumentLine, type MaterialKind } from '../api/operationalCore'
import { DOCUMENT_FLOW, DOCUMENT_TYPE_LABELS, MATERIAL_EXAMPLES, MATERIAL_KIND_LABELS } from '../lib/materialProfiles'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import './OperationalCenter.css'

const N = (value: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 2 }).format(value)
const CURRENT_YEAR = new Date().getFullYear()
const blankLine = (): ErpDocumentLine => ({ line_number: 1, description: '', material_kind: 'finished_product', quantity: 0, uom: 'PCS', pack_uom: 'CTN', unit_price: 0 })

export function Documents() {
  const [documents, setDocuments] = useState<ErpDocument[]>([])
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | DocumentType>('all')
  const [status, setStatus] = useState<'all' | DocumentStatus>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => { setLoading(true); listErpDocuments().then(setDocuments).catch(error => setError(error.message)).finally(() => setLoading(false)) }
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer) }, [])

  const filtered = useMemo(() => documents.filter(document => {
    const matchesQuery = `${document.document_number} ${document.title ?? ''} ${document.counterparty_name ?? ''}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (type === 'all' || document.document_type === type) && (status === 'all' || document.status === status)
  }), [documents, query, type, status])

  async function transition(document: ErpDocument, next: DocumentStatus) {
    setError(null)
    try { await transitionErpDocument(document.id, next); load() } catch (error) { setError(error instanceof Error ? error.message : 'Document could not be updated.') }
  }

  return <main className="ops-page documents-page">
    <PageHeader title="Documents" subtitle="One traceable register from supplier proforma to accounting and delivery." actions={<Button icon={<FilePlus2 size={16} />} onClick={() => setCreating(true)}>New document</Button>} />
    <section className="document-flow" aria-label="Document lifecycle">
      {DOCUMENT_FLOW.map((item, index) => <div key={item}><span>{index + 1}</span><b>{DOCUMENT_TYPE_LABELS[item]}</b>{index < DOCUMENT_FLOW.length - 1 && <ArrowRight />}</div>)}
    </section>
    <section className="ops-kpis">
      <Kpi icon={<FileText />} label="Active documents" value={documents.filter(item => !['posted','cancelled'].includes(item.status)).length} note="Across operational workflows" />
      <Kpi icon={<Send />} label="Awaiting approval" value={documents.filter(item => item.status === 'submitted').length} note="Requires accountable review" />
      <Kpi icon={<PackageCheck />} label="Posted" value={documents.filter(item => item.status === 'posted').length} note="Locked in operational history" />
      <Kpi icon={<CircleDollarSign />} label="Registered value" value={documents.reduce((sum, item) => sum + Number(item.total_amount), 0)} note="Mixed document currencies" money />
    </section>
    {error && <div className="ops-error">{error.includes('does not exist') ? 'The operational command-center migration must be applied before this register can load.' : error}</div>}
    <section className="ops-panel">
      <div className="ops-toolbar">
        <label className="ops-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search document, supplier, customer or reference" /></label>
        <select aria-label="Document type" value={type} onChange={event => setType(event.target.value as typeof type)}><option value="all">All document types</option>{Object.entries(DOCUMENT_TYPE_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select aria-label="Document status" value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option>{['draft','submitted','approved','rejected','posted','cancelled'].map(item => <option key={item} value={item}>{item}</option>)}</select>
      </div>
      <div className="document-table-head"><span>Document</span><span>Counterparty</span><span>Status</span><span>Lines</span><span>Value</span><span /></div>
      <div className="document-register">
        {loading ? <div className="ops-empty">Loading document register…</div> : filtered.map(document => {
          const open = expanded === document.id
          return <article key={document.id} className={`document-row ${open ? 'open' : ''}`}>
            <button className="document-summary" onClick={() => setExpanded(open ? null : document.id)}>
              <span className="document-identity"><i>{open ? <ChevronDown /> : <ChevronRight />}</i><b>{document.document_number}<small>{DOCUMENT_TYPE_LABELS[document.document_type]} · {new Date(document.issue_date).toLocaleDateString()}</small></b></span>
              <span>{document.counterparty_name ?? 'Internal document'}</span><span><em className={`doc-status is-${document.status}`}>{document.status}</em></span><strong>{document.erp_document_lines?.length ?? 0}</strong><strong>{N(document.total_amount)} {document.currency}</strong><ChevronRight />
            </button>
            {open && <div className="document-detail">
              <div className="document-line-list"><h3>Material lines</h3>{document.erp_document_lines?.length ? document.erp_document_lines.map(line => <div key={line.id ?? line.line_number}><span><b>{line.description}</b><small>{MATERIAL_KIND_LABELS[line.material_kind]} · {line.hs_code || 'No HS code'} · {line.origin_country || 'Origin not set'}</small></span><span>{N(line.pack_count ?? 0)} {line.pack_uom || 'CTN'}<small>{N(line.units_per_pack ?? 0)} per pack</small></span><strong>{N(line.quantity)} {line.uom}</strong></div>) : <p>No lines have been added.</p>}</div>
              <aside><h3>Traceability</h3><p><Link2 /> Source and generated documents will appear here as this record moves through the workflow.</p><dl><div><dt>External reference</dt><dd>{document.external_reference ?? '—'}</dd></div><div><dt>Last updated</dt><dd>{new Date(document.updated_at).toLocaleString()}</dd></div></dl><div className="document-actions">{document.status === 'draft' && <Button onClick={() => void transition(document,'submitted')}>Submit for approval</Button>}{document.status === 'submitted' && <><Button onClick={() => void transition(document,'approved')}>Approve</Button><Button variant="secondary" onClick={() => void transition(document,'rejected')}>Reject</Button></>}{document.status === 'approved' && <Button onClick={() => void transition(document,'posted')}>Post document</Button>}</div></aside>
            </div>}
          </article>
        })}
        {!loading && !filtered.length && <div className="ops-empty"><Archive /><h2>No matching documents</h2><p>Create the first document or change the filters.</p></div>}
      </div>
    </section>
    {creating && <CreateDocument onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load() }} />}
  </main>
}

function Kpi({ icon,label,value,note,money }: { icon: React.ReactNode; label:string; value:number; note:string; money?:boolean }) { return <article><i>{icon}</i><span>{label}<strong>{N(value)}{money ? ' ETB' : ''}</strong><small>{note}</small></span></article> }

function CreateDocument({ onClose, onCreated }: { onClose:()=>void; onCreated:()=>void }) {
  const [documentType,setDocumentType]=useState<DocumentType>('packing_list'); const [number,setNumber]=useState(`DOC-${CURRENT_YEAR}-`)
  const [counterparty,setCounterparty]=useState(''); const [currency,setCurrency]=useState('USD'); const [reference,setReference]=useState(''); const [lines,setLines]=useState<ErpDocumentLine[]>([blankLine()]); const [saving,setSaving]=useState(false); const [error,setError]=useState<string|null>(null)
  const updateLine=(index:number,patch:Partial<ErpDocumentLine>)=>setLines(current=>current.map((line,i)=>i===index?{...line,...patch}:line))
  const total=lines.reduce((sum,line)=>sum+Number(line.quantity||0)*Number(line.unit_price||0),0)
  async function save(){ if(!number.trim()||lines.some(line=>!line.description.trim()||line.quantity<=0)){setError('Add a document number and complete every material line.');return} setSaving(true);setError(null);try{await createErpDocument({document_number:number.trim(),document_type:documentType,title:DOCUMENT_TYPE_LABELS[documentType],issue_date:new Date().toISOString().slice(0,10),counterparty_name:counterparty||null,currency,subtotal:total,total_amount:total,source_operational_unit_id:null,destination_operational_unit_id:null,external_reference:reference||null,notes:null,lines});onCreated()}catch(error){setError(error instanceof Error?error.message:'Document could not be created.')}finally{setSaving(false)}}
  return <div className="ops-modal-backdrop" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><section className="ops-modal" role="dialog" aria-modal="true" aria-labelledby="create-document-title"><header><div><span>Controlled record</span><h2 id="create-document-title">Create ERP document</h2><p>Capture commercial, packing, customs and SKD details once for every downstream stage.</p></div><button onClick={onClose} aria-label="Close"><X /></button></header><div className="document-form-head"><label>Document type<select value={documentType} onChange={event=>setDocumentType(event.target.value as DocumentType)}>{Object.entries(DOCUMENT_TYPE_LABELS).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label>Document number<input value={number} onChange={event=>setNumber(event.target.value)} /></label><label>Supplier / customer<input value={counterparty} onChange={event=>setCounterparty(event.target.value)} placeholder="e.g. Yiwu Wal-Giaco" /></label><label>Currency<select value={currency} onChange={event=>setCurrency(event.target.value)}><option>USD</option><option>ETB</option><option>CNY</option></select></label><label>External reference<input value={reference} onChange={event=>setReference(event.target.value)} placeholder="Invoice, permit or declaration" /></label></div><div className="material-lines-head"><div><h3>Material lines</h3><p>Supports finished goods, SKD parts, packaging, spares and customs valuation.</p></div><Button variant="secondary" icon={<Plus size={15}/>} onClick={()=>setLines(current=>[...current,{...blankLine(),line_number:current.length+1}])}>Add line</Button></div><div className="material-lines">{lines.map((line,index)=><article key={index}><div className="material-line-title"><b>Line {index+1}</b>{lines.length>1&&<button onClick={()=>setLines(current=>current.filter((_,i)=>i!==index))} aria-label={`Remove line ${index+1}`}><X/></button>}</div><div className="material-grid"><label className="wide">Description<input value={line.description} onChange={event=>updateLine(index,{description:event.target.value})} placeholder={MATERIAL_EXAMPLES[line.material_kind]} /></label><label>Material class<select value={line.material_kind} onChange={event=>updateLine(index,{material_kind:event.target.value as MaterialKind})}>{Object.entries(MATERIAL_KIND_LABELS).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label>Model / size<input value={line.specification??''} onChange={event=>updateLine(index,{specification:event.target.value})} placeholder="TK22, 24cm, 2.2L" /></label><label>HS code<input value={line.hs_code??''} onChange={event=>updateLine(index,{hs_code:event.target.value})} /></label><label>Origin<input value={line.origin_country??''} onChange={event=>updateLine(index,{origin_country:event.target.value})} placeholder="CN" /></label><label>Cartons<input type="number" min="0" value={line.pack_count??''} onChange={event=>updateLine(index,{pack_count:Number(event.target.value)})} /></label><label>Units / carton<input type="number" min="0" value={line.units_per_pack??''} onChange={event=>updateLine(index,{units_per_pack:Number(event.target.value)})} /></label><label>Quantity<input type="number" min="0" value={line.quantity||''} onChange={event=>updateLine(index,{quantity:Number(event.target.value)})} /></label><label>UOM<select value={line.uom} onChange={event=>updateLine(index,{uom:event.target.value})}><option>PCS</option><option>SET</option><option>KG</option><option>DOZ</option><option>CTN</option></select></label><label>Unit price<input type="number" min="0" step="0.01" value={line.unit_price||''} onChange={event=>updateLine(index,{unit_price:Number(event.target.value)})} /></label><label>Net kg<input type="number" min="0" step="0.01" value={line.net_weight_kg??''} onChange={event=>updateLine(index,{net_weight_kg:Number(event.target.value)})} /></label><label>Gross kg<input type="number" min="0" step="0.01" value={line.gross_weight_kg??''} onChange={event=>updateLine(index,{gross_weight_kg:Number(event.target.value)})} /></label><label>CBM<input type="number" min="0" step="0.001" value={line.cbm??''} onChange={event=>updateLine(index,{cbm:Number(event.target.value)})} /></label>{line.material_kind==='skd_component'&&<label>BOM qty / finished<input type="number" min="0" value={line.bom_quantity_per_finished??''} onChange={event=>updateLine(index,{bom_quantity_per_finished:Number(event.target.value)})} /></label>}</div></article>)}</div>{error&&<div className="ops-error">{error}</div>}<footer><div><span>Document total</span><strong>{N(total)} {currency}</strong></div><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={()=>void save()}>Create document</Button></footer></section></div>
}
