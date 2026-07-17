import { useState, useMemo, isValidElement, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ChevronRight, Search, ListChecks } from 'lucide-react'

interface DocGroup { title: string; sections: DocSectionDef[] }
interface DocSectionDef { id: string; title: string; roles?: string; body: React.ReactNode }

function RoleBadge({ roles }: { roles?: string }) {
  if (!roles) return null
  return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 mb-2">{roles}</span>
}

// Flattens a section's JSX body down to plain text so the search box can
// match against actual sentence content, not just section titles — the
// docs live as JSX (for links/formatting), so there's no separate plain-text
// copy to search without either duplicating every sentence or walking the
// rendered tree like this.
function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join(' ')
  if (isValidElement(node)) return extractText((node.props as { children?: ReactNode }).children)
  return ''
}

const QUICK_START: { step: number; title: string; detail: React.ReactNode }[] = [
  {
    step: 1,
    title: 'Add your products',
    detail: <>Go to <Link to="/products" className="text-blue-600 hover:underline">Products</Link> and add what you sell/stock — SKU, name, and assembly type (Imported / Full / SKD / CKD) are the essentials. Got a spreadsheet already? Use <strong>Bulk import</strong> to paste the whole list instead of typing each one.</>,
  },
  {
    step: 2,
    title: 'Add suppliers and customers',
    detail: <>Add sourcing contacts on <Link to="/suppliers" className="text-blue-600 hover:underline">Suppliers</Link> and buyers on <Link to="/customers" className="text-blue-600 hover:underline">Customers</Link> — or skip this and add them inline the first time you create a shipment or record a sale.</>,
  },
  {
    step: 3,
    title: 'If you assemble products, set up a BOM',
    detail: <>On <Link to="/boms" className="text-blue-600 hover:underline">BOMs</Link>, define what components (and how many of each) go into one unit of a finished product. This unlocks <Link to="/production" className="text-blue-600 hover:underline">Production</Link> and <Link to="/assembly" className="text-blue-600 hover:underline">Assembly</Link> logging. Skip this if you only resell imported goods as-is.</>,
  },
  {
    step: 4,
    title: 'Bring in a shipment',
    detail: <>On <Link to="/shipments" className="text-blue-600 hover:underline">Shipments</Link>, create one for a supplier order, add its Proforma Invoice line items, and move its status forward as it progresses. When it lands and its status reaches "Warehouse Received," stock posts automatically — nothing to enter manually.</>,
  },
  {
    step: 5,
    title: 'Record a sale',
    detail: <>On <Link to="/sales" className="text-blue-600 hover:underline">Sales</Link>, pick a customer and warehouse, tap products to build the order, and choose how it's paid. The Dashboard's quick-actions panel does the same thing in a shorter form if you just need to log one fast.</>,
  },
  {
    step: 6,
    title: 'Check the Dashboard daily',
    detail: <>The <Link to="/" className="text-blue-600 hover:underline">Dashboard</Link> is where you should land every day — today's numbers, what needs attention, and one-tap shortcuts for the actions above. Use the search bar there to jump straight to any product, customer, order, or shipment by name.</>,
  },
  {
    step: 7,
    title: 'Set up payroll (HR & System role)',
    detail: <>Add staff on <Link to="/employees" className="text-blue-600 hover:underline">Employees</Link>, then create a monthly run on <Link to="/payroll" className="text-blue-600 hover:underline">Payroll</Link> — it pre-fills every active employee and you only need to touch the ones with overtime, absences, or other adjustments that month.</>,
  },
]

const GROUPS: DocGroup[] = [
  {
    title: 'Getting started',
    sections: [
      {
        id: 'roles',
        title: 'Roles & what each one can do',
        body: (
          <>
            <p>Every account has one role, set by an admin on the <Link to="/users" className="text-blue-600 hover:underline">Users &amp; Roles</Link> page. A role controls both what shows up in the sidebar and, since the RLS hardening pass, what the account can actually read or write at the database level — not just what the UI shows.</p>
            <ul className="list-disc pl-4 space-y-1 mt-2">
              <li><strong>Full access</strong> — passes every check everywhere. CEO/GM/Assistant Manager tier.</li>
              <li><strong>Operations &amp; Marketing</strong> — Shipments, Suppliers, Customers, Products, Djibouti Forwarder, Inventory, Warehouse Transfers, Customs Estimator.</li>
              <li><strong>Manufacturing &amp; Sales</strong> — Production, Assembly, BOMs, Inventory, Warehouse Transfers, Sales, Customers, Products.</li>
              <li><strong>Accounting &amp; Finance</strong> — Sales, Cost Engine, Customs Estimator, Payables, Receivables, Money Tracking, Credit Accounts, Expenses, Djibouti Forwarder, shipment cost finalization.</li>
              <li><strong>HR &amp; System</strong> — Users &amp; Roles, Settings, Employees, Payroll, HR Notes.</li>
              <li><strong>Pending</strong> — a brand-new sign-up with no role yet. Sees a "waiting for approval" screen and nothing else until an HR &amp; System admin assigns a role.</li>
            </ul>
            <p className="mt-2">Dashboard, Daily Activity, Reports, and Calculator are visible to every assigned role — they're read-only overviews or personal tools, not tied to one department.</p>
          </>
        ),
      },
      {
        id: 'pin-lock',
        title: 'PIN lock',
        body: (
          <>
            <p>A bank-app-style relock layer on top of your login. The first time you sign in after getting a role, you're asked to set a 4-digit PIN. After that, the app locks:</p>
            <ul className="list-disc pl-4 space-y-1 mt-2">
              <li>Every time you reopen the tab (the lock state lives only in memory, not saved between visits).</li>
              <li>After 10 minutes of no activity while it's open.</li>
            </ul>
            <p className="mt-2">Forgot your PIN? On the lock screen, "Forgot PIN?" re-verifies your identity with your account password, then lets you set a new one. You can also change your PIN any time from the sidebar's "Change PIN" link.</p>
          </>
        ),
      },
      {
        id: 'mobile-toggle',
        title: 'Mobile version vs. full version',
        body: (
          <>
            <p>The "Mobile version" / "Full version" toggle near the top-right is a real, saved choice — not just a screen-size thing. "Full version" always shows the sidebar and full desktop layout, even on a phone (you'll scroll). "Mobile version" always shows the simplified bottom-nav layout, even on a wide screen.</p>
            <p className="mt-2">Four pages have a purpose-built mobile version for quick entry on the move: <strong>Home</strong> (KPI tiles + quick actions), <strong>Sales</strong> (order list + a streamlined new-sale flow), <strong>Production</strong> (tap a product, type today's quantity, log it), and <strong>Money Tracking</strong> (add income/expense + recent transactions). Every other page keeps its normal desktop layout in mobile mode, with horizontal scrolling available.</p>
          </>
        ),
      },
      {
        id: 'dashboard-quick-actions',
        title: 'Dashboard quick actions',
        body: (
          <p>The panel on the right side of the Dashboard (desktop) lets you record a sale, a payment, an expense, or today's production without leaving the page — each opens a small modal and refreshes the Dashboard's numbers when you're done. They call the exact same functions as the full Sales/Money Tracking/Production pages, just in a shorter form.</p>
        ),
      },
    ],
  },
  {
    title: 'Import & shipments',
    sections: [
      {
        id: 'shipments',
        title: 'Shipments — the whole import lifecycle',
        roles: 'Operations & Marketing',
        body: (
          <>
            <p>A shipment tracks one container/order from being placed with a supplier through to landing in your warehouse. The status field moves it through: <span className="font-mono text-xs">ORDERED → IN_PRODUCTION → SHIPPED → AT_DJIBOUTI → IN_TRANSIT → AT_CUSTOMS → WAREHOUSE_RECEIVED → COMPLETED</span>.</p>
            <p className="mt-2"><strong>To create one:</strong> Shipments → New shipment → pick a supplier, container/vessel details, ETD/ETA dates, and a cost-allocation method (how shared costs like freight get split across the items in it — by quantity, weight, volume, or value).</p>
            <p className="mt-2"><strong>Line items:</strong> open the shipment → Proforma Invoice items. Add each product line as it appears on the supplier's PI (product, quantity, unit price in USD). For a big PI, use <strong>Paste PI items</strong> instead of adding rows one at a time — paste a table copied from a spreadsheet or the PI itself (SKU, quantity, unit price), preview it, fix anything, then import the whole batch. SKUs need to already exist on the Products page.</p>
            <p className="mt-2"><strong>Expenses:</strong> freight, insurance, customs duty, port handling, etc. get logged against the shipment and roll up into its landed cost.</p>
            <p className="mt-2"><strong>Deleting a shipment:</strong> the trash icon on the list or detail page removes the shipment and everything tied to it (items, expenses, damage reports, Djibouti transfers, any inventory it posted) in one transaction. You have to type the shipment number to confirm — and if it's past "Ordered" and its goods may already be in inventory or sold, you'll see an explicit warning, since deleting it after that point can leave stock counts wrong.</p>
          </>
        ),
      },
      {
        id: 'djibouti',
        title: 'Djibouti Forwarder',
        roles: 'Operations & Marketing, Accounting & Finance',
        body: (
          <>
            <p>Handles the leg between a shipment landing at the port of Djibouti and it actually reaching your warehouse in Addis — dispatch requests, trucking, and confirming receipt at Ali's forwarding warehouse.</p>
            <p className="mt-2">When a shipment's status is set to "At Djibouti," its items post into Ali's warehouse automatically. For SKD/CKD products, this correctly lands as the finished-good kit at this stage — decomposition into individual components only happens later, at final assembly, not here.</p>
            <p className="mt-2">The <strong>"Sent from China vs. received at Ali"</strong> panel cross-checks what a shipment's PI said was sent against what actually landed in the ledger, per product — a quick way to catch a shipment that's short or was double-posted.</p>
          </>
        ),
      },
      {
        id: 'suppliers-customers-products',
        title: 'Suppliers, Customers & Products',
        roles: 'Operations & Marketing (+ Manufacturing & Sales for Customers/Products)',
        body: (
          <>
            <p><strong>Suppliers</strong> — your overseas/local sourcing contacts, linked from Shipments and Purchase Orders/Payables.</p>
            <p className="mt-2"><strong>Customers</strong> — can be created inline from the Sales page when recording a walk-in sale, not just from the Customers page itself. Opening a credit account for a customer can happen from Customers, Credit Accounts, or automatically the first time a brand-new customer pays by credit on Sales.</p>
            <p className="mt-2"><strong>Products</strong> — every sellable/stockable item, with its assembly type (Imported / Full / SKD / CKD — this determines how it decomposes into components when received) and an optional photo shown in pickers across the app. Use <strong>Bulk import</strong> to paste a whole product list (from a supplier's catalog, a spreadsheet) instead of adding one at a time — SKU and name are the only required fields.</p>
          </>
        ),
      },
    ],
  },
  {
    title: 'Manufacturing',
    sections: [
      {
        id: 'production',
        title: 'Production',
        roles: 'Manufacturing & Sales',
        body: (
          <>
            <p>Daily production logging, organized by stage (Assembly, Sticker Application, Other). Pick a warehouse, enter today's quantity for one or more BOMs, and save — the system credits the finished product and debits the BOM's components in the same action, after confirming every component has enough stock (a log never partially succeeds and leaves phantom finished goods with nothing consumed to make them).</p>
            <p className="mt-2">If there's an open production order for that BOM at that warehouse, the log attaches to it and advances its progress; otherwise it stands alone as a same-day log.</p>
          </>
        ),
      },
      {
        id: 'assembly',
        title: 'Assembly',
        roles: 'Manufacturing & Sales',
        body: (
          <p>A faster, single-product version of production logging specifically for turning SKD/CKD components into a finished good — shows exactly how many units you can assemble right now given current component stock, and only offers products with an active <em>Assembly</em>-stage BOM (Sticker/Other-stage BOMs live on the Production page instead). Uses the same order-matching and component-check logic as Production, so logging the same work through either page can't double-count it.</p>
        ),
      },
      {
        id: 'boms',
        title: 'BOMs (Bills of Materials)',
        roles: 'Manufacturing & Sales',
        body: <p>Defines what components (and how many of each) go into one unit of a finished product, tagged with a stage (Assembly / Sticker / Other). Production and Assembly both read from here to know what to consume when you log output.</p>,
      },
    ],
  },
  {
    title: 'Inventory',
    sections: [
      {
        id: 'inventory',
        title: 'Inventory — four views of the same stock',
        roles: 'Manufacturing & Sales, Operations & Marketing',
        body: (
          <>
            <ul className="list-disc pl-4 space-y-1.5">
              <li><strong>Stock levels</strong> — every product at every warehouse, with a status tier (OK / Low / Critical / Out of stock). Search and filter by warehouse.</li>
              <li><strong>Warehouse view</strong> — a pictorial, per-warehouse tile grid instead of a table, plus a highlighted "Can build N × [product]" readout wherever a warehouse has enough SKD/CKD component stock on hand to assemble more finished units than its own ledger shows.</li>
              <li><strong>Forecast</strong> — recency-weighted daily demand (last 30 days, weighted over the prior 30) per product, compared against effective stock (on-hand + buildable from components), ranked by days of runway left. No external API — pure statistics, refreshed on load.</li>
              <li><strong>Movement history</strong> — the raw ledger: every receipt, sale, adjustment, and consumption event, filterable by product.</li>
            </ul>
            <p className="mt-2"><strong>Adjust stock</strong> lets you post a manual correction (physical count, damage, opening balance) — a reason is required, since it becomes part of the permanent audit trail.</p>
          </>
        ),
      },
      {
        id: 'warehouse-transfers',
        title: 'Warehouse Transfers',
        roles: 'Manufacturing & Sales, Operations & Marketing',
        body: <p>Generic warehouse-to-warehouse stock moves — distinct from the Djibouti Forwarder's request/dispatch/confirm-receipt flow, which uses the same underlying table but its own specific lifecycle and is excluded from this page's list to avoid double-processing a Djibouti-originated transfer.</p>,
      },
    ],
  },
  {
    title: 'Sales',
    sections: [
      {
        id: 'sales',
        title: 'Sales',
        roles: 'Manufacturing & Sales, Accounting & Finance',
        body: (
          <>
            <p>Record a sale: pick a customer (or add one inline), a warehouse (stock and price history per product show up once you do), tap products to build a cart, and choose how it's paid — cash, transfer, mobile money, or credit.</p>
            <p className="mt-2">Paying by <strong>credit</strong> for a brand-new customer created right there on the page automatically opens a credit account for them sized to the order, instead of blocking the sale on "no credit account exists yet."</p>
            <p className="mt-2">If the order goes through but recording its payment fails afterward (a network blip, a missing credit account edge case), the order still stands — you'll see a message pointing at Receivables to finish recording payment, and the form resets rather than inviting a duplicate resubmission.</p>
            <p className="mt-2">Search, status, customer, and date-range filters are available above the order list.</p>
          </>
        ),
      },
    ],
  },
  {
    title: 'Finance',
    sections: [
      {
        id: 'money-tracking',
        title: 'Money Tracking',
        roles: 'Accounting & Finance',
        body: (
          <>
            <p>Every payment in and out of the business in one feed — sales payments, supplier payments, credit repayments, company expenses, and shipment expenses marked paid via Payables — with search, direction, method, and date-range filters, plus a 14-day net cash-flow mini chart.</p>
            <p className="mt-2"><strong>Insights panel:</strong> flags unusual transactions two ways — an amount far outside the typical size for its payment type, or the same party/amount/currency showing up twice within a few days (the signature of a duplicate entry). Purely statistical, no external API.</p>
            <p className="mt-2">Click a <strong>credit account</strong> row to expand its full draw/repayment history inline, without leaving the page.</p>
          </>
        ),
      },
      {
        id: 'credit-accounts',
        title: 'Credit Accounts',
        roles: 'Accounting & Finance',
        body: (
          <>
            <p>A customer's revolving credit line — draws happen automatically when a sale is made on credit terms; repayments are recorded here.</p>
            <p className="mt-2">When recording a repayment, you can optionally target a specific outstanding credit-funded order — doing so marks that order's own paid amount up too (and flips its status once it's fully covered), not just the account's overall balance. Leave it as "general repayment" and it behaves like before: only the revolving balance moves.</p>
            <p className="mt-2">A negative balance (customer paid more than they owed) shows as <strong>"overpaid"</strong>, not "settled" — those aren't the same thing.</p>
          </>
        ),
      },
      {
        id: 'payables-receivables',
        title: 'Payables & Receivables',
        roles: 'Accounting & Finance',
        body: (
          <>
            <p><strong>Payables</strong> — outstanding supplier POs and unpaid shipment expenses in one list, with per-currency totals (USD/ETB/CNY) and an overdue count. "Mark as paid" on a shipment expense stamps the actual paid date, which is what makes it show up correctly on Money Tracking and Reports afterward.</p>
            <p className="mt-2"><strong>Receivables</strong> — what customers owe on invoiced/partially-paid orders, with days-outstanding and an overdue (30+ days) flag.</p>
          </>
        ),
      },
      {
        id: 'expenses-cost-tools',
        title: 'Expenses, Cost Engine & Customs Estimator',
        roles: 'Accounting & Finance (Customs Estimator also Operations & Marketing)',
        body: <p>Company-wide operating expenses (rent, salaries, fuel, utilities…) separate from shipment-specific costs; the Cost Engine and Customs Estimator help price out landed cost and customs duty/VAT/surtax before or during a shipment's cost finalization.</p>,
      },
    ],
  },
  {
    title: 'HR & Payroll',
    sections: [
      {
        id: 'employees',
        title: 'Employees',
        roles: 'HR & System',
        body: <p>The staff directory — name, department, title, employment type (permanent / daily-wage / casual), hire date, pay rate, pension eligibility, bank and TIN details. Other pages that just need a plain "who did this" name (who paid an expense, who's logging production) read a restricted view that excludes salary/bank/TIN, so those roles never see sensitive HR data even indirectly.</p>,
      },
      {
        id: 'payroll',
        title: 'Payroll',
        roles: 'HR & System',
        body: (
          <>
            <p>Create a monthly pay run — it seeds a draft entry for every active employee, pre-calculated with no overtime or extra deductions. Open an entry to adjust days worked (daily-wage/casual), add overtime by type (weekday/night/rest-day/public-holiday, each at its own legal multiplier), allowances, or other deductions (loans, absences, advances) — every save fully recalculates gross pay, pension, income tax, and net pay from scratch, never a partial patch.</p>
            <p className="mt-2">Print a payslip per employee any time. <strong>Finalizing</strong> a run locks it and optionally records the total net pay as a company expense, so it flows into Money Tracking and Reports too.</p>
            <p className="mt-2">See <Link to="/hr-notes" className="text-blue-600 hover:underline">HR Notes</Link> for exactly which tax brackets, pension rates, and overtime rules are being applied, and how confident each figure is.</p>
          </>
        ),
      },
    ],
  },
  {
    title: 'Reports, Dashboard & tools',
    sections: [
      {
        id: 'dashboard-reports',
        title: 'Dashboard & Reports',
        body: (
          <>
            <p><strong>Dashboard</strong> — today/this-week/this-month KPIs with period-over-period trends, an auto-generated top-priority advice card, drill-downs ("What sold best?", "Where are we losing money?", "What should I do today?"), and the quick-actions panel. Every card is clickable through to its full page.</p>
            <p className="mt-2"><strong>Reports</strong> — six-month profit &amp; loss (revenue/COGS/margin, from invoiced-or-paid orders only — matches the Dashboard's own revenue definition), a cash-flow chart across every payment source in the app, and a payables/receivables snapshot.</p>
          </>
        ),
      },
      {
        id: 'calculator',
        title: 'Calculator',
        body: (
          <>
            <p>A small spreadsheet, open to every role: type values or formulas (<span className="font-mono text-xs">=SUM(A1:A5)</span>, <span className="font-mono text-xs">=IF(...)</span>, cell references, ranges) into a grid, visualize any two ranges as a bar/line/pie chart, and save named sheets for later — each user only sees their own.</p>
            <p className="mt-2">Templates ("Landed cost", "Margin &amp; pricing", "Currency conversion") drop a pre-built, labeled starting sheet you can edit like any other.</p>
          </>
        ),
      },
      {
        id: 'daily-activity',
        title: 'Daily Activity',
        body: <p>A rolled-up feed of what happened today across the business, for anyone to check without digging through individual pages.</p>,
      },
    ],
  },
]

// Precomputed once at module load — GROUPS is static, so there's no need
// to re-walk the JSX tree on every keystroke.
const SEARCH_INDEX = new Map(
  GROUPS.flatMap(g => g.sections.map(s => [s.id, `${s.title} ${g.title} ${s.roles ?? ''} ${extractText(s.body)}`.toLowerCase()] as const))
)

export function Documentation() {
  const [activeId, setActiveId] = useState(GROUPS[0].sections[0].id)
  const [query, setQuery] = useState('')

  function scrollTo(id: string) {
    setActiveId(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const q = query.trim().toLowerCase()
  const matchedGroups = useMemo(() => {
    if (!q) return GROUPS
    return GROUPS
      .map(group => ({ ...group, sections: group.sections.filter(s => SEARCH_INDEX.get(s.id)?.includes(q)) }))
      .filter(group => group.sections.length > 0)
  }, [q])
  const matchCount = useMemo(() => matchedGroups.reduce((n, g) => n + g.sections.length, 0), [matchedGroups])

  return (
    <div className="p-5 max-w-6xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-medium flex items-center gap-2"><BookOpen size={18} /> Documentation</h1>
          <p className="text-xs text-gray-400 mt-0.5">How every part of the ERP actually works — one page, organized by module</p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search the docs…"
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
      </div>

      {q && (
        <p className="text-xs text-gray-400 mb-3">{matchCount === 0 ? `No sections match "${query}".` : `${matchCount} section${matchCount === 1 ? '' : 's'} match "${query}".`}</p>
      )}

      {!q && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 mb-5">
          <p className="text-sm font-medium flex items-center gap-2 mb-3"><ListChecks size={15} className="text-blue-600" /> New here? Do these in order</p>
          <div className="space-y-3">
            {QUICK_START.map(item => (
              <div key={item.step} className="flex gap-3">
                <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-medium flex items-center justify-center mt-0.5">{item.step}</span>
                <div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-gray-600 leading-relaxed mt-0.5">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-5 items-start">
        <nav className="lg:sticky lg:top-5 space-y-4 max-h-[calc(100vh-100px)] overflow-y-auto">
          {matchedGroups.map(group => (
            <div key={group.title}>
              <p className="text-xs uppercase tracking-wide text-gray-400 mb-1.5">{group.title}</p>
              <div className="space-y-0.5">
                {group.sections.map(s => (
                  <button
                    key={s.id}
                    onClick={() => scrollTo(s.id)}
                    className={`w-full flex items-center gap-1 text-left px-2 py-1.5 rounded-lg text-xs transition-colors
                      ${activeId === s.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    <ChevronRight size={11} className="shrink-0 opacity-50" /> {s.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="space-y-4 min-w-0">
          {matchedGroups.map(group => (
            <div key={group.title} className="space-y-4">
              {group.sections.map(s => (
                <div key={s.id} id={s.id} className="bg-white border border-gray-200 rounded-xl p-5 scroll-mt-5">
                  <RoleBadge roles={s.roles} />
                  <h2 className="text-sm font-medium mb-2">{s.title}</h2>
                  <div className="text-sm text-gray-700 leading-relaxed space-y-2">{s.body}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
