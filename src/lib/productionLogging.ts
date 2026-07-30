// Single-BOM quick production log used by the mobile Production page.
// All validation, order/log updates, and inventory movements happen in one
// database transaction so a failed write cannot leave partial production data.
import { supabase } from './supabase'

export async function logProductionQuick(
  bomHeaderId: string,
  warehouseId: string,
  quantity: number,
  notes: string | undefined,
  logDate: string,
  companyId?: string,
): Promise<void> {
  if (quantity <= 0) throw new Error('Enter a quantity greater than 0.')

  const { error } = await supabase.rpc('log_unmanaged_production', {
    p_bom_header_id: bomHeaderId,
    p_warehouse_id: warehouseId,
    p_quantity: quantity,
    p_notes: notes?.trim() || null,
    p_log_date: logDate,
    p_employee_id: null,
    p_production_order_id: null,
    p_company_id: companyId || null,
  })

  if (error) {
    const diagnostic = [
      error.code,
      error.message,
      error.details,
      error.hint,
    ].filter(Boolean).join(' ').toLowerCase()

    if (
      diagnostic.includes('warehouse operations')
      || diagnostic.includes('managed production')
      || diagnostic.includes('managed batch')
    ) {
      throw new Error(
        'This production is managed in Warehouse Operations. Record its workers and output there so production and inventory are posted once.',
      )
    }
    if (error.code === '42501' || diagnostic.includes('row-level security')) {
      throw new Error('Production and company access are required to log output for this warehouse.')
    }

    throw new Error(error.message)
  }
}
