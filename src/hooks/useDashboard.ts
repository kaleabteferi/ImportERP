import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface DashboardData {
  inventoryValueEtb: number
  monthRevenueEtb: number
  monthCogsEtb: number
  grossProfitEtb: number
  grossMarginPct: number
  demurrageEtb: number
  totalPayableUsd: number
  totalReceivableEtb: number
  productionToday: number
  lowStockCount: number
  activeShipments: Array<{
    id: string
    shipment_number: string
    container_number: string
    supplier_name: string
    status: string
    eta_djibouti: string | null
  }>
  inventory: Array<{
    product_name: string
    sku: string
    quantity_on_hand: number
    total_value: number
    is_low: boolean
  }>
  payables: Array<{
    supplier_name: string
    outstanding_usd: number
    payment_terms: string
  }>
  receivables: Array<{
    customer_name: string
    outstanding_etb: number
    days: number
    is_overdue: boolean
  }>
  production: Array<{
    product_name: string
    today_units: number
    target_units: number
  }>
  pl: {
    revenue: number
    cogs: number
    grossProfit: number
    netProfit: number
    prevNetProfit: number
  }
}

export function useDashboard() {
  const [data, setData]         = useState<DashboardData | null>(null)
  const [isLoading, setLoading] = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [refreshed, setRefreshed] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const now        = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString().split('T')[0]
      const prevStart  = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        .toISOString().split('T')[0]
      const prevEnd    = new Date(now.getFullYear(), now.getMonth(), 0)
        .toISOString().split('T')[0]
      const today      = now.toISOString().split('T')[0]

      const [inv, ships, sales, prevSales, pos, ars, prodLogs] = await Promise.all([
        // Inventory from ledger
        supabase.from('inventory_ledger')
          .select('product_id, quantity, unit_cost_etb, products(name, sku)')
          .gt('quantity', 0),

        // Active shipments
        supabase.from('shipments')
          .select('id, shipment_number, container_number, status, eta_djibouti, suppliers(name)')
          .in('status', ['ORDERED','IN_PRODUCTION','SHIPPED','AT_DJIBOUTI','IN_TRANSIT','AT_CUSTOMS'])
          .order('eta_djibouti', { ascending: true })
          .limit(5),

        // This month sales
        supabase.from('sales_orders')
          .select('total_etb, total_cogs_etb, gross_profit_etb')
          .gte('sale_date', monthStart)
          .in('status', ['INVOICED','PAID']),

        // Last month sales
        supabase.from('sales_orders')
          .select('gross_profit_etb')
          .gte('sale_date', prevStart)
          .lte('sale_date', prevEnd)
          .in('status', ['INVOICED','PAID']),

        // Supplier payables
        supabase.from('purchase_orders')
          .select('total_amount, paid_amount, payment_terms, suppliers(name)')
          .order('created_at', { ascending: false })
          .limit(10),

        // Customer receivables
        supabase.from('sales_orders')
          .select('total_etb, sale_date, due_date, customers(name)')
          .eq('status', 'INVOICED')
          .limit(5),

        // Today production
        supabase.from('production_daily_logs')
          .select('quantity_produced, production_orders(target_quantity, bom_headers(products(name)))')
          .eq('log_date', today),
      ])

      // Process inventory
      const invMap = new Map<string, { name: string; sku: string; qty: number; val: number }>()
      for (const row of inv.data ?? []) {
        const pid  = row.product_id
        const prod = row.products as any
        if (!invMap.has(pid)) {
          invMap.set(pid, { name: prod?.name ?? '—', sku: prod?.sku ?? '—', qty: 0, val: 0 })
        }
        const entry = invMap.get(pid)!
        entry.qty += row.quantity
        entry.val += row.quantity * (row.unit_cost_etb ?? 0)
      }
      const invItems = [...invMap.values()].filter(i => i.qty > 0)
      const inventoryValueEtb = invItems.reduce((s, i) => s + i.val, 0)

      // Process sales
      const salesData   = sales.data ?? []
      const revenue     = salesData.reduce((s: number, o: any) => s + (o.total_etb ?? 0), 0)
      const cogs        = salesData.reduce((s: number, o: any) => s + (o.total_cogs_etb ?? 0), 0)
      const grossProfit = revenue - cogs
      const prevProfit  = (prevSales.data ?? []).reduce((s: number, o: any) => s + (o.gross_profit_etb ?? 0), 0)

      // Process payables
      const payables = (pos.data ?? [])
        .filter((p: any) => p.paid_amount < p.total_amount)
        .map((p: any) => ({
          supplier_name:   (p.suppliers as any)?.name ?? '—',
          outstanding_usd: p.total_amount - p.paid_amount,
          payment_terms:   p.payment_terms ?? '—',
        }))

      // Process receivables
      const receivables = (ars.data ?? []).map((r: any) => {
        const due      = r.due_date ? new Date(r.due_date) : null
        const diffDays = due ? Math.round((now.getTime() - due.getTime()) / 86400000) : 0
        return {
          customer_name:   (r.customers as any)?.name ?? '—',
          outstanding_etb: r.total_etb ?? 0,
          days:            Math.max(0, diffDays),
          is_overdue:      due ? due < now : false,
        }
      })

      // Process production
      const production = (prodLogs.data ?? []).map((log: any) => ({
        product_name: (log.production_orders as any)?.bom_headers?.products?.name ?? '—',
        today_units:  log.quantity_produced ?? 0,
        target_units: (log.production_orders as any)?.target_quantity ?? 0,
      }))

      setData({
        inventoryValueEtb,
        monthRevenueEtb:      revenue,
        monthCogsEtb:         cogs,
        grossProfitEtb:       grossProfit,
        grossMarginPct:       revenue > 0 ? (grossProfit / revenue) * 100 : 0,
        demurrageEtb:         0,  // populated once demurrage_events table has data
        totalPayableUsd:      payables.reduce((s, p) => s + p.outstanding_usd, 0),
        totalReceivableEtb:   receivables.reduce((s, r) => s + r.outstanding_etb, 0),
        productionToday:      production.reduce((s, p) => s + p.today_units, 0),
        lowStockCount:        invItems.filter(i => i.qty < 20).length,
        activeShipments: (ships.data ?? []).map((s: any) => ({
          id:               s.id,
          shipment_number:  s.shipment_number,
          container_number: s.container_number,
          supplier_name:    (s.suppliers as any)?.name ?? '—',
          status:           s.status,
          eta_djibouti:     s.eta_djibouti,
        })),
        inventory: invItems.map(i => ({
          product_name:    i.name,
          sku:             i.sku,
          quantity_on_hand: i.qty,
          total_value:     i.val,
          is_low:          i.qty < 20,
        })),
        payables,
        receivables,
        production,
        pl: {
          revenue,
          cogs,
          grossProfit,
          netProfit:     grossProfit * 0.8,
          prevNetProfit: prevProfit,
        },
      })
      setRefreshed(new Date())
    } catch (e: any) {
      setError(e.message ?? 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const t = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [load])

  return { data, isLoading, error, refresh: load, refreshed }
}