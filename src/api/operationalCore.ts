import { supabase } from '../lib/supabase'

export type DocumentType = 'proforma_invoice' | 'purchase_order' | 'packing_list' | 'container_plan' | 'customs_declaration' | 'goods_receipt' | 'warehouse_transfer' | 'production_order' | 'finished_goods_receipt' | 'sales_order' | 'delivery_note' | 'sales_invoice' | 'payroll_journal'
export type DocumentStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'posted' | 'cancelled'
export type MaterialKind = 'finished_product' | 'skd_component' | 'packaging_material' | 'spare_part' | 'raw_material'

export interface ErpDocumentLine {
  id?: string
  line_number: number
  product_id?: string | null
  description: string
  material_kind: MaterialKind
  hs_code?: string | null
  origin_country?: string | null
  model_number?: string | null
  specification?: string | null
  quantity: number
  uom: string
  pack_count?: number | null
  pack_uom?: string | null
  units_per_pack?: number | null
  unit_price: number
  declared_unit_value?: number | null
  assessed_unit_value?: number | null
  net_weight_kg?: number | null
  gross_weight_kg?: number | null
  carton_length_cm?: number | null
  carton_width_cm?: number | null
  carton_height_cm?: number | null
  cbm?: number | null
  bom_quantity_per_finished?: number | null
  accepted_quantity?: number | null
  rejected_quantity?: number | null
}

export interface ErpDocument {
  id: string
  document_number: string
  document_type: DocumentType
  status: DocumentStatus
  title: string | null
  issue_date: string
  counterparty_name: string | null
  currency: string
  subtotal: number
  total_amount: number
  source_operational_unit_id: string | null
  destination_operational_unit_id: string | null
  external_reference: string | null
  notes: string | null
  created_at: string
  updated_at: string
  erp_document_lines?: ErpDocumentLine[]
}

export interface WorkItem {
  id: string; title: string; description: string | null; work_type: string; priority: 'low' | 'medium' | 'high' | 'critical'; status: string
  action_url: string | null; due_at: string | null; entity_type: string | null; entity_id: string | null; created_at: string
}
export interface AppNotification {
  id: string; category: string; severity: 'info' | 'success' | 'warning' | 'critical'; title: string; message: string | null
  action_label: string | null; action_url: string | null; read_at: string | null; created_at: string
}
export interface AuditEvent {
  id: number; action: string; entity_type: string; entity_id: string; summary: string; created_at: string
  profiles?: { full_name: string | null } | Array<{ full_name: string | null }> | null
}

export async function listErpDocuments(): Promise<ErpDocument[]> {
  const { data, error } = await supabase.from('erp_documents').select('*, erp_document_lines(*)').order('issue_date', { ascending: false }).limit(100)
  if (error) throw error
  return (data ?? []) as ErpDocument[]
}

export async function createErpDocument(input: Omit<ErpDocument, 'id' | 'status' | 'created_at' | 'updated_at' | 'erp_document_lines'> & { status?: DocumentStatus; lines: ErpDocumentLine[] }): Promise<string> {
  const { lines, ...document } = input
  const { data, error } = await supabase.from('erp_documents').insert(document).select('id').single()
  if (error) throw error
  if (lines.length) {
    const { error: lineError } = await supabase.from('erp_document_lines').insert(lines.map((line, index) => ({ ...line, document_id: data.id, line_number: index + 1 })))
    if (lineError) {
      await supabase.from('erp_documents').delete().eq('id', data.id)
      throw lineError
    }
  }
  return data.id as string
}

export async function transitionErpDocument(id: string, status: DocumentStatus): Promise<void> {
  const patch: Record<string, unknown> = { status }
  if (status === 'approved') patch.approved_at = new Date().toISOString()
  if (status === 'posted') patch.posted_at = new Date().toISOString()
  const { error } = await supabase.from('erp_documents').update(patch).eq('id', id)
  if (error) throw error
}

export async function loadCommandCenter() {
  const [work, notifications, documents, audit] = await Promise.all([
    supabase.from('work_items').select('id,title,description,work_type,priority,status,action_url,due_at,entity_type,entity_id,created_at').in('status', ['open', 'in_progress', 'blocked']).order('due_at', { ascending: true, nullsFirst: false }).limit(20),
    supabase.from('app_notifications').select('id,category,severity,title,message,action_label,action_url,read_at,created_at').is('dismissed_at', null).order('created_at', { ascending: false }).limit(20),
    supabase.from('erp_documents').select('id,document_number,document_type,status,title,issue_date,counterparty_name,currency,subtotal,total_amount,source_operational_unit_id,destination_operational_unit_id,external_reference,notes,created_at,updated_at').order('updated_at', { ascending: false }).limit(12),
    supabase.from('audit_events').select('id,action,entity_type,entity_id,summary,created_at,profiles:actor_id(full_name)').order('created_at', { ascending: false }).limit(12),
  ])
  const errors = [work.error, notifications.error, documents.error, audit.error].filter(Boolean)
  if (errors.length === 4) throw errors[0]
  return {
    work: (work.data ?? []) as WorkItem[], notifications: (notifications.data ?? []) as AppNotification[],
    documents: (documents.data ?? []) as ErpDocument[], audit: (audit.data ?? []) as AuditEvent[],
    unavailable: errors.map(error => error?.message).filter(Boolean) as string[],
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.from('app_notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function completeWorkItem(id: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('work_items').update({ status: 'done', completed_at: new Date().toISOString(), completed_by: user?.id ?? null }).eq('id', id)
  if (error) throw error
}
