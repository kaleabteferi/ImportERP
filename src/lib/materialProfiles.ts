import type { MaterialKind } from '../api/operationalCore'

export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  finished_product: 'Finished product', skd_component: 'SKD component', packaging_material: 'Packaging material', spare_part: 'Spare part', raw_material: 'Raw material',
}

export const MATERIAL_EXAMPLES: Record<MaterialKind, string> = {
  finished_product: 'Kettle 2.2L, cookware set, frypan 24–28cm, meat grinder TK22',
  skd_component: '7020 motor, blending jug, blade coupling, switch, diode, power cord',
  packaging_material: 'Inner carton, color box, instruction sheet, strap, packaging bag',
  spare_part: 'Waterproof ring, knob, blade, driven wheel, rubber feet',
  raw_material: 'Stainless steel cup, plastic housing or unprocessed production input',
}

export const DOCUMENT_TYPE_LABELS = {
  proforma_invoice: 'Proforma invoice', purchase_order: 'Purchase order', packing_list: 'Packing list', container_plan: 'Container plan', customs_declaration: 'Customs declaration',
  goods_receipt: 'Goods receipt', warehouse_transfer: 'Warehouse transfer', production_order: 'Production order', finished_goods_receipt: 'Finished-goods receipt',
  sales_order: 'Sales order', delivery_note: 'Delivery note', sales_invoice: 'Sales invoice', payroll_journal: 'Payroll journal',
} as const

export const DOCUMENT_FLOW = ['proforma_invoice','purchase_order','packing_list','container_plan','customs_declaration','goods_receipt','warehouse_transfer','production_order','finished_goods_receipt','sales_order','delivery_note','sales_invoice'] as const
