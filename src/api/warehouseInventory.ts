import { supabase } from '../lib/supabase'
import { createDamageReport } from './damageReports'
import { addShortageNote } from './shortageNotes'
import { moveInventoryLocation, fetchWarehouseLocationsData, type WarehouseLocation, type LocationStockRow, type UnplacedStockRow } from './warehouseOperations'
import { postInventoryMovement, receiveShipmentToInventory, resolveAssemblyType, type AssemblyType } from '../lib/inventoryReceive'
import type { CountResultLine } from '../components/ReceivingCountModal'
import { confirmDjiboutiReceipt, type WarehouseTransfer } from './warehouseTransfers'

export interface WarehouseSummary { id: string; name: string; code: string | null; city: string | null }
export interface WarehouseInventoryItem {
  productId: string; name: string; sku: string; assemblyType: AssemblyType; unitOfMeasure: string
  quantity: number; averageCost: number; value: number; placed: number; unplaced: number
  locations: Array<{ id: string; code: string; name: string | null; quantity: number }>
  movements: Array<{ id: string; type: string; quantity: number; date: string; notes: string | null }>
}
export interface WarehouseInventoryWorkspace {
  warehouse: WarehouseSummary
  items: WarehouseInventoryItem[]
  locations: WarehouseLocation[]
  locationStock: LocationStockRow[]
  unplacedStock: UnplacedStockRow[]
}

export interface InboundLine {
  id: string; productId: string; productName: string; sku: string; quantity: number
  cartonQty: number | null; unitsPerCarton: number | null; unitOfMeasure: string | null
  unitLandedCostEtb: number | null; assemblyType: AssemblyType; containerNumber: string | null
}
export interface InboundShipment {
  id: string; shipmentNumber: string; status: string; supplierId: string | null; supplierName: string
  eta: string | null; createdAt: string; lines: InboundLine[]
  sourceType: 'SHIPMENT' | 'WAREHOUSE_TRANSFER' | 'ALI_TRANSFER'
  waybillNumber?: string | null; driverName?: string | null; truckPlate?: string | null
}

function fail(error: { message: string } | null) { if (error) throw new Error(error.message) }

export async function listWarehouses(): Promise<WarehouseSummary[]> {
  const { data, error } = await supabase.from('warehouses').select('id, name, code, city').eq('is_active', true).order('name')
  fail(error)
  return (data ?? []) as WarehouseSummary[]
}

export async function fetchWarehouseInventory(warehouseId: string): Promise<WarehouseInventoryWorkspace> {
  const [warehouseRes, inventoryRes, locationData, movementRes] = await Promise.all([
    supabase.from('warehouses').select('id, name, code, city').eq('id', warehouseId).single(),
    supabase.from('current_inventory').select('product_id, quantity_on_hand, avg_unit_cost_etb').eq('warehouse_id', warehouseId),
    fetchWarehouseLocationsData([warehouseId]),
    supabase.from('inventory_ledger').select('id, product_id, movement_type, quantity, movement_date, notes').eq('warehouse_id', warehouseId).order('movement_date', { ascending: false }).limit(300),
  ])
  fail(warehouseRes.error); fail(inventoryRes.error); fail(movementRes.error)
  const inventoryRows = inventoryRes.data ?? []
  const productIds = [...new Set(inventoryRows.map(row => row.product_id))]
  const productRes = productIds.length
    ? await supabase.from('products').select('id, name, sku, assembly_type, is_assembled, unit_of_measure').in('id', productIds)
    : { data: [], error: null }
  fail(productRes.error)
  const products = new Map((productRes.data ?? []).map(product => [product.id, product]))
  const locations = new Map(locationData.locations.map(location => [location.id, location]))
  const items = inventoryRows.map(row => {
    const product = products.get(row.product_id)
    const locationRows = locationData.stockByLocation.filter(item => item.product_id === row.product_id)
    const placed = locationRows.reduce((sum, item) => sum + Number(item.quantity_on_hand), 0)
    const unplaced = Number(locationData.unplacedStock.find(item => item.product_id === row.product_id)?.quantity_on_hand ?? 0)
    const quantity = Number(row.quantity_on_hand ?? 0)
    const averageCost = Number(row.avg_unit_cost_etb ?? 0)
    return {
      productId: row.product_id,
      name: product?.name ?? 'Unknown product', sku: product?.sku ?? '—',
      assemblyType: resolveAssemblyType(product ?? {}), unitOfMeasure: product?.unit_of_measure ?? 'units',
      quantity, averageCost, value: quantity * averageCost, placed, unplaced,
      locations: locationRows.map(item => ({ id: item.location_id, code: locations.get(item.location_id)?.code ?? '—', name: locations.get(item.location_id)?.name ?? null, quantity: Number(item.quantity_on_hand) })),
      movements: (movementRes.data ?? []).filter(item => item.product_id === row.product_id).slice(0, 8).map(item => ({ id: item.id, type: item.movement_type, quantity: Number(item.quantity), date: item.movement_date, notes: item.notes })),
    }
  })
  return { warehouse: warehouseRes.data as WarehouseSummary, items, locations: locationData.locations, locationStock: locationData.stockByLocation, unplacedStock: locationData.unplacedStock }
}

export async function fetchInboundShipments(warehouseId: string): Promise<InboundShipment[]> {
  const [shipmentRes, transferRes] = await Promise.all([
    supabase.from('shipments')
      .select('id, shipment_number, status, supplier_id, eta_djibouti, arrived_addis_date, created_at, suppliers(name)')
      .eq('warehouse_id', warehouseId).is('inventory_received_at', null)
      .in('status', ['AT_DJIBOUTI', 'IN_TRANSIT', 'AT_CUSTOMS', 'SHIPPED'])
      .order('created_at', { ascending: false }),
    supabase.from('warehouse_transfers')
      .select('*, products(name, sku, assembly_type, is_assembled, unit_of_measure), from_warehouse:from_warehouse_id(name, is_forwarder)')
      .eq('to_warehouse_id', warehouseId).eq('status', 'IN_TRANSIT')
      .order('dispatched_at', { ascending: false }),
  ])
  fail(shipmentRes.error); fail(transferRes.error)
  const shipmentIds = (shipmentRes.data ?? []).map(item => item.id)
  const itemRes = shipmentIds.length ? await supabase.from('shipment_items')
    .select('id, shipment_id, product_id, quantity, carton_qty, units_per_carton, unit_of_measure, unit_landed_cost_etb, products(name, sku, assembly_type, is_assembled), containers(container_number)')
    .in('shipment_id', shipmentIds) : { data: [], error: null }
  fail(itemRes.error)
  const shipments: InboundShipment[] = (shipmentRes.data ?? []).map(shipment => {
    const supplier = Array.isArray(shipment.suppliers) ? shipment.suppliers[0] : shipment.suppliers
    return {
      id: shipment.id, shipmentNumber: shipment.shipment_number, status: shipment.status,
      supplierId: shipment.supplier_id, supplierName: supplier?.name ?? 'Supplier not assigned', eta: shipment.arrived_addis_date ?? shipment.eta_djibouti, createdAt: shipment.created_at,
      sourceType: 'SHIPMENT',
      lines: (itemRes.data ?? []).filter(item => item.shipment_id === shipment.id).map(item => {
        const product = Array.isArray(item.products) ? item.products[0] : item.products
        const container = Array.isArray(item.containers) ? item.containers[0] : item.containers
        return { id: item.id, productId: item.product_id, productName: product?.name ?? 'Unknown product', sku: product?.sku ?? '—', quantity: Number(item.quantity), cartonQty: item.carton_qty == null ? null : Number(item.carton_qty), unitsPerCarton: item.units_per_carton == null ? null : Number(item.units_per_carton), unitOfMeasure: item.unit_of_measure, unitLandedCostEtb: item.unit_landed_cost_etb == null ? null : Number(item.unit_landed_cost_etb), assemblyType: resolveAssemblyType(product ?? {}), containerNumber: container?.container_number ?? null }
      }),
    }
  })
  const transfers: InboundShipment[] = (transferRes.data ?? []).map(transfer => {
    const product = Array.isArray(transfer.products) ? transfer.products[0] : transfer.products
    const source = Array.isArray(transfer.from_warehouse) ? transfer.from_warehouse[0] : transfer.from_warehouse
    const isAli = Boolean(source?.is_forwarder || transfer.requested_quantity !== null)
    return {
      id: transfer.id, shipmentNumber: transfer.transfer_number, status: transfer.status,
      supplierId: null, supplierName: isAli ? `Ali / Djibouti · ${source?.name ?? 'Forwarder warehouse'}` : `From ${source?.name ?? 'warehouse'}`,
      eta: transfer.dispatched_at ?? transfer.transfer_date, createdAt: transfer.created_at,
      sourceType: isAli ? 'ALI_TRANSFER' : 'WAREHOUSE_TRANSFER', waybillNumber: transfer.waybill_number,
      driverName: transfer.driver_name, truckPlate: transfer.truck_plate,
      lines: [{
        id: transfer.id, productId: transfer.product_id, productName: product?.name ?? 'Unknown product', sku: product?.sku ?? '—',
        quantity: Number(transfer.quantity), cartonQty: null, unitsPerCarton: null, unitOfMeasure: product?.unit_of_measure ?? 'units',
        unitLandedCostEtb: null, assemblyType: resolveAssemblyType(product ?? {}), containerNumber: null,
      }],
    }
  })
  return [...transfers, ...shipments].sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))
}

export async function postWarehouseReceipt(input: {
  warehouseId: string; shipment: InboundShipment; count: CountResultLine[]; fxRate?: number
}): Promise<void> {
  const { warehouseId, shipment, count } = input
  if (shipment.sourceType !== 'SHIPMENT') {
    const { data: transfer, error } = await supabase.from('warehouse_transfers').select('*').eq('id', shipment.id).single()
    fail(error)
    const line = count[0]
    if (!line) throw new Error('No transfer count was provided.')
    if (shipment.sourceType === 'ALI_TRANSFER') {
      await confirmDjiboutiReceipt(transfer as WarehouseTransfer, line.countedQuantity, line.damagedQuantity, line.placementLocationId)
      return
    }
    const movementDate = new Date().toISOString().slice(0, 10)
    const received = Math.max(0, line.countedQuantity)
    const damaged = Math.max(0, line.damagedQuantity)
    const { error: updateError } = await supabase.from('warehouse_transfers').update({ status: 'RECEIVED', received_quantity: received, received_at: new Date().toISOString() }).eq('id', transfer.id)
    fail(updateError)
    const ledgerRows = [
      { product_id: transfer.product_id, quantity: -Math.abs(Number(transfer.quantity)), movement_type: 'TRANSFER_OUT', movement_date: movementDate, warehouse_id: transfer.from_warehouse_id, reference_type: 'warehouse_transfer', reference_id: transfer.id, notes: `Dispatched · ${transfer.transfer_number}` },
      { product_id: transfer.product_id, quantity: Math.abs(received), movement_type: 'TRANSFER_IN', movement_date: movementDate, warehouse_id: warehouseId, reference_type: 'warehouse_transfer', reference_id: transfer.id, notes: `Received · ${transfer.transfer_number}` },
    ]
    const { error: ledgerError } = await supabase.from('inventory_ledger').insert(ledgerRows)
    fail(ledgerError)
    if (damaged > 0) await createDamageReport({ productId: transfer.product_id, warehouseId, quantity: damaged, reason: 'Damaged during warehouse transfer', reportDate: movementDate, notes: line.notes || transfer.transfer_number })
    const goodQuantity = received - damaged
    if (line.placementLocationId && goodQuantity > 0) await moveInventoryLocation({ warehouseId, productId: transfer.product_id, fromLocationId: null, toLocationId: line.placementLocationId, quantity: goodQuantity, notes: `Placed from ${transfer.transfer_number}` })
    return
  }
  const lineById = new Map(shipment.lines.map(line => [line.id, line]))
  await receiveShipmentToInventory(shipment.id, count.filter(line => line.countedQuantity > 0).map(line => {
    const source = lineById.get(line.shipmentItemId)!
    return { shipment_item_id: line.shipmentItemId, product_id: line.productId, product_name: line.productName, quantity: line.countedQuantity, unit_landed_cost_etb: source?.unitLandedCostEtb ?? null, assembly_type: source?.assemblyType ?? 'IMPORTED' }
  }), input.fxRate ?? 1, warehouseId)

  const bomCache = new Map<string, Array<{ component_product_id: string; quantity_required: number }> | null>()
  async function bomLines(productId: string) {
    if (bomCache.has(productId)) return bomCache.get(productId)!
    const header = await supabase.from('bom_headers').select('id').eq('product_id', productId).eq('is_active', true).maybeSingle()
    if (!header.data) { bomCache.set(productId, null); return null }
    const lines = await supabase.from('bom_lines').select('component_product_id, quantity_required').eq('bom_header_id', header.data.id)
    fail(lines.error); bomCache.set(productId, lines.data ?? []); return lines.data ?? []
  }
  const date = new Date().toISOString().slice(0, 10)
  for (const line of count) {
    const source = lineById.get(line.shipmentItemId)
    const isKit = source?.assemblyType === 'CKD' || source?.assemblyType === 'SKD'
    const components = isKit ? await bomLines(line.productId) : null
    if (line.damagedQuantity > 0) {
      const reportId = await createDamageReport({ productId: line.productId, warehouseId, quantity: line.damagedQuantity, reason: 'Damaged in transit — receiving reconciliation', shipmentId: shipment.id, reportDate: date, notes: line.notes || undefined, skipLedgerMovement: !!components })
      for (const component of components ?? []) await postInventoryMovement({ product_id: component.component_product_id, quantity: -Math.abs(Number(component.quantity_required) * line.damagedQuantity), movement_type: 'DAMAGE', warehouse_id: warehouseId, reference_type: 'damage_report', reference_id: reportId, notes: `Component write-off from damaged ${source?.assemblyType} receipt` })
    }
    const shortage = line.expectedQuantity - line.countedQuantity
    if (shortage > 0 && shipment.supplierId) await addShortageNote({ supplierId: shipment.supplierId, productId: line.productId, shipmentId: shipment.id, quantityShort: shortage, notes: line.notes || 'Found short during warehouse receiving.' })
    const goodQuantity = line.countedQuantity - line.damagedQuantity
    if (line.placementLocationId && goodQuantity > 0) {
      if (components) for (const component of components) await moveInventoryLocation({ warehouseId, productId: component.component_product_id, fromLocationId: null, toLocationId: line.placementLocationId, quantity: Number(component.quantity_required) * goodQuantity, notes: `Placed from receipt ${shipment.shipmentNumber}` })
      else await moveInventoryLocation({ warehouseId, productId: line.productId, fromLocationId: null, toLocationId: line.placementLocationId, quantity: goodQuantity, notes: line.notes || `Placed from receipt ${shipment.shipmentNumber}` })
    }
  }
}
