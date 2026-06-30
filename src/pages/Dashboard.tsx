import { RefreshCw, AlertTriangle, TrendingUp, Ship,
         Package, Wrench, Receipt, Building2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDashboard } from '../hooks/useDashboard'

const N = (n: number) =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Math.round(n))

const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  ORDERED:            { label: 'Ordered',      bg: '#F1EFE8', color: '#5F5E5A' },
  IN_PRODUCTION:      { label: 'In production',bg: '#F1EFE8', color: '#5F5E5A' },
  SHIPPED:            { label: 'Shipped',      bg: '#E6F1FB', color: '#0C447C' },
  AT_DJIBOUTI:        { label: 'At Djibouti', bg: '#FAEEDA', color: '#633806' },
  IN_TRANSIT:         { label: 'In transit',   bg: '#EEEDFE', color: '#3C3489' },
  AT_CUSTOMS:         { label: 'At customs',   bg: '#FCEBEB', color: '#791F1F' },
  WAREHOUSE_RECEIVED: { label: 'Received',     bg: '#EAF3DE', color: '#27500A' },
}

const card: React.CSSProperties = {
  background: 'var(--color-background-primary)',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: '12px', overflow: 'hidden',
}

const cardHead: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  background: 'var(--color-background-secondary)',
}

export function Dashboard() {
  const { data, isLoading, error, refresh, refreshed } = useDashboard()
  const now = new Date()

  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: '200px', color: 'var(--color-text-tertiary)', gap: '8px' }}>
      <RefreshCw size={16} className="animate-spin" />
      Loading dashboard…
    </div>
  )

  if (error) return (
    <div style={{ margin: '24px', padding: '14px', background: '#FCEBEB',
                  border: '0.5px solid #F09595', borderRadius: '10px',
                  color: '#791F1F', fontSize: '13px', display: 'flex', gap: '8px' }}>
      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
      <div>
        <strong>Could not load dashboard.</strong> {error}
        <br />
        <span style={{ fontSize: '12px' }}>
          Make sure your Supabase tables exist and RLS is disabled for development.
        </span>
      </div>
    </div>
  )

  // Show empty state if no data yet — guides the user to add data
  const isEmpty = !data || (
    data.activeShipments.length === 0 &&
    data.monthRevenueEtb === 0 &&
    data.inventoryValueEtb === 0
  )

  if (isEmpty) return (
    <div style={{ padding: '40px', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
      <div style={{ fontSize: '32px', marginBottom: '12px' }}>📦</div>
      <h1 style={{ fontSize: '20px', fontWeight: 500, marginBottom: '8px' }}>
        Welcome to ImportERP
      </h1>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px',
                  lineHeight: '1.6', marginBottom: '24px' }}>
        Your dashboard is empty because no data has been added yet.
        Start by adding your first supplier and shipment.
      </p>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link to="/suppliers" style={{
          padding: '8px 18px', background: '#185FA5', color: '#fff',
          borderRadius: '8px', textDecoration: 'none', fontSize: '13px',
        }}>
          Add first supplier
        </Link>
        <Link to="/shipments" style={{
          padding: '8px 18px', border: '0.5px solid var(--color-border-secondary)',
          borderRadius: '8px', textDecoration: 'none', fontSize: '13px',
          color: 'var(--color-text-primary)',
        }}>
          Add first shipment
        </Link>
      </div>
    </div>
  )

  const d = data!
  const vsLast = d.pl.prevNetProfit > 0
    ? Math.round((d.pl.netProfit - d.pl.prevNetProfit) / d.pl.prevNetProfit * 100)
    : 0
  const overdueAR  = d.receivables.filter(r => r.is_overdue)

  return (
    <div style={{ padding: '16px', maxWidth: '1200px', margin: '0 auto' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'flex-start', marginBottom: '14px' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 500 }}>
            {now.getHours() < 12 ? 'Good morning' : 'Good afternoon'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
            {now.toLocaleDateString('en-ET', { weekday:'long', year:'numeric',
                                               month:'long', day:'numeric' })}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {refreshed && (
            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              Updated {refreshed.toLocaleTimeString()}
            </span>
          )}
          <button onClick={refresh} style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '5px 11px', border: '0.5px solid var(--color-border-secondary)',
            borderRadius: '8px', background: 'var(--color-background-primary)',
            color: 'var(--color-text-secondary)', fontSize: '11px', cursor: 'pointer',
          }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* Alert banners */}
      {overdueAR.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 13px',
          background: '#FAEEDA', border: '0.5px solid #FAC775', borderRadius: '10px',
          fontSize: '12px', color: '#633806', marginBottom: '12px',
        }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
          <span>
            <strong>{overdueAR.length} customer invoice{overdueAR.length > 1 ? 's' : ''} overdue:</strong>
            {' '}{overdueAR.map(r => `${r.customer_name} (${r.days} days)`).join(' · ')}
          </span>
        </div>
      )}

      {d.lowStockCount > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 13px',
          background: '#FCEBEB', border: '0.5px solid #F09595', borderRadius: '10px',
          fontSize: '12px', color: '#791F1F', marginBottom: '12px',
        }}>
          <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          <span><strong>{d.lowStockCount} products</strong> below safety stock — consider placing orders.</span>
        </div>
      )}

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))',
                    gap: '10px', marginBottom: '14px' }}>
        {[
          { label: 'Inventory value',   value: N(d.inventoryValueEtb), unit: 'ETB', color: '#0C447C', icon: Package },
          { label: 'Month revenue',     value: N(d.monthRevenueEtb),   unit: 'ETB', color: '#27500A', icon: TrendingUp },
          { label: 'Gross profit',      value: N(d.grossProfitEtb),    unit: 'ETB', color: '#27500A', icon: TrendingUp },
          { label: 'Supplier payable',  value: '$' + N(d.totalPayableUsd), unit: 'USD', color: '#633806', icon: Building2 },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--color-background-secondary)',
                                      borderRadius: '10px', padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px',
                          fontSize: '10px', color: 'var(--color-text-tertiary)',
                          textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>
              <k.icon size={12} />
              {k.label}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 500, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)',
                          marginTop: '2px' }}>{k.unit}</div>
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Active shipments */}
          <div style={card}>
            <div style={cardHead}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px',
                            fontSize: '12px', fontWeight: 500 }}>
                <Ship size={14} color="#185FA5" /> Active shipments
              </div>
              <Link to="/shipments" style={{ fontSize: '11px', color: '#185FA5',
                                             textDecoration: 'none' }}>
                View all →
              </Link>
            </div>
            <div style={{ padding: '4px 0' }}>
              {d.activeShipments.length === 0 ? (
                <div style={{ padding: '20px 14px', textAlign: 'center',
                              fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                  No active shipments.{' '}
                  <Link to="/shipments" style={{ color: '#185FA5' }}>Add one →</Link>
                </div>
              ) : d.activeShipments.map(s => {
                const st = STATUS[s.status] ?? STATUS['ORDERED']
                return (
                  <div key={s.id} style={{
                    padding: '10px 14px',
                    borderBottom: '0.5px solid var(--color-border-tertiary)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                                  alignItems: 'center', marginBottom: '3px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 500 }}>
                        {s.shipment_number}
                      </span>
                      <span style={{ fontSize: '10px', fontWeight: 500,
                                     padding: '2px 7px', borderRadius: '99px',
                                     background: st.bg, color: st.color }}>
                        {st.label}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                      {s.supplier_name} · {s.container_number || '—'}
                      {s.eta_djibouti ? ` · ETA ${s.eta_djibouti}` : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* P&L */}
          <div style={card}>
            <div style={cardHead}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px',
                            fontSize: '12px', fontWeight: 500 }}>
                <TrendingUp size={14} color="#3B6D11" /> This month — P&L
              </div>
              <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                {now.toLocaleString('default', { month: 'long' })} {now.getFullYear()}
              </span>
            </div>
            <div style={{ padding: '10px 14px' }}>
              {[
                { label: 'Revenue',           val: d.pl.revenue,     color: '#0C447C', bold: false },
                { label: 'Cost of goods',     val: -d.pl.cogs,       color: '#791F1F', bold: false },
                { label: 'Gross profit',      val: d.pl.grossProfit, color: '#27500A', bold: true  },
                { label: 'Est. net profit',   val: d.pl.netProfit,   color: '#27500A', bold: true  },
              ].map(row => (
                <div key={row.label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 0', borderBottom: '0.5px solid var(--color-border-tertiary)',
                }}>
                  <span style={{ fontSize: '12px', color: row.bold
                    ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                    fontWeight: row.bold ? 500 : 400 }}>
                    {row.label}
                  </span>
                  <span style={{ fontSize: '12px', fontFamily: 'monospace',
                                 fontWeight: row.bold ? 500 : 400, color: row.color }}>
                    {row.val < 0 ? '-' : ''}{N(Math.abs(row.val))} ETB
                  </span>
                </div>
              ))}
              {d.pl.prevNetProfit > 0 && (
                <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between',
                              fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                  <span>vs last month</span>
                  <span style={{ color: vsLast >= 0 ? '#27500A' : '#791F1F', fontWeight: 500 }}>
                    {vsLast >= 0 ? '+' : ''}{vsLast}%
                  </span>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Inventory */}
          <div style={card}>
            <div style={cardHead}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px',
                            fontSize: '12px', fontWeight: 500 }}>
                <Package size={14} color="#534AB7" /> Inventory
              </div>
              <Link to="/inventory" style={{ fontSize: '11px', color: '#185FA5',
                                             textDecoration: 'none' }}>
                Manage →
              </Link>
            </div>
            <div style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between',
                            fontSize: '11px', color: 'var(--color-text-secondary)',
                            marginBottom: '10px' }}>
                <span>Total value</span>
                <span style={{ fontWeight: 500, color: '#0C447C', fontFamily: 'monospace' }}>
                  {N(d.inventoryValueEtb)} ETB
                </span>
              </div>
              {d.inventory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '12px 0',
                              fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                  No inventory yet — receive a shipment first.
                </div>
              ) : d.inventory.slice(0, 5).map(item => (
                <div key={item.sku} style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between',
                                alignItems: 'center', marginBottom: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 500 }}>{item.product_name}</span>
                      {item.is_low && (
                        <span style={{ fontSize: '9px', fontWeight: 500, padding: '1px 5px',
                                       borderRadius: '99px', background: '#FCEBEB', color: '#791F1F' }}>
                          Low
                        </span>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '12px', fontFamily: 'monospace', fontWeight: 500 }}>
                        {item.quantity_on_hand} pcs
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)',
                                     marginLeft: '6px' }}>
                        {N(item.total_value / 1000)}K ETB
                      </span>
                    </div>
                  </div>
                  <div style={{ height: '3px', background: 'var(--color-border-tertiary)',
                                borderRadius: '99px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: '99px',
                      width: `${Math.min(100, item.quantity_on_hand / 5)}%`,
                      background: item.is_low ? '#E24B4A' : '#185FA5',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Payables + Receivables */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>

            <div style={card}>
              <div style={{ ...cardHead, padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px',
                              fontSize: '11px', fontWeight: 500 }}>
                  <Building2 size={13} color="#854F0B" /> Payables
                </div>
              </div>
              <div style={{ padding: '10px 12px' }}>
                <div style={{ fontSize: '14px', fontWeight: 500, color: '#633806',
                              fontFamily: 'monospace', marginBottom: '8px' }}>
                  ${N(d.totalPayableUsd)}
                </div>
                {d.payables.length === 0 ? (
                  <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                    No outstanding payables.
                  </div>
                ) : d.payables.slice(0, 3).map(p => (
                  <div key={p.supplier_name} style={{
                    padding: '5px 0', borderBottom: '0.5px solid var(--color-border-tertiary)',
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 500,
                                  whiteSpace: 'nowrap', overflow: 'hidden',
                                  textOverflow: 'ellipsis' }}>
                      {p.supplier_name.split(' ').slice(0, 2).join(' ')}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                                  fontSize: '10px', color: 'var(--color-text-tertiary)',
                                  marginTop: '1px' }}>
                      <span>{p.payment_terms}</span>
                      <span style={{ color: '#633806', fontFamily: 'monospace', fontWeight: 500 }}>
                        ${N(p.outstanding_usd)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={card}>
              <div style={{ ...cardHead, padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px',
                              fontSize: '11px', fontWeight: 500 }}>
                  <Receipt size={13} color="#A32D2D" /> Receivables
                </div>
              </div>
              <div style={{ padding: '10px 12px' }}>
                <div style={{ fontSize: '14px', fontWeight: 500, color: '#791F1F',
                              fontFamily: 'monospace', marginBottom: '8px' }}>
                  {N(d.totalReceivableEtb / 1000)}K ETB
                </div>
                {d.receivables.length === 0 ? (
                  <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                    No outstanding invoices.
                  </div>
                ) : d.receivables.slice(0, 3).map(r => (
                  <div key={r.customer_name} style={{
                    padding: '5px 0', borderBottom: '0.5px solid var(--color-border-tertiary)',
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 500,
                                  whiteSpace: 'nowrap', overflow: 'hidden',
                                  textOverflow: 'ellipsis' }}>
                      {r.customer_name.split(' ').slice(0, 2).join(' ')}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                                  fontSize: '10px', marginTop: '1px' }}>
                      <span style={{ color: r.is_overdue ? '#A32D2D' : 'var(--color-text-tertiary)' }}>
                        {r.is_overdue ? `${r.days}d overdue` : `${r.days}d`}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>
                        {N(r.outstanding_etb / 1000)}K
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Production */}
          <div style={card}>
            <div style={cardHead}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px',
                            fontSize: '12px', fontWeight: 500 }}>
                <Wrench size={14} color="#185FA5" /> Production today
              </div>
              <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                {new Date().toLocaleDateString('en-ET', { month: 'short', day: 'numeric' })}
              </span>
            </div>
            <div style={{ padding: '10px 14px' }}>
              {d.production.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '12px 0',
                              fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                  No production logged today yet.{' '}
                  <Link to="/production" style={{ color: '#185FA5' }}>Log now →</Link>
                </div>
              ) : d.production.map(p => {
                const pct = p.target_units > 0
                  ? Math.min(100, Math.round(p.today_units / p.target_units * 100))
                  : 0
                const barColor = pct >= 80 ? '#639922' : pct >= 50 ? '#185FA5' : '#EF9F27'
                return (
                  <div key={p.product_name} style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                                  alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontSize: '12px' }}>{p.product_name}</span>
                      <span style={{ fontSize: '12px', fontFamily: 'monospace',
                                     fontWeight: 500, color: '#0C447C' }}>
                        {p.today_units}
                        <span style={{ color: 'var(--color-text-tertiary)',
                                       fontWeight: 400 }}> / {p.target_units}</span>
                      </span>
                    </div>
                    <div style={{ height: '5px', background: 'var(--color-border-tertiary)',
                                  borderRadius: '99px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: '99px',
                                    width: `${pct}%`, background: barColor,
                                    transition: 'width .3s' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}