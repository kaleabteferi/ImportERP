-- Payroll / HR schema. `employees` existed only as a bare lookup table
-- (id, full_name, department, title, warehouse_id) with no write path
-- anywhere in the app — extending it with real HR fields rather than
-- creating a parallel table, since hire date/employment type/salary are
-- core employee-record data, not a separate concern.

alter table employees add column if not exists employment_type text not null default 'permanent'
  check (employment_type in ('permanent', 'daily_wage', 'casual'));
alter table employees add column if not exists is_active boolean not null default true;
alter table employees add column if not exists hire_date date;
alter table employees add column if not exists phone text;
alter table employees add column if not exists tin_number text;
alter table employees add column if not exists bank_name text;
alter table employees add column if not exists bank_account_number text;
alter table employees add column if not exists emergency_contact text;
-- Monthly-salaried employees use base_salary_etb; daily_wage/casual workers
-- (typical for factory/production lines) use daily_rate_etb instead.
alter table employees add column if not exists base_salary_etb numeric;
alter table employees add column if not exists daily_rate_etb numeric;
-- Pension applies to permanent employees under the Private Organizations'
-- Employees Pension Proclamation — casual/daily-wage workers are typically
-- not enrolled, but this stays a per-employee override rather than being
-- inferred purely from employment_type, since real HR situations vary.
alter table employees add column if not exists pension_eligible boolean not null default true;
alter table employees add column if not exists notes text;

create table if not exists payroll_periods (
  id uuid primary key default gen_random_uuid(),
  period_month int not null check (period_month between 1 and 12),
  period_year int not null check (period_year between 2015 and 2100),
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  notes text,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (period_month, period_year)
);

create table if not exists payroll_entries (
  id uuid primary key default gen_random_uuid(),
  payroll_period_id uuid not null references payroll_periods(id) on delete cascade,
  employee_id uuid not null references employees(id),
  employment_type text not null,
  days_worked numeric,
  overtime_hours numeric not null default 0,
  base_pay_etb numeric not null default 0,
  overtime_pay_etb numeric not null default 0,
  allowances_etb numeric not null default 0,
  gross_pay_etb numeric not null default 0,
  taxable_income_etb numeric not null default 0,
  pension_employee_etb numeric not null default 0,
  pension_employer_etb numeric not null default 0,
  income_tax_etb numeric not null default 0,
  other_deductions_etb numeric not null default 0,
  net_pay_etb numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_period_id, employee_id)
);

-- Per-type overtime breakdown (weekday/night/rest-day/public-holiday all
-- carry different multipliers under the Labour Proclamation) kept as line
-- items rather than folded into a single hours number, so a payslip can
-- show exactly how the overtime figure was built.
create table if not exists payroll_overtime_lines (
  id uuid primary key default gen_random_uuid(),
  payroll_entry_id uuid not null references payroll_entries(id) on delete cascade,
  ot_type text not null check (ot_type in ('weekday', 'night', 'rest_day', 'public_holiday')),
  hours numeric not null default 0,
  rate_multiplier numeric not null,
  amount_etb numeric not null default 0
);

create table if not exists payroll_deductions (
  id uuid primary key default gen_random_uuid(),
  payroll_entry_id uuid not null references payroll_entries(id) on delete cascade,
  deduction_type text not null check (deduction_type in ('absence', 'loan_repayment', 'salary_reduction', 'advance', 'other')),
  description text,
  amount_etb numeric not null default 0
);

alter table payroll_periods enable row level security;
alter table payroll_entries enable row level security;
alter table payroll_overtime_lines enable row level security;
alter table payroll_deductions enable row level security;

-- Salary figures, not just "who wrote this" — hr_system only for read AND
-- write, unlike most other tables in this app which keep read broad.
create policy "hr_only" on payroll_periods for all using (has_role(ARRAY['hr_system'])) with check (has_role(ARRAY['hr_system']));
create policy "hr_only" on payroll_entries for all using (has_role(ARRAY['hr_system'])) with check (has_role(ARRAY['hr_system']));
create policy "hr_only" on payroll_overtime_lines for all using (has_role(ARRAY['hr_system'])) with check (has_role(ARRAY['hr_system']));
create policy "hr_only" on payroll_deductions for all using (has_role(ARRAY['hr_system'])) with check (has_role(ARRAY['hr_system']));

-- employees now holds real PII (salary, bank account, TIN) — lock it down
-- to hr_system entirely (read and write), not just write. But three
-- existing pages across other roles need a plain "who is this" name
-- lookup (who paid an expense, who's logging production, linking a login
-- to an employee) — give them a narrow view instead of broad table access.
drop policy if exists "Authenticated only" on employees;
create policy "select_hr_only" on employees for select using (has_role(ARRAY['hr_system']));
create policy "write_scoped" on employees for all using (has_role(ARRAY['hr_system'])) with check (has_role(ARRAY['hr_system']));

create or replace view employee_directory as
select id, full_name, department, title
from employees
where is_active = true and has_active_role();

grant select on employee_directory to authenticated;
