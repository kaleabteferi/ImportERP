// src/lib/globalSearch.ts — one search box across the app's core records.
// Runs a handful of `ilike` queries in parallel rather than a dedicated
// search index/table, since the tables involved are small (hundreds to a
// few thousand rows for an operation this size) and RLS already scopes
// each query to what the signed-in role can see — a table an account
// can't read (e.g. employees for a non-HR role) just comes back empty
// instead of erroring, so results silently respect the same permissions
// as the rest of the app.
import { supabase } from './supabase'

export type GlobalSearchResultType = 'product' | 'customer' | 'supplier' | 'order' | 'shipment' | 'employee'

export interface GlobalSearchResult {
  type: GlobalSearchResultType
  id: string
  title: string
  subtitle: string
  to: string
}

const TYPE_LABEL: Record<GlobalSearchResultType, string> = {
  product: 'Product', customer: 'Customer', supplier: 'Supplier',
  order: 'Sales order', shipment: 'Shipment', employee: 'Employee',
}
export { TYPE_LABEL as GLOBAL_SEARCH_TYPE_LABEL }

export async function searchGlobal(query: string): Promise<GlobalSearchResult[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const like = `%${q}%`

  const [products, customers, suppliers, orders, shipments, employees] = await Promise.all([
    supabase.from('products').select('id, name, sku').or(`name.ilike.${like},sku.ilike.${like}`).limit(6),
    supabase.from('customers').select('id, name, phone').or(`name.ilike.${like},phone.ilike.${like}`).limit(6),
    supabase.from('suppliers').select('id, name, country').ilike('name', like).limit(6),
    supabase.from('sales_orders').select('id, order_number, invoice_number, total_etb').or(`order_number.ilike.${like},invoice_number.ilike.${like}`).limit(6),
    supabase.from('shipments').select('id, shipment_number, status').ilike('shipment_number', like).limit(6),
    supabase.from('employees').select('id, full_name, department').ilike('full_name', like).limit(6),
  ])

  const results: GlobalSearchResult[] = []

  for (const p of products.data ?? []) {
    results.push({ type: 'product', id: p.id, title: p.name, subtitle: p.sku ? `SKU ${p.sku}` : 'Product', to: '/products' })
  }
  for (const c of customers.data ?? []) {
    results.push({ type: 'customer', id: c.id, title: c.name, subtitle: c.phone ?? 'Customer', to: '/customers' })
  }
  for (const s of suppliers.data ?? []) {
    results.push({ type: 'supplier', id: s.id, title: s.name, subtitle: s.country ?? 'Supplier', to: '/suppliers' })
  }
  for (const o of orders.data ?? []) {
    results.push({ type: 'order', id: o.id, title: o.order_number ?? o.invoice_number ?? 'Order', subtitle: `${Math.round(Number(o.total_etb ?? 0)).toLocaleString()} ETB`, to: '/sales' })
  }
  for (const sh of shipments.data ?? []) {
    results.push({ type: 'shipment', id: sh.id, title: sh.shipment_number, subtitle: sh.status ?? 'Shipment', to: `/shipments/${sh.id}` })
  }
  for (const e of employees.data ?? []) {
    results.push({ type: 'employee', id: e.id, title: e.full_name, subtitle: e.department ?? 'Employee', to: '/employees' })
  }

  return results
}
