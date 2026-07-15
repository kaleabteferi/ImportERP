// src/api/damageReports.ts — damaged-stock log, linked back to the
// originating shipment/PO for supplier claims, and posts a DAMAGE
// inventory_ledger movement so it comes off sellable stock.
import { supabase } from '../lib/supabase'
import { postInventoryMovement } from '../lib/inventoryReceive'

export interface DamageReport {
  id: string
  report_number: string
  product_id: string
  warehouse_id: string
  quantity: number
  reason: string
  photo_url: string | null
  shipment_id: string | null
  purchase_order_id: string | null
  reported_by_employee_id: string | null
  report_date: string
  notes: string | null
  created_at: string
}

export interface NewDamageReportInput {
  productId: string
  warehouseId: string
  quantity: number
  reason: string
  photoUrl?: string
  shipmentId?: string
  purchaseOrderId?: string
  reportedByEmployeeId?: string
  reportDate: string
  notes?: string
}

async function nextReportNumber(year: number): Promise<string> {
  const { count } = await supabase
    .from('damage_reports')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', `${year}-01-01`)
    .lt('created_at', `${year + 1}-01-01`)
  return `DMG-${year}-${String((count ?? 0) + 1).padStart(3, '0')}`
}

export async function fetchDamageReports(limit = 100): Promise<DamageReport[]> {
  const { data, error } = await supabase
    .from('damage_reports')
    .select('*')
    .order('report_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return data as DamageReport[]
}

export async function createDamageReport(input: NewDamageReportInput): Promise<string> {
  const year = new Date(input.reportDate).getFullYear()

  let lastError: { message: string; code?: string } | null = null
  let reportId: string | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const reportNumber = await nextReportNumber(year)
    const { data, error } = await supabase.from('damage_reports').insert({
      report_number: reportNumber,
      product_id: input.productId,
      warehouse_id: input.warehouseId,
      quantity: input.quantity,
      reason: input.reason,
      photo_url: input.photoUrl || null,
      shipment_id: input.shipmentId || null,
      purchase_order_id: input.purchaseOrderId || null,
      reported_by_employee_id: input.reportedByEmployeeId || null,
      report_date: input.reportDate,
      notes: input.notes || null,
    }).select('id').single()
    if (!error) { reportId = data.id; break }
    lastError = error
    if (error.code !== '23505') break
  }
  if (!reportId) throw new Error(lastError?.message ?? 'Failed to create damage report')

  await postInventoryMovement({
    product_id: input.productId,
    quantity: -Math.abs(input.quantity),
    movement_type: 'DAMAGE',
    movement_date: input.reportDate,
    warehouse_id: input.warehouseId,
    reference_type: 'damage_report',
    reference_id: reportId,
    notes: input.reason,
  })

  return reportId
}
