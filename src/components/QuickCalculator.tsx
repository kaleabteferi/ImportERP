import { useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Calculator, Coins, Gauge, PackageCheck, Percent, RotateCcw } from 'lucide-react'
import { evaluateSheet, formatCellValue, isCellError } from '../lib/spreadsheet'
import { calculatePayrollEntry } from '../lib/payrollEngine'

type Tool = 'standard' | 'landed' | 'margin' | 'payroll' | 'efficiency'
const money = (value: number) => new Intl.NumberFormat('en-ET', { maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0)
const number = (value: string) => Number(value) || 0
const TOOLS: Array<{ id: Tool; label: string; icon: typeof Calculator }> = [
  { id: 'standard', label: 'Standard', icon: Calculator },
  { id: 'landed', label: 'Landed cost', icon: PackageCheck },
  { id: 'margin', label: 'Margin', icon: Percent },
  { id: 'payroll', label: 'Payroll', icon: Coins },
  { id: 'efficiency', label: 'Efficiency', icon: Gauge },
]

function Field({ label, value, onChange, suffix }: { label: string; value: string; onChange: (value: string) => void; suffix?: string }) {
  return <label className="block min-w-0"><span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">{label}</span><span className="flex min-h-11 items-center overflow-hidden rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] focus-within:ring-2 focus-within:ring-[var(--color-accent)]"><input type="number" inputMode="decimal" value={value} onChange={event => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none" />{suffix && <span className="border-l border-[var(--color-border-tertiary)] px-3 text-xs text-[var(--color-text-tertiary)]">{suffix}</span>}</span></label>
}

function Result({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`rounded-xl border px-3 py-3 ${strong ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]' : 'border-[var(--color-border-tertiary)] bg-[var(--color-background-secondary)]'}`}><p className="text-xs text-[var(--color-text-secondary)]">{label}</p><p className={`${strong ? 'text-xl' : 'text-base'} mt-1 font-semibold tabular-nums text-[var(--color-text-primary)]`}>{value}</p></div>
}

export function QuickCalculator() {
  const [tool, setTool] = useState<Tool>('standard')
  const [expression, setExpression] = useState('')
  const [landed, setLanded] = useState({ fob: '1000', freight: '200', insurance: '20', fx: '131', duty: '15', vat: '15', fees: '5000', qty: '100' })
  const [margin, setMargin] = useState({ cost: '500', target: '30', qty: '50' })
  const [payroll, setPayroll] = useState({ salary: '15000', allowance: '0', overtime: '0', deductions: '0' })
  const [efficiency, setEfficiency] = useState({ accepted: '950', rejected: '25', target: '1000', hours: '8' })

  const standardResult = useMemo(() => {
    if (!expression.trim()) return '0'
    const normalized = expression.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)')
    const value = evaluateSheet({ A1: `=${normalized}` }).A1
    return isCellError(value) ? 'Check the expression' : formatCellValue(value)
  }, [expression])
  const landedResult = useMemo(() => {
    const cifUsd = number(landed.fob) + number(landed.freight) + number(landed.insurance)
    const cifEtb = cifUsd * number(landed.fx)
    const duty = cifEtb * number(landed.duty) / 100
    const vat = (cifEtb + duty) * number(landed.vat) / 100
    const total = cifEtb + duty + vat + number(landed.fees)
    return { cifUsd, duty, vat, total, perUnit: number(landed.qty) > 0 ? total / number(landed.qty) : 0 }
  }, [landed])
  const marginResult = useMemo(() => {
    const cost = number(margin.cost)
    const rate = Math.min(99.99, number(margin.target)) / 100
    const price = rate < 1 ? cost / (1 - rate) : 0
    return { price, profit: price - cost, total: (price - cost) * number(margin.qty) }
  }, [margin])
  const payrollResult = useMemo(() => calculatePayrollEntry({
    employmentType: 'permanent', baseSalaryEtb: number(payroll.salary), dailyRateEtb: null, daysWorked: null,
    pensionEligible: true, overtimeLines: number(payroll.overtime) > 0 ? [{ ot_type: 'weekday', hours: number(payroll.overtime) }] : [],
    allowancesEtb: number(payroll.allowance), otherDeductions: number(payroll.deductions) > 0 ? [{ deduction_type: 'other', description: 'Quick estimate', amount_etb: number(payroll.deductions) }] : [],
  }), [payroll])
  const efficiencyResult = useMemo(() => {
    const accepted = number(efficiency.accepted), rejected = number(efficiency.rejected), target = number(efficiency.target), hours = number(efficiency.hours)
    return { efficiency: target > 0 ? accepted / target * 100 : 0, quality: accepted + rejected > 0 ? accepted / (accepted + rejected) * 100 : 0, output: hours > 0 ? accepted / hours : 0 }
  }, [efficiency])
  const patch = <T extends Record<string, string>>(setter: Dispatch<SetStateAction<T>>, key: keyof T, value: string) => setter(current => ({ ...current, [key]: value }))

  return <section className="mb-5 overflow-hidden rounded-[22px] border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] shadow-[var(--shadow-card-sm)]">
    <div className="border-b border-[var(--color-border-tertiary)] px-4 py-4 sm:px-5"><p className="text-xs font-semibold uppercase tracking-[.12em] text-[var(--color-text-tertiary)]">Quick calculation desk</p><div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Calculator tools">{TOOLS.map(item => <button key={item.id} role="tab" aria-selected={tool === item.id} onClick={() => setTool(item.id)} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${tool === item.id ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-foreground)]' : 'border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]'}`}><item.icon size={16} />{item.label}</button>)}</div></div>
    <div className="p-4 sm:p-5">
      {tool === 'standard' && <div className="grid gap-4 lg:grid-cols-[1fr_300px]"><div><label className="text-xs font-medium text-[var(--color-text-secondary)]" htmlFor="standard-expression">Expression</label><input id="standard-expression" value={expression} onChange={event => setExpression(event.target.value.replace(/[^0-9+\-*/().%^ ]/g, ''))} placeholder="Example: (12500 + 850) * 1.15" className="mt-1.5 min-h-12 w-full rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-secondary)] px-4 font-mono text-base text-[var(--color-text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]" /><div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">{['7','8','9','/','4','5','6','*','1','2','3','-','0','.','(',')','+','%','^'].map(key => <button key={key} onClick={() => setExpression(current => current + key)} className="min-h-11 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-background-primary)] text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background-secondary)]">{key}</button>)}<button onClick={() => setExpression('')} aria-label="Clear expression" className="min-h-11 rounded-xl border border-red-200 text-red-600 hover:bg-red-50"><RotateCcw size={16} className="mx-auto" /></button></div></div><Result label="Result" value={standardResult} strong /></div>}
      {tool === 'landed' && <div className="grid gap-5 xl:grid-cols-[1fr_360px]"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries({ fob: 'FOB value', freight: 'Freight', insurance: 'Insurance', fx: 'ETB / USD rate', duty: 'Duty rate', vat: 'VAT rate', fees: 'Other fees', qty: 'Units' }).map(([key, label]) => <Field key={key} label={label} value={landed[key as keyof typeof landed]} onChange={value => patch(setLanded, key as keyof typeof landed, value)} suffix={key === 'duty' || key === 'vat' ? '%' : key === 'qty' ? 'units' : key === 'fx' || key === 'fees' ? 'ETB' : 'USD'} />)}</div><div className="grid grid-cols-2 gap-3"><Result label="CIF value" value={`$ ${money(landedResult.cifUsd)}`} /><Result label="Duty" value={`${money(landedResult.duty)} ETB`} /><Result label="VAT" value={`${money(landedResult.vat)} ETB`} /><Result label="Total landed" value={`${money(landedResult.total)} ETB`} /><div className="col-span-2"><Result label="Landed cost per unit" value={`${money(landedResult.perUnit)} ETB`} strong /></div></div></div>}
      {tool === 'margin' && <div className="grid gap-5 lg:grid-cols-2"><div className="grid gap-3 sm:grid-cols-3"><Field label="Unit cost" value={margin.cost} onChange={value => patch(setMargin, 'cost', value)} suffix="ETB" /><Field label="Target gross margin" value={margin.target} onChange={value => patch(setMargin, 'target', value)} suffix="%" /><Field label="Units" value={margin.qty} onChange={value => patch(setMargin, 'qty', value)} /></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Result label="Selling price" value={`${money(marginResult.price)} ETB`} strong /><Result label="Profit / unit" value={`${money(marginResult.profit)} ETB`} /><Result label="Total profit" value={`${money(marginResult.total)} ETB`} /></div></div>}
      {tool === 'payroll' && <div className="grid gap-5 xl:grid-cols-[1fr_430px]"><div className="grid gap-3 sm:grid-cols-2"><Field label="Agreed monthly net base" value={payroll.salary} onChange={value => patch(setPayroll, 'salary', value)} suffix="ETB" /><Field label="Weekday overtime hours" value={payroll.overtime} onChange={value => patch(setPayroll, 'overtime', value)} suffix="hours" /><Field label="Allowances" value={payroll.allowance} onChange={value => patch(setPayroll, 'allowance', value)} suffix="ETB" /><Field label="Other deductions" value={payroll.deductions} onChange={value => patch(setPayroll, 'deductions', value)} suffix="ETB" /></div><div className="grid grid-cols-2 gap-3"><Result label="Gross pay" value={`${money(payrollResult.grossPayEtb)} ETB`} /><Result label="Employee pension" value={`${money(payrollResult.pensionEmployeeEtb)} ETB`} /><Result label="PAYE" value={`${money(payrollResult.incomeTaxEtb)} ETB`} /><Result label="Estimated net pay" value={`${money(payrollResult.netPayEtb)} ETB`} strong /></div></div>}
      {tool === 'efficiency' && <div className="grid gap-5 lg:grid-cols-2"><div className="grid gap-3 sm:grid-cols-2"><Field label="Accepted units" value={efficiency.accepted} onChange={value => patch(setEfficiency, 'accepted', value)} /><Field label="Rejected units" value={efficiency.rejected} onChange={value => patch(setEfficiency, 'rejected', value)} /><Field label="Target units" value={efficiency.target} onChange={value => patch(setEfficiency, 'target', value)} /><Field label="Labor hours" value={efficiency.hours} onChange={value => patch(setEfficiency, 'hours', value)} suffix="hours" /></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Result label="Target efficiency" value={`${money(efficiencyResult.efficiency)}%`} strong /><Result label="Quality yield" value={`${money(efficiencyResult.quality)}%`} /><Result label="Output / hour" value={money(efficiencyResult.output)} /></div></div>}
    </div>
  </section>
}
