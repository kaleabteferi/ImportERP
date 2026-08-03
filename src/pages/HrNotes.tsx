import { BookOpen, AlertTriangle, CheckCircle2, HelpCircle, XCircle, ChevronDown, Calculator, ClipboardCheck, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PAYE_BRACKETS, PENSION_EMPLOYEE_RATE, PENSION_EMPLOYER_RATE, OT_MULTIPLIERS, OT_LABELS, MONTHLY_HOURS_DIVISOR } from '../lib/payrollEngine'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'

const N = (n: number) => new Intl.NumberFormat('en-ET').format(n)

function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'unconfirmed' }) {
  const map = {
    high: { icon: CheckCircle2, variant: 'success' as const, label: 'Confirmed' },
    medium: { icon: HelpCircle, variant: 'warning' as const, label: 'Medium confidence' },
    unconfirmed: { icon: XCircle, variant: 'danger' as const, label: 'Unconfirmed — verify' },
  } as const
  const { icon: Icon, variant, label } = map[level]
  return <Badge variant={variant} icon={<Icon size={11} />}>{label}</Badge>
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group overflow-hidden rounded-2xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)]">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-background-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]">
        {title}<ChevronDown size={17} className="shrink-0 text-[var(--color-text-tertiary)] transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-[var(--color-border-tertiary)] px-4 py-4 text-sm leading-6 text-[var(--color-text-secondary)]">{children}</div>
    </details>
  )
}

export function HrNotes() {
  return (
    <div className="hr-notes-page p-4 sm:p-5 max-w-4xl mx-auto space-y-4">
      <PageHeader
        icon={<BookOpen size={18} />}
        title="HR Notes — Ethiopian payroll rules"
        subtitle="What this app's payroll calculations are actually based on, and how sure we are about each figure"
      />

      <div className="grid gap-3 md:grid-cols-2">
        <Card padded className="border-[var(--color-border-secondary)]">
          <div className="flex items-start gap-3"><span className="rounded-xl bg-[var(--color-panel-dark)] p-2 text-[var(--color-panel-dark-foreground)]"><ClipboardCheck size={18} /></span><div><p className="text-sm font-semibold text-[var(--color-text-primary)]">Before approving payroll</p><ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-5 text-[var(--color-text-secondary)]"><li>Confirm attendance and approved overtime.</li><li>Review salary, pension eligibility and deductions.</li><li>Resolve exceptions before HR or Finance approval.</li></ol><Link to="/payroll" className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-xs font-semibold text-blue-600">Open payroll <ArrowRight size={13} /></Link></div></div>
        </Card>
        <Card padded className="border-[var(--color-border-secondary)]">
          <div className="flex items-start gap-3"><span className="rounded-xl bg-[var(--color-accent)] p-2 text-[var(--color-accent-foreground)]"><Calculator size={18} /></span><div><p className="text-sm font-semibold text-[var(--color-text-primary)]">Test a payroll scenario</p><p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">Use the quick calculator to estimate gross pay, pension, PAYE, overtime and net pay without changing a payroll run.</p><Link to="/calculator" className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-xs font-semibold text-blue-600">Open calculator <ArrowRight size={13} /></Link></div></div>
        </Card>
      </div>

      <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-card text-xs text-amber-800">
        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
        <p>
          This page documents the specific rates and rules the Payroll feature calculates with, researched against
          professional tax/legal sources as of 17 Jul 2026. It is <strong>not legal or tax advice</strong>. Ethiopian
          tax brackets and directives change — verify current figures with a licensed accountant before relying on
          this for real compliance, and update <code className="font-mono">src/lib/payrollEngine.ts</code> if a rate changes.
        </p>
      </div>

      <Section title="Income tax (PAYE) — Income Tax (Amendment) Proclamation No. 1395/2025" defaultOpen>
        <p>Effective 8 July 2025. Confirmed by three independent professional sources (EY, Chambers and Partners, PwC Worldwide Tax Summaries). <ConfidenceBadge level="high" /></p>
        <div className="overflow-hidden border border-gray-100 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-400">
              <tr><th className="text-left px-3 py-2 font-medium">Monthly taxable income (ETB)</th><th className="text-right px-3 py-2 font-medium">Rate</th></tr>
            </thead>
            <tbody>
              {PAYE_BRACKETS.map((b, i) => {
                const lower = i === 0 ? 0 : PAYE_BRACKETS[i - 1].upTo + 1
                return (
                  <tr key={i} className="border-t border-gray-50">
                    <td className="px-3 py-1.5">{b.upTo === Infinity ? `Over ${N(lower - 1)}` : `${N(lower)} – ${N(b.upTo)}`}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{(b.rate * 100).toFixed(0)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">
          Calculated as an explicit marginal-bracket walk (each bracket's slice taxed at its own rate), not a
          "deduction shortcut" table — those constants couldn't be independently re-verified against the gazette
          for these new brackets, so this app avoids hard-coding one.
        </p>
        <p className="text-xs text-gray-500">
          Taxable income = gross pay − employee pension contribution. Standard practice, though not found as an
          explicit clause in the amendment text itself. <ConfidenceBadge level="medium" />
        </p>
      </Section>

      <Section title="Pension — Private Organization Employees' Pension Proclamation No. 1268/2022">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-50 rounded-lg px-3 py-2"><p className="text-xs text-gray-400">Employee contributes</p><p className="font-mono font-medium">{(PENSION_EMPLOYEE_RATE * 100).toFixed(0)}% of base salary</p></div>
          <div className="bg-gray-50 rounded-lg px-3 py-2"><p className="text-xs text-gray-400">Employer contributes</p><p className="font-mono font-medium">{(PENSION_EMPLOYER_RATE * 100).toFixed(0)}% of base salary</p></div>
        </div>
        <p><ConfidenceBadge level="high" /> Replaced the phased-in rates from the old 715/2011 proclamation with flat rates from day one.</p>
        <p className="text-xs text-gray-500">
          <strong>Who's covered:</strong> Ethiopian citizens engaged 45+ days — definite, indefinite, <em>or piece-work</em>.
          This is broader than "permanent employees only": a daily-wage factory worker on an ongoing arrangement past
          45 days is generally pension-eligible too, gated by engagement length, not pay structure. Mandatory for
          citizens; optional for foreign nationals of Ethiopian origin; unavailable to other foreign nationals. <ConfidenceBadge level="medium" />
        </p>
        <p className="text-xs text-gray-500">
          <strong>Salary ceiling:</strong> some payroll-vendor sites claim contributions cap at 15,000 ETB/month — this
          could not be confirmed against the proclamation text and looks like a recycled/templated claim. This app
          applies pension to the full base salary with no cap. <ConfidenceBadge level="unconfirmed" />
        </p>
      </Section>

      <Section title="Overtime — Labour Proclamation No. 1156/2019, Article 68">
        <p>Normal working hours (Art. 61): 8 hours/day, 48 hours/week. Overtime capped at 4 hours/day or 12 hours/week.</p>
        <div className="overflow-hidden border border-gray-100 rounded-lg">
          <table className="w-full text-xs">
            <tbody>
              {(Object.keys(OT_LABELS) as (keyof typeof OT_LABELS)[]).map((k, i) => (
                <tr key={k} className={i > 0 ? 'border-t border-gray-50' : ''}>
                  <td className="px-3 py-1.5">{OT_LABELS[k]}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-medium">{OT_MULTIPLIERS[k]}×</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p><ConfidenceBadge level="high" /> Sourced from a direct quote of Article 68 text. A different, lower schedule (1.25×/1.5×/2×) circulates on generic international payroll-guide sites but couldn't be traced to any Ethiopian statutory source.</p>
        <p className="text-xs text-gray-500">
          <strong>Hourly-rate conversion for monthly-salaried staff:</strong> this app divides monthly base salary by{' '}
          <strong>{MONTHLY_HOURS_DIVISOR}</strong> hours (30 days × 8 hrs) to get an hourly rate. The Proclamation
          doesn't itself specify this divisor — a competing 208-hour convention (48hr week × 4.33 weeks) also exists
          and produces a different hourly rate. <ConfidenceBadge level="unconfirmed" /> Daily-wage/casual workers use
          their actual daily rate ÷ 8 instead, which doesn't have this ambiguity.
        </p>
      </Section>

      <Section title="Minimum wage">
        <p>Ethiopia has <strong>no legally mandated private-sector minimum wage</strong> — one of few countries globally without one. A minimum figure exists only for federal civil service (public sector), which doesn't apply to a private employer. <ConfidenceBadge level="high" /></p>
      </Section>

      <Section title="Severance pay — Labour Proclamation 1156/2019, Articles 39-40">
        <p className="text-xs text-gray-500">Not calculated automatically in a regular pay run — this is a termination-time event with its own eligibility rules. A reference calculator is available via the Calculator page.</p>
        <p><strong>Eligibility:</strong> completed probation, not pension-eligible for retirement, and termination falls under an enumerated ground (business closure, redundancy, permanent disability, 5+ years' resignation, employer misconduct, etc.) — not payable for fault-based dismissal.</p>
        <p><strong>Formula</strong> (direct quote of Art. 40): 30× average daily wage (last week of service) for the first year; +⅓ of that (10 days) per additional full year; capped at 12 months' total wages. <ConfidenceBadge level="high" /></p>
      </Section>

      <Section title="Annual & sick leave — Labour Proclamation 1156/2019, Articles 76-86">
        <p><strong>Annual leave:</strong> 16 working days in year 1, +1 day per 2 additional years of service (no stated maximum found). <ConfidenceBadge level="high" /></p>
        <p><strong>Sick leave:</strong> up to 6 months (180 days) per rolling 12-month period — first month at 100% pay, next 2 months at 50%, remaining 3 months unpaid. Requires a medical certificate. <ConfidenceBadge level="high" /></p>
        <p className="text-xs text-gray-500">Not yet tracked as running balances in this app — a future addition, not part of the current Payroll feature.</p>
      </Section>

      <Section title="Other notes">
        <ul className="list-disc pl-4 space-y-1 text-xs text-gray-500">
          <li>No community/kebele payroll withholding tax was found to exist. <ConfidenceBadge level="medium" /></li>
          <li>Employment injury is an employer-borne direct liability (self-insure or pay compensation directly) under the Labour Proclamation, not a standard percentage-of-payroll withholding like pension. <ConfidenceBadge level="medium" /></li>
          <li>Temporary/casual contracts are capped at 45 consecutive days under the Proclamation's temporary-employment provisions — beyond that, an engagement generally reads as ongoing (daily-wage or permanent), with the fuller set of Labour Proclamation protections and pension coverage attaching.</li>
        </ul>
      </Section>
    </div>
  )
}
