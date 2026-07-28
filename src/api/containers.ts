// src/api/containers.ts
import { supabase } from '../lib/supabase'

export interface Container {
  id: string
  container_number: string
  pi_id: string
  shipment_id: string | null
  container_type: string
  seal_number: string | null
  gross_weight_kg: number | null
  net_weight_kg: number | null
  volume_m3: number | null
  vessel_name: string | null
  voyage_number: string | null
  bl_number: string | null
  etd: string | null
  eta_djibouti: string | null
  actual_arrival: string | null
  status: string
  notes: string | null
}

export interface PlItem {
  id: string
  pl_id: string
  pi_item_id: string
  line_number: number
  carton_qty: number
  units_per_carton: number
  total_units: number
  gross_weight_per_ctn: number | null
  net_weight_per_ctn: number | null
  length_cm: number | null
  width_cm: number | null
  height_cm: number | null
  unit_price_foreign: number
  carton_number_from: number | null
  carton_number_to: number | null
  marks_and_numbers: string | null
}

export async function listContainers(piId: string) {
  const { data, error } = await supabase
    .from('containers')
    .select('*, packing_lists(id), shipments(shipment_number)')
    .eq('pi_id', piId)
    .order('container_number')
  if (error) throw new Error(error.message)
  return data ?? []
}

export interface ContainerInput {
  container_number: string
  container_type?: string
  vessel_name?: string | null
  voyage_number?: string | null
  bl_number?: string | null
  etd?: string | null
  eta_djibouti?: string | null
  seal_number?: string | null
  notes?: string | null
}

export async function createContainer(piId: string, input: ContainerInput) {
  const { data, error } = await supabase
    .from('containers')
    .insert({
      container_number: input.container_number,
      pi_id: piId,
      container_type: input.container_type || '40HC',
      vessel_name: input.vessel_name || null,
      voyage_number: input.voyage_number || null,
      bl_number: input.bl_number || null,
      etd: input.etd || null,
      eta_djibouti: input.eta_djibouti || null,
      seal_number: input.seal_number || null,
      notes: input.notes || null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id as string
}

export async function updateContainer(id: string, patch: Partial<ContainerInput>) {
  const { error } = await supabase.from('containers').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

// Refuses to delete a container that already has its own posted
// shipment_items/timeline/demurrage data -- shipment_items.container_id is
// ON DELETE RESTRICT specifically so this can't happen silently. Since
// containers now SHARE one shipment with their siblings under the same PI,
// the fix is no longer "delete the shipment" (that would wipe every
// sibling container's data too) -- it's removing this container's own rows
// first, from the shipment's per-container items view.
export async function deleteContainer(id: string) {
  const { data: container, error: fetchError } = await supabase
    .from('containers').select('shipment_id').eq('id', id).single()
  if (fetchError) throw new Error(fetchError.message)
  if (container?.shipment_id) {
    throw new Error('This container already has shipment items, timeline events, or demurrage data recorded against it — remove those first (from the shipment\'s per-container items view) before deleting the container. Deleting the whole shipment would also remove any sibling containers\' data.')
  }
  const { error } = await supabase.from('containers').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// packing_lists has UNIQUE(container_id) -- exactly one per container.
// Fetch-or-create so callers never have to think about whether it exists yet.
//
// The count-based pl_number is racy under concurrent calls (e.g. React
// StrictMode double-invoking the mount effect that calls this, or two
// containers created back-to-back before the first insert commits) --
// mirrors the retry-on-conflict pattern already used for shipment_number in
// src/pages/Shipments.tsx. On a collision, re-check by container_id first
// (a concurrent call for the SAME container may have already won) before
// retrying with a fresh number.
export async function getOrCreatePackingList(containerId: string, piId: string): Promise<string> {
  const { data: existing, error: fetchError } = await supabase
    .from('packing_lists').select('id').eq('container_id', containerId).maybeSingle()
  if (fetchError) throw new Error(fetchError.message)
  if (existing) return existing.id as string

  for (let attempt = 0; attempt < 4; attempt++) {
    const { count } = await supabase
      .from('packing_lists').select('id', { count: 'exact', head: true })
    const plNumber = `PL-${new Date().getFullYear()}-${String((count ?? 0) + 1 + attempt).padStart(3, '0')}`

    const { data, error } = await supabase
      .from('packing_lists')
      .insert({ pl_number: plNumber, container_id: containerId, pi_id: piId })
      .select('id')
      .single()
    if (!error) return data.id as string

    if (error.code === '23505') {
      const { data: won } = await supabase
        .from('packing_lists').select('id').eq('container_id', containerId).maybeSingle()
      if (won) return won.id as string
      continue // pl_number collided with a different container's row -- retry with a new one
    }
    throw new Error(error.message)
  }
  throw new Error('Could not create a packing list after several attempts -- please retry.')
}

export async function listPackingListItems(packingListId: string) {
  const { data, error } = await supabase
    .from('pl_items')
    .select('*, pi_items(item_description, unit_of_measure, product_id, products(name, sku))')
    .eq('pl_id', packingListId)
    .order('line_number')
  if (error) throw new Error(error.message)
  return data ?? []
}

// How much of each pi_item has already been split across ALL of this PI's
// containers -- lets the packing-list builder show "remaining to allocate"
// per line instead of letting the same units get double-booked silently.
export async function getAllocatedQuantities(piId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('pl_items')
    .select('pi_item_id, total_units, packing_lists!inner(pi_id)')
    .eq('packing_lists.pi_id', piId)
  if (error) throw new Error(error.message)
  const totals: Record<string, number> = {}
  for (const row of data ?? []) {
    const key = (row as any).pi_item_id as string
    totals[key] = (totals[key] ?? 0) + Number((row as any).total_units ?? 0)
  }
  return totals
}

export interface PlItemInput {
  pi_item_id: string
  carton_qty: number
  units_per_carton: number
  unit_price_foreign: number
  gross_weight_per_ctn?: number | null
  net_weight_per_ctn?: number | null
  length_cm?: number | null
  width_cm?: number | null
  height_cm?: number | null
  marks_and_numbers?: string | null
}

export async function addPackingListItem(packingListId: string, input: PlItemInput) {
  const { count } = await supabase
    .from('pl_items').select('id', { count: 'exact', head: true }).eq('pl_id', packingListId)
  const { error } = await supabase.from('pl_items').insert({
    pl_id: packingListId,
    pi_item_id: input.pi_item_id,
    line_number: (count ?? 0) + 1,
    carton_qty: input.carton_qty,
    units_per_carton: input.units_per_carton,
    unit_price_foreign: input.unit_price_foreign,
    gross_weight_per_ctn: input.gross_weight_per_ctn ?? null,
    net_weight_per_ctn: input.net_weight_per_ctn ?? null,
    length_cm: input.length_cm ?? null,
    width_cm: input.width_cm ?? null,
    height_cm: input.height_cm ?? null,
    marks_and_numbers: input.marks_and_numbers ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function deletePackingListItem(id: string) {
  const { error } = await supabase.from('pl_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// Wraps create_shipment_from_container -- generates a shipment + its
// shipment_items from this container's packing list, idempotently (calling
// it again on an already-generated container just returns the existing
// shipment id rather than creating a duplicate).
export async function generateShipmentFromContainer(containerId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_shipment_from_container', { p_container_id: containerId })
  if (error) throw new Error(error.message)
  return data as string
}
