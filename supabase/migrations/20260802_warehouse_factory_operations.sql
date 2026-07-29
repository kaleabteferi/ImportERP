-- Warehouse / Factory Operations
-- --------------------------------
-- Extends the existing employee, warehouse, profile and payroll models.
-- It deliberately does not create a second employee master or expose HR PII
-- to warehouse managers. Operational access is scoped by unit assignment and
-- enforced with RLS. Payroll is detailed inside this module; accounting only
-- receives the approved summarized journal.

create extension if not exists pgcrypto;

-- Accounting allocation metadata. The repository has cash/bank `accounts`
-- but no version-controlled general-ledger chart, so account codes are stored
-- on payroll scopes and journal lines without misusing the cash account table.
create table if not exists cost_centers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists operational_units (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid references warehouses(id),
  company_id uuid references companies(id),
  cost_center_id uuid references cost_centers(id),
  name text not null,
  code text not null unique,
  unit_type text not null default 'warehouse'
    check (unit_type in ('warehouse','factory','distribution_center')),
  timezone text not null default 'Africa/Addis_Ababa',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_operational_units_warehouse on operational_units(warehouse_id);

-- Operational roles are separate from the five broad ERP department roles.
-- A nullable unit means a regional assignment across every operational unit.
create table if not exists warehouse_user_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  operational_unit_id uuid references operational_units(id) on delete cascade,
  access_role text not null
    check (access_role in ('regional_manager','warehouse_manager','payroll_officer','viewer')),
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  assigned_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create unique index if not exists uq_warehouse_user_assignment
  on warehouse_user_assignments(profile_id, coalesce(operational_unit_id, '00000000-0000-0000-0000-000000000000'::uuid), access_role)
  where is_active;

create or replace function has_warehouse_assignment(p_unit_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from warehouse_user_assignments a
    where a.profile_id = auth.uid()
      and a.is_active
      and a.effective_from <= current_date
      and (a.effective_to is null or a.effective_to >= current_date)
      and (a.operational_unit_id is null or a.operational_unit_id = p_unit_id)
      and a.access_role = any(p_roles)
  );
$$;

create or replace function user_can_view_operational_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    current_role_name() in ('full_access','hr_system','accounting_finance')
    or has_warehouse_assignment(
      p_unit_id,
      array['regional_manager','warehouse_manager','payroll_officer','viewer']
    );
$$;

create or replace function user_can_manage_operational_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select has_warehouse_assignment(p_unit_id, array['warehouse_manager']);
$$;

create or replace function user_can_approve_operational_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    current_role_name() = 'full_access'
    or has_warehouse_assignment(p_unit_id, array['regional_manager']);
$$;

create or replace function user_can_process_unit_payroll(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    current_role_name() in ('full_access','hr_system')
    or has_warehouse_assignment(p_unit_id, array['warehouse_manager','payroll_officer']);
$$;

-- Reusable employee groups. Employees remain individual master records.
create table if not exists workforce_groups (
  id uuid primary key default gen_random_uuid(),
  operational_unit_id uuid not null references operational_units(id) on delete cascade,
  name text not null,
  group_type text not null default 'task_team'
    check (group_type in ('permanent','temporary','shift','task_team')),
  supervisor_employee_id uuid references employees(id),
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique(operational_unit_id, name),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists workforce_group_members (
  id uuid primary key default gen_random_uuid(),
  workforce_group_id uuid not null references workforce_groups(id) on delete cascade,
  employee_id uuid not null references employees(id),
  role_in_group text,
  joined_at date not null default current_date,
  left_at date,
  allocation_pct numeric(5,2) not null default 100 check (allocation_pct > 0 and allocation_pct <= 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (left_at is null or left_at >= joined_at)
);
create unique index if not exists uq_active_workforce_group_member
  on workforce_group_members(workforce_group_id, employee_id) where is_active;
create index if not exists idx_workforce_members_employee on workforce_group_members(employee_id) where is_active;

create table if not exists operational_shifts (
  id uuid primary key default gen_random_uuid(),
  operational_unit_id uuid not null references operational_units(id) on delete cascade,
  name text not null,
  start_time time not null,
  end_time time not null,
  crosses_midnight boolean not null default false,
  standard_hours numeric(5,2) not null default 8 check (standard_hours > 0 and standard_hours <= 24),
  overtime_after_hours numeric(5,2) not null default 8 check (overtime_after_hours >= 0 and overtime_after_hours <= 24),
  is_active boolean not null default true,
  unique(operational_unit_id, name)
);

create table if not exists employee_shift_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  shift_id uuid not null references operational_shifts(id),
  operational_unit_id uuid not null references operational_units(id),
  effective_from date not null default current_date,
  effective_to date,
  assignment_type text not null default 'permanent'
    check (assignment_type in ('permanent','temporary')),
  assigned_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists operational_task_types (
  id uuid primary key default gen_random_uuid(),
  operational_unit_id uuid references operational_units(id) on delete cascade,
  name text not null,
  code text not null,
  standard_units_per_hour numeric(12,3),
  standard_minutes_per_unit numeric(12,3),
  default_target_units numeric(14,3),
  incentive_eligible boolean not null default false,
  is_active boolean not null default true,
  unique(operational_unit_id, code),
  check (standard_units_per_hour is null or standard_units_per_hour > 0),
  check (standard_minutes_per_unit is null or standard_minutes_per_unit > 0)
);

create table if not exists production_batches (
  id uuid primary key default gen_random_uuid(),
  batch_number text not null unique,
  operational_unit_id uuid not null references operational_units(id),
  warehouse_id uuid references warehouses(id),
  task_type_id uuid not null references operational_task_types(id),
  shift_id uuid references operational_shifts(id),
  production_date date not null default current_date,
  started_at timestamptz,
  completed_at timestamptz,
  target_units numeric(14,3),
  actual_units numeric(14,3) not null default 0 check (actual_units >= 0),
  rejected_units numeric(14,3) not null default 0 check (rejected_units >= 0),
  allocation_method text not null default 'hours_weighted'
    check (allocation_method in ('equal','hours_weighted','manual','role_weighted')),
  status text not null default 'draft'
    check (status in ('draft','active','completed','submitted','approved','cancelled')),
  supervisor_employee_id uuid references employees(id),
  entered_by uuid not null references profiles(id),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (rejected_units <= actual_units)
);
create index if not exists idx_production_batches_unit_date on production_batches(operational_unit_id, production_date desc);
create index if not exists idx_production_batches_status on production_batches(status, production_date desc);

create table if not exists production_batch_workers (
  id uuid primary key default gen_random_uuid(),
  production_batch_id uuid not null references production_batches(id) on delete cascade,
  employee_id uuid not null references employees(id),
  source_group_id uuid references workforce_groups(id),
  regular_hours numeric(6,2) not null default 0 check (regular_hours >= 0 and regular_hours <= 24),
  overtime_hours numeric(6,2) not null default 0 check (overtime_hours >= 0 and overtime_hours <= 16),
  units_attributed numeric(14,3),
  allocation_weight numeric(8,3) not null default 1 check (allocation_weight > 0),
  attendance_status text not null default 'present'
    check (attendance_status in ('present','absent','partial','leave')),
  employee_efficiency_pct numeric(8,2),
  incentive_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(production_batch_id, employee_id)
);

create table if not exists employee_attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  operational_unit_id uuid not null references operational_units(id),
  shift_id uuid references operational_shifts(id),
  attendance_date date not null,
  clock_in timestamptz,
  clock_out timestamptz,
  regular_hours numeric(6,2) not null default 0 check (regular_hours >= 0 and regular_hours <= 24),
  raw_overtime_hours numeric(6,2) not null default 0 check (raw_overtime_hours >= 0 and raw_overtime_hours <= 16),
  approved_overtime_hours numeric(6,2) not null default 0 check (approved_overtime_hours >= 0 and approved_overtime_hours <= 16),
  attendance_status text not null
    check (attendance_status in ('present','absent','partial','leave','sick')),
  source text not null default 'manual'
    check (source in ('manual','biometric','import','production_batch')),
  approved_by uuid references profiles(id),
  notes text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, operational_unit_id, attendance_date)
);
create index if not exists idx_attendance_unit_date on employee_attendance(operational_unit_id, attendance_date desc);

create table if not exists overtime_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique,
  multiplier numeric(5,2) not null check (multiplier > 0),
  calculation_basis text not null default 'hourly_salary'
    check (calculation_basis in ('hourly_salary','fixed_rate')),
  fixed_hourly_rate numeric(14,2),
  active boolean not null default true
);

create table if not exists overtime_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  operational_unit_id uuid not null references operational_units(id),
  production_batch_id uuid references production_batches(id),
  overtime_date date not null,
  requested_hours numeric(6,2) not null check (requested_hours > 0 and requested_hours <= 16),
  approved_hours numeric(6,2),
  overtime_type_id uuid not null references overtime_types(id),
  reason text not null,
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','rejected','posted')),
  requested_by uuid not null references profiles(id),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  check (approved_hours is null or (approved_hours >= 0 and approved_hours <= requested_hours))
);
create index if not exists idx_overtime_unit_date on overtime_requests(operational_unit_id, overtime_date desc);
create index if not exists idx_overtime_pending on overtime_requests(operational_unit_id, status) where status in ('draft','submitted');

create table if not exists employee_daily_efficiency (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  operational_unit_id uuid not null references operational_units(id),
  log_date date not null,
  regular_hours numeric(8,2) not null default 0,
  overtime_hours numeric(8,2) not null default 0,
  earned_hours numeric(10,3) not null default 0,
  attributed_units numeric(14,3) not null default 0,
  efficiency_pct numeric(8,2) not null default 0,
  rolling_avg_7d numeric(8,2) not null default 0,
  trend_flag text not null default 'stable'
    check (trend_flag in ('improving','stable','declining')),
  needs_attention boolean not null default false,
  calculated_at timestamptz not null default now(),
  unique(employee_id, operational_unit_id, log_date)
);
create index if not exists idx_employee_efficiency_unit_date on employee_daily_efficiency(operational_unit_id, log_date desc);

create table if not exists operational_unit_daily_rollups (
  id uuid primary key default gen_random_uuid(),
  operational_unit_id uuid not null references operational_units(id),
  log_date date not null,
  employee_count integer not null default 0,
  total_units numeric(16,3) not null default 0,
  accepted_units numeric(16,3) not null default 0,
  rejected_units numeric(16,3) not null default 0,
  regular_hours numeric(14,2) not null default 0,
  overtime_hours numeric(14,2) not null default 0,
  avg_efficiency_pct numeric(8,2) not null default 0,
  output_per_labor_hour numeric(12,3) not null default 0,
  target_achievement_pct numeric(8,2) not null default 0,
  rank_position integer,
  calculated_at timestamptz not null default now(),
  unique(operational_unit_id, log_date)
);
create index if not exists idx_unit_rollups_date on operational_unit_daily_rollups(log_date desc, avg_efficiency_pct desc);

create table if not exists operational_alerts (
  id uuid primary key default gen_random_uuid(),
  operational_unit_id uuid not null references operational_units(id),
  alert_date date not null default current_date,
  alert_type text not null
    check (alert_type in ('efficiency_decline','missing_attendance','pending_overtime','unapproved_batch','payroll_blocker','high_rejection')),
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  title text not null,
  message text not null,
  related_employee_id uuid references employees(id),
  related_batch_id uuid references production_batches(id),
  is_resolved boolean not null default false,
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_operational_alerts_open on operational_alerts(operational_unit_id, alert_date desc) where not is_resolved;

-- Warehouse payroll extends the existing payroll periods and employee master.
create table if not exists payroll_scopes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scope_type text not null check (scope_type in ('corporate','warehouse','factory')),
  operational_unit_id uuid references operational_units(id),
  company_id uuid references companies(id),
  cost_center_id uuid references cost_centers(id),
  payroll_payable_account_code text not null default 'PAYROLL-PAYABLE',
  salary_expense_account_code text not null default 'SALARY-EXPENSE',
  overtime_expense_account_code text not null default 'OVERTIME-EXPENSE',
  incentive_expense_account_code text not null default 'INCENTIVE-EXPENSE',
  tax_payable_account_code text not null default 'TAX-PAYABLE',
  pension_payable_account_code text not null default 'PENSION-PAYABLE',
  active boolean not null default true,
  unique(operational_unit_id)
);

create table if not exists employee_payroll_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  payroll_scope_id uuid not null references payroll_scopes(id),
  effective_from date not null default current_date,
  effective_to date,
  salary_structure_ref text,
  payment_method_ref text,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create unique index if not exists uq_primary_employee_payroll_assignment
  on employee_payroll_assignments(employee_id) where is_primary and effective_to is null;

create table if not exists warehouse_payroll_runs (
  id uuid primary key default gen_random_uuid(),
  payroll_scope_id uuid not null references payroll_scopes(id),
  operational_unit_id uuid not null references operational_units(id),
  payroll_period_id uuid references payroll_periods(id),
  run_number text not null unique,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft'
    check (status in ('draft','calculated','submitted','hr_approved','finance_approved','posted','paid','rejected')),
  employee_count integer not null default 0,
  gross_amount numeric(16,2) not null default 0,
  overtime_amount numeric(16,2) not null default 0,
  incentive_amount numeric(16,2) not null default 0,
  deduction_amount numeric(16,2) not null default 0,
  tax_amount numeric(16,2) not null default 0,
  pension_amount numeric(16,2) not null default 0,
  employer_pension_amount numeric(16,2) not null default 0,
  net_amount numeric(16,2) not null default 0,
  calculated_by uuid references profiles(id),
  submitted_by uuid references profiles(id),
  hr_approved_by uuid references profiles(id),
  finance_approved_by uuid references profiles(id),
  posted_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index if not exists idx_warehouse_payroll_unit_period on warehouse_payroll_runs(operational_unit_id, period_end desc);

create table if not exists warehouse_payroll_run_employees (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references warehouse_payroll_runs(id) on delete cascade,
  employee_id uuid not null references employees(id),
  days_worked numeric(7,2) not null default 0,
  basic_salary numeric(16,2) not null default 0,
  regular_pay numeric(16,2) not null default 0,
  overtime_hours numeric(8,2) not null default 0,
  overtime_pay numeric(16,2) not null default 0,
  production_incentive numeric(16,2) not null default 0,
  gross_pay numeric(16,2) not null default 0,
  taxable_income numeric(16,2) not null default 0,
  tax numeric(16,2) not null default 0,
  pension_employee numeric(16,2) not null default 0,
  pension_employer numeric(16,2) not null default 0,
  other_deductions numeric(16,2) not null default 0,
  net_pay numeric(16,2) not null default 0,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  unique(payroll_run_id, employee_id)
);

create table if not exists payroll_accounting_batches (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null unique references warehouse_payroll_runs(id),
  cost_center_id uuid references cost_centers(id),
  journal_batch_number text not null unique,
  total_debit numeric(16,2) not null default 0,
  total_credit numeric(16,2) not null default 0,
  posting_status text not null default 'pending'
    check (posting_status in ('pending','posted','failed','reversed')),
  posted_by uuid references profiles(id),
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists payroll_accounting_lines (
  id uuid primary key default gen_random_uuid(),
  accounting_batch_id uuid not null references payroll_accounting_batches(id) on delete cascade,
  account_code text not null,
  account_name text not null,
  debit numeric(16,2) not null default 0,
  credit numeric(16,2) not null default 0,
  description text,
  check (debit >= 0 and credit >= 0),
  check (not (debit > 0 and credit > 0))
);

-- Non-sensitive operational employee directory. Salary/bank/TIN remain
-- protected on the employees table by its existing HR-only RLS.
create or replace view operational_employee_directory
with (security_barrier = true)
as
select
  e.id,
  e.full_name,
  e.department,
  e.title,
  e.warehouse_id,
  e.employment_type,
  ou.id as operational_unit_id
from employees e
join operational_units ou on ou.warehouse_id = e.warehouse_id
where e.is_active and user_can_view_operational_unit(ou.id);
grant select on operational_employee_directory to authenticated;

-- Seed one cost center, operational unit, payroll scope and morning shift per
-- existing warehouse. Existing rows are never overwritten.
insert into cost_centers(code, name)
select 'WH-' || coalesce(nullif(w.code,''), upper(left(replace(w.name,' ',''),8))), w.name || ' Operations'
from warehouses w
where w.is_active
on conflict(code) do nothing;

insert into operational_units(warehouse_id, cost_center_id, name, code, unit_type)
select
  w.id,
  c.id,
  w.name || ' Operations',
  coalesce(nullif(w.code,''), upper(left(replace(w.name,' ',''),8))) || '-OPS',
  case when coalesce(w.has_production,false) then 'factory' else 'warehouse' end
from warehouses w
left join cost_centers c on c.code = 'WH-' || coalesce(nullif(w.code,''), upper(left(replace(w.name,' ',''),8)))
where w.is_active
on conflict(code) do nothing;

insert into payroll_scopes(name, scope_type, operational_unit_id, company_id, cost_center_id)
select
  ou.name || ' Payroll',
  case when ou.unit_type = 'factory' then 'factory' else 'warehouse' end,
  ou.id,
  ou.company_id,
  ou.cost_center_id
from operational_units ou
where not exists (select 1 from payroll_scopes ps where ps.operational_unit_id = ou.id);

insert into operational_shifts(operational_unit_id, name, start_time, end_time, standard_hours, overtime_after_hours)
select ou.id, 'Morning Shift', '07:00'::time, '15:00'::time, 8, 8
from operational_units ou
where not exists (
  select 1 from operational_shifts s where s.operational_unit_id = ou.id and s.name = 'Morning Shift'
);

insert into operational_task_types(operational_unit_id, name, code, standard_units_per_hour, incentive_eligible)
values
  (null, 'Picking', 'PICKING', 100, true),
  (null, 'Packing', 'PACKING', 100, true),
  (null, 'Loading', 'LOADING', 75, false),
  (null, 'Sorting', 'SORTING', 90, true),
  (null, 'Assembly', 'ASSEMBLY', 50, true)
on conflict(operational_unit_id, code) do nothing;

insert into overtime_types(name, code, multiplier, calculation_basis)
values
  ('Weekday overtime', 'WEEKDAY', 1.50, 'hourly_salary'),
  ('Night overtime', 'NIGHT', 1.75, 'hourly_salary'),
  ('Rest day overtime', 'REST_DAY', 2.00, 'hourly_salary'),
  ('Public holiday overtime', 'PUBLIC_HOLIDAY', 2.50, 'hourly_salary')
on conflict(code) do nothing;

-- Automatically scope login profiles linked to a warehouse employee.
insert into warehouse_user_assignments(profile_id, operational_unit_id, access_role, assigned_by)
select p.id, ou.id, 'warehouse_manager', p.id
from profiles p
join employees e on e.id = p.employee_id
join operational_units ou on ou.warehouse_id = e.warehouse_id
where current_role_name() is not null
  and not exists (
    select 1 from warehouse_user_assignments a
    where a.profile_id = p.id and a.operational_unit_id = ou.id and a.access_role = 'warehouse_manager' and a.is_active
  );

-- Payroll math mirrors the existing client payroll engine.
create or replace function warehouse_calculate_paye(p_taxable numeric)
returns numeric
language plpgsql
immutable
as $$
declare
  v_tax numeric := 0;
begin
  if p_taxable <= 2000 then return 0; end if;
  v_tax := v_tax + least(p_taxable - 2000, 2000) * .15;
  if p_taxable <= 4000 then return round(v_tax,2); end if;
  v_tax := v_tax + least(p_taxable - 4000, 3000) * .20;
  if p_taxable <= 7000 then return round(v_tax,2); end if;
  v_tax := v_tax + least(p_taxable - 7000, 3000) * .25;
  if p_taxable <= 10000 then return round(v_tax,2); end if;
  v_tax := v_tax + least(p_taxable - 10000, 4000) * .30;
  if p_taxable <= 14000 then return round(v_tax,2); end if;
  v_tax := v_tax + (p_taxable - 14000) * .35;
  return round(v_tax,2);
end;
$$;

create or replace function warehouse_net_from_gross(p_gross numeric, p_pension boolean)
returns numeric
language sql
immutable
as $$
  select round(
    p_gross
    - case when p_pension then p_gross * .07 else 0 end
    - warehouse_calculate_paye(greatest(0, p_gross - case when p_pension then p_gross * .07 else 0 end)),
    2
  );
$$;

create or replace function warehouse_gross_from_net(p_net numeric, p_pension boolean)
returns numeric
language plpgsql
immutable
as $$
declare
  v_low numeric := greatest(0,p_net);
  v_high numeric := greatest(0,p_net) * 2.5;
  v_mid numeric;
  i integer;
begin
  if p_net <= 0 then return 0; end if;
  for i in 1..60 loop
    v_mid := (v_low + v_high) / 2;
    if warehouse_net_from_gross(v_mid,p_pension) < p_net then v_low := v_mid; else v_high := v_mid; end if;
  end loop;
  return round(v_high,2);
end;
$$;

-- Rebuild employee/day efficiency and the warehouse/day rollup whenever a
-- batch is approved. Hours-weighted allocation is the default.
create or replace function approve_production_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch production_batches%rowtype;
  v_total_hours numeric;
  v_present_count integer;
  v_total_weight numeric;
begin
  select * into v_batch from production_batches where id = p_batch_id for update;
  if not found then raise exception 'Production batch not found'; end if;
  if not user_can_approve_operational_unit(v_batch.operational_unit_id) then
    raise exception 'You are not allowed to approve this operational unit';
  end if;
  if v_batch.status not in ('completed','submitted') then
    raise exception 'Only completed or submitted batches can be approved';
  end if;

  select
    coalesce(sum(regular_hours + overtime_hours) filter (where attendance_status in ('present','partial')),0),
    count(*) filter (where attendance_status in ('present','partial')),
    coalesce(sum(allocation_weight) filter (where attendance_status in ('present','partial')),0)
  into v_total_hours, v_present_count, v_total_weight
  from production_batch_workers where production_batch_id = p_batch_id;

  if v_present_count = 0 then raise exception 'Add at least one present worker before approval'; end if;

  update production_batch_workers w
  set units_attributed = case v_batch.allocation_method
    when 'equal' then (v_batch.actual_units - v_batch.rejected_units) / v_present_count
    when 'hours_weighted' then
      case when v_total_hours > 0 then (v_batch.actual_units - v_batch.rejected_units) * (w.regular_hours + w.overtime_hours) / v_total_hours else 0 end
    when 'role_weighted' then
      case when v_total_weight > 0 then (v_batch.actual_units - v_batch.rejected_units) * w.allocation_weight / v_total_weight else 0 end
    else coalesce(w.units_attributed,0)
  end
  where w.production_batch_id = p_batch_id and w.attendance_status in ('present','partial');

  update production_batch_workers w
  set employee_efficiency_pct = round(
    case
      when (w.regular_hours + w.overtime_hours) <= 0 then 0
      when t.standard_units_per_hour is not null and t.standard_units_per_hour > 0
        then coalesce(w.units_attributed,0) / (t.standard_units_per_hour * (w.regular_hours + w.overtime_hours)) * 100
      when v_batch.target_units is not null and v_batch.target_units > 0
        then coalesce(w.units_attributed,0) / (v_batch.target_units / v_present_count) * 100
      else 0
    end, 2
  )
  from operational_task_types t
  where w.production_batch_id = p_batch_id and t.id = v_batch.task_type_id;

  update production_batches
  set status='approved', approved_by=auth.uid(), approved_at=now(), completed_at=coalesce(completed_at,now()), updated_at=now()
  where id=p_batch_id;

  insert into employee_daily_efficiency(
    employee_id, operational_unit_id, log_date, regular_hours, overtime_hours,
    earned_hours, attributed_units, efficiency_pct, rolling_avg_7d, trend_flag,
    needs_attention, calculated_at
  )
  select
    w.employee_id,
    b.operational_unit_id,
    b.production_date,
    sum(w.regular_hours),
    sum(w.overtime_hours),
    sum((w.regular_hours+w.overtime_hours) * coalesce(w.employee_efficiency_pct,0) / 100),
    sum(coalesce(w.units_attributed,0)),
    case when sum(w.regular_hours+w.overtime_hours)>0
      then round(sum(coalesce(w.employee_efficiency_pct,0)*(w.regular_hours+w.overtime_hours))/sum(w.regular_hours+w.overtime_hours),2)
      else 0 end,
    0,
    'stable',
    false,
    now()
  from production_batch_workers w
  join production_batches b on b.id=w.production_batch_id
  where b.operational_unit_id=v_batch.operational_unit_id
    and b.production_date=v_batch.production_date
    and b.status='approved'
    and w.attendance_status in ('present','partial')
  group by w.employee_id,b.operational_unit_id,b.production_date
  on conflict(employee_id,operational_unit_id,log_date) do update set
    regular_hours=excluded.regular_hours,
    overtime_hours=excluded.overtime_hours,
    earned_hours=excluded.earned_hours,
    attributed_units=excluded.attributed_units,
    efficiency_pct=excluded.efficiency_pct,
    calculated_at=now();

  update employee_daily_efficiency e
  set
    rolling_avg_7d = r.avg_eff,
    trend_flag = case when r.avg_eff > e.efficiency_pct + 2 then 'declining' when r.avg_eff + 2 < e.efficiency_pct then 'improving' else 'stable' end,
    needs_attention = e.efficiency_pct < 80 or (r.avg_eff > e.efficiency_pct + 5)
  from (
    select employee_id, operational_unit_id, round(avg(efficiency_pct),2) avg_eff
    from employee_daily_efficiency
    where operational_unit_id=v_batch.operational_unit_id
      and log_date between v_batch.production_date-6 and v_batch.production_date
    group by employee_id,operational_unit_id
  ) r
  where e.employee_id=r.employee_id and e.operational_unit_id=r.operational_unit_id and e.log_date=v_batch.production_date;

  insert into operational_unit_daily_rollups(
    operational_unit_id,log_date,employee_count,total_units,accepted_units,rejected_units,
    regular_hours,overtime_hours,avg_efficiency_pct,output_per_labor_hour,target_achievement_pct,calculated_at
  )
  select
    v_batch.operational_unit_id,
    v_batch.production_date,
    coalesce((select count(distinct w.employee_id) from production_batch_workers w join production_batches b on b.id=w.production_batch_id where b.operational_unit_id=v_batch.operational_unit_id and b.production_date=v_batch.production_date and b.status='approved' and w.attendance_status in ('present','partial')),0),
    coalesce((select sum(actual_units) from production_batches where operational_unit_id=v_batch.operational_unit_id and production_date=v_batch.production_date and status='approved'),0),
    coalesce((select sum(actual_units-rejected_units) from production_batches where operational_unit_id=v_batch.operational_unit_id and production_date=v_batch.production_date and status='approved'),0),
    coalesce((select sum(rejected_units) from production_batches where operational_unit_id=v_batch.operational_unit_id and production_date=v_batch.production_date and status='approved'),0),
    coalesce((select sum(w.regular_hours) from production_batch_workers w join production_batches b on b.id=w.production_batch_id where b.operational_unit_id=v_batch.operational_unit_id and b.production_date=v_batch.production_date and b.status='approved'),0),
    coalesce((select sum(w.overtime_hours) from production_batch_workers w join production_batches b on b.id=w.production_batch_id where b.operational_unit_id=v_batch.operational_unit_id and b.production_date=v_batch.production_date and b.status='approved'),0),
    coalesce((select sum(e.efficiency_pct*(e.regular_hours+e.overtime_hours))/nullif(sum(e.regular_hours+e.overtime_hours),0) from employee_daily_efficiency e where e.operational_unit_id=v_batch.operational_unit_id and e.log_date=v_batch.production_date),0),
    coalesce((select sum(actual_units-rejected_units) from production_batches where operational_unit_id=v_batch.operational_unit_id and production_date=v_batch.production_date and status='approved'),0)
      / nullif(coalesce((select sum(w.regular_hours+w.overtime_hours) from production_batch_workers w join production_batches b on b.id=w.production_batch_id where b.operational_unit_id=v_batch.operational_unit_id and b.production_date=v_batch.production_date and b.status='approved'),0),0),
    coalesce((select sum(actual_units-rejected_units)/nullif(sum(target_units),0)*100 from production_batches where operational_unit_id=v_batch.operational_unit_id and production_date=v_batch.production_date and status='approved'),0),
    now()
  on conflict(operational_unit_id,log_date) do update set
    employee_count=excluded.employee_count,total_units=excluded.total_units,accepted_units=excluded.accepted_units,
    rejected_units=excluded.rejected_units,regular_hours=excluded.regular_hours,overtime_hours=excluded.overtime_hours,
    avg_efficiency_pct=excluded.avg_efficiency_pct,output_per_labor_hour=excluded.output_per_labor_hour,
    target_achievement_pct=excluded.target_achievement_pct,calculated_at=now();

  with ranked as (
    select id,row_number() over(order by avg_efficiency_pct desc) r
    from operational_unit_daily_rollups where log_date=v_batch.production_date
  )
  update operational_unit_daily_rollups u set rank_position=ranked.r from ranked where u.id=ranked.id;
end;
$$;

create or replace function decide_overtime_request(p_request_id uuid, p_approve boolean, p_hours numeric default null, p_reason text default null)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare v overtime_requests%rowtype;
begin
  select * into v from overtime_requests where id=p_request_id for update;
  if not found then raise exception 'Overtime request not found'; end if;
  if not (user_can_approve_operational_unit(v.operational_unit_id) or current_role_name()='hr_system') then raise exception 'Not allowed to approve overtime'; end if;
  if v.status <> 'submitted' then raise exception 'Only submitted overtime can be decided'; end if;
  update overtime_requests set
    status=case when p_approve then 'approved' else 'rejected' end,
    approved_hours=case when p_approve then least(coalesce(p_hours,v.requested_hours),v.requested_hours) else 0 end,
    approved_by=auth.uid(),approved_at=now(),rejection_reason=case when p_approve then null else p_reason end
  where id=p_request_id;
end;
$$;

-- Payroll preparation enforces all blocking validations and stores a full
-- calculation snapshot so future rule changes cannot rewrite history.
create or replace function prepare_warehouse_payroll(p_unit_id uuid, p_start date, p_end date, p_payroll_period_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_scope payroll_scopes%rowtype;
  v_run_id uuid;
  v_missing_attendance integer;
  v_pending_ot integer;
  v_pending_batches integer;
  v_missing_salary integer;
begin
  if not user_can_process_unit_payroll(p_unit_id) then raise exception 'Not allowed to prepare this payroll'; end if;
  if p_end < p_start then raise exception 'Payroll end date must be after start date'; end if;
  select * into v_scope from payroll_scopes where operational_unit_id=p_unit_id and active;
  if not found then raise exception 'No active payroll scope is configured for this unit'; end if;

  with staff as (
    select distinct e.id
    from employees e
    join operational_units ou on ou.id=p_unit_id
    where e.is_active and (
      e.warehouse_id=ou.warehouse_id or exists (
        select 1 from workforce_group_members gm join workforce_groups g on g.id=gm.workforce_group_id
        where gm.employee_id=e.id and gm.is_active and g.is_active and g.operational_unit_id=p_unit_id
      )
    )
  )
  select count(*) into v_missing_attendance
  from staff s where not exists (
    select 1 from employee_attendance a where a.employee_id=s.id and a.operational_unit_id=p_unit_id and a.attendance_date between p_start and p_end
  );
  select count(*) into v_pending_ot from overtime_requests where operational_unit_id=p_unit_id and overtime_date between p_start and p_end and status in ('draft','submitted');
  select count(*) into v_pending_batches from production_batches where operational_unit_id=p_unit_id and production_date between p_start and p_end and status not in ('approved','cancelled');
  with staff as (
    select distinct e.*
    from employees e join operational_units ou on ou.id=p_unit_id
    where e.is_active and (e.warehouse_id=ou.warehouse_id or exists (
      select 1 from workforce_group_members gm join workforce_groups g on g.id=gm.workforce_group_id
      where gm.employee_id=e.id and gm.is_active and g.is_active and g.operational_unit_id=p_unit_id
    ))
  )
  select count(*) into v_missing_salary from staff
  where (employment_type='permanent' and coalesce(base_salary_etb,0)<=0)
     or (employment_type<>'permanent' and coalesce(daily_rate_etb,0)<=0);

  if v_missing_attendance+v_pending_ot+v_pending_batches+v_missing_salary > 0 then
    raise exception 'Payroll blocked: % missing attendance, % pending overtime, % unapproved batches, % missing salary structures',
      v_missing_attendance,v_pending_ot,v_pending_batches,v_missing_salary;
  end if;

  insert into warehouse_payroll_runs(
    payroll_scope_id,operational_unit_id,payroll_period_id,run_number,period_start,period_end,status,calculated_by
  ) values (
    v_scope.id,p_unit_id,p_payroll_period_id,
    'WPR-'||to_char(now(),'YYYYMMDDHH24MISSMS'),p_start,p_end,'calculated',auth.uid()
  ) returning id into v_run_id;

  insert into warehouse_payroll_run_employees(
    payroll_run_id,employee_id,days_worked,basic_salary,regular_pay,overtime_hours,overtime_pay,
    production_incentive,gross_pay,taxable_income,tax,pension_employee,pension_employer,
    other_deductions,net_pay,calculation_snapshot
  )
  with staff as (
    select distinct e.*
    from employees e join operational_units ou on ou.id=p_unit_id
    where e.is_active and (e.warehouse_id=ou.warehouse_id or exists (
      select 1 from workforce_group_members gm join workforce_groups g on g.id=gm.workforce_group_id
      where gm.employee_id=e.id and gm.is_active and g.is_active and g.operational_unit_id=p_unit_id
    ))
  ), att as (
    select employee_id,count(*) filter(where attendance_status in ('present','partial')) days_worked
    from employee_attendance where operational_unit_id=p_unit_id and attendance_date between p_start and p_end group by employee_id
  ), ot as (
    select o.employee_id,sum(o.approved_hours) hours,
      sum(o.approved_hours * t.multiplier * case when e.employment_type='permanent'
        then warehouse_gross_from_net(coalesce(e.base_salary_etb,0),e.pension_eligible)/240
        else coalesce(e.daily_rate_etb,0)/8 end) pay
    from overtime_requests o join overtime_types t on t.id=o.overtime_type_id join employees e on e.id=o.employee_id
    where o.operational_unit_id=p_unit_id and o.overtime_date between p_start and p_end and o.status='approved'
    group by o.employee_id
  ), inc as (
    select w.employee_id,sum(w.incentive_amount) amount
    from production_batch_workers w join production_batches b on b.id=w.production_batch_id
    where b.operational_unit_id=p_unit_id and b.production_date between p_start and p_end and b.status='approved'
    group by w.employee_id
  ), base as (
    select s.*,coalesce(att.days_worked,0) days,
      case when s.employment_type='permanent' then warehouse_gross_from_net(coalesce(s.base_salary_etb,0),s.pension_eligible)
        else coalesce(s.daily_rate_etb,0)*coalesce(att.days_worked,0) end regular,
      coalesce(ot.hours,0) ot_hours,round(coalesce(ot.pay,0),2) ot_pay,round(coalesce(inc.amount,0),2) incentive
    from staff s left join att on att.employee_id=s.id left join ot on ot.employee_id=s.id left join inc on inc.employee_id=s.id
  ), calc as (
    select base.*,
      round(regular+ot_pay+incentive,2) gross,
      round(case when pension_eligible then regular*.07 else 0 end,2) emp_pension,
      round(case when pension_eligible then regular*.11 else 0 end,2) employer_pension
    from base
  )
  select
    v_run_id,id,days,coalesce(base_salary_etb,daily_rate_etb,0),regular,ot_hours,ot_pay,incentive,gross,
    greatest(0,gross-emp_pension),warehouse_calculate_paye(greatest(0,gross-emp_pension)),
    emp_pension,employer_pension,0,
    round(gross-emp_pension-warehouse_calculate_paye(greatest(0,gross-emp_pension)),2),
    jsonb_build_object(
      'employment_type',employment_type,'base_salary_etb',base_salary_etb,'daily_rate_etb',daily_rate_etb,
      'days_worked',days,'overtime_hours',ot_hours,'overtime_pay',ot_pay,'incentive',incentive,
      'pension_employee_rate',case when pension_eligible then .07 else 0 end,
      'pension_employer_rate',case when pension_eligible then .11 else 0 end,
      'monthly_hours_divisor',240,'prepared_at',now()
    )
  from calc;

  update warehouse_payroll_runs r set
    employee_count=x.employee_count,gross_amount=x.gross,overtime_amount=x.overtime,
    incentive_amount=x.incentive,deduction_amount=x.deductions,tax_amount=x.tax,
    pension_amount=x.pension,employer_pension_amount=x.employer_pension,net_amount=x.net,updated_at=now()
  from (
    select count(*) employee_count,coalesce(sum(gross_pay),0) gross,coalesce(sum(overtime_pay),0) overtime,
      coalesce(sum(production_incentive),0) incentive,coalesce(sum(other_deductions),0) deductions,
      coalesce(sum(tax),0) tax,coalesce(sum(pension_employee),0) pension,
      coalesce(sum(pension_employer),0) employer_pension,coalesce(sum(net_pay),0) net
    from warehouse_payroll_run_employees where payroll_run_id=v_run_id
  ) x where r.id=v_run_id;
  return v_run_id;
end;
$$;

create or replace function transition_warehouse_payroll(p_run_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_run warehouse_payroll_runs%rowtype;
  v_scope payroll_scopes%rowtype;
  v_batch_id uuid;
begin
  select * into v_run from warehouse_payroll_runs where id=p_run_id for update;
  if not found then raise exception 'Payroll run not found'; end if;
  select * into v_scope from payroll_scopes where id=v_run.payroll_scope_id;

  if p_action='submit' then
    if not user_can_process_unit_payroll(v_run.operational_unit_id) or v_run.status<>'calculated' then raise exception 'Payroll is not ready for submission'; end if;
    update warehouse_payroll_runs set status='submitted',submitted_by=auth.uid(),updated_at=now() where id=p_run_id;
  elsif p_action='hr_approve' then
    if current_role_name()<>'hr_system' or v_run.status<>'submitted' then raise exception 'HR approval is not allowed at this stage'; end if;
    update warehouse_payroll_runs set status='hr_approved',hr_approved_by=auth.uid(),updated_at=now() where id=p_run_id;
  elsif p_action='finance_approve' then
    if current_role_name()<>'accounting_finance' or v_run.status<>'hr_approved' then raise exception 'Finance approval is not allowed at this stage'; end if;
    update warehouse_payroll_runs set status='finance_approved',finance_approved_by=auth.uid(),updated_at=now() where id=p_run_id;
  elsif p_action='post' then
    if current_role_name()<>'accounting_finance' or v_run.status<>'finance_approved' then raise exception 'Only Finance can post an approved payroll'; end if;
    insert into payroll_accounting_batches(payroll_run_id,cost_center_id,journal_batch_number,total_debit,total_credit,posting_status,posted_by,posted_at)
    values (
      p_run_id,v_scope.cost_center_id,'PAY-'||v_run.run_number,
      v_run.gross_amount+v_run.employer_pension_amount,
      v_run.net_amount+v_run.tax_amount+v_run.pension_amount+v_run.employer_pension_amount+v_run.deduction_amount,
      'posted',auth.uid(),now()
    ) returning id into v_batch_id;
    insert into payroll_accounting_lines(accounting_batch_id,account_code,account_name,debit,credit,description) values
      (v_batch_id,v_scope.salary_expense_account_code,'Warehouse salary expense',v_run.gross_amount-v_run.overtime_amount-v_run.incentive_amount,0,v_run.run_number),
      (v_batch_id,v_scope.overtime_expense_account_code,'Warehouse overtime expense',v_run.overtime_amount,0,v_run.run_number),
      (v_batch_id,v_scope.incentive_expense_account_code,'Production incentive expense',v_run.incentive_amount,0,v_run.run_number),
      (v_batch_id,v_scope.pension_payable_account_code,'Employer pension expense',v_run.employer_pension_amount,0,v_run.run_number),
      (v_batch_id,v_scope.payroll_payable_account_code,'Employee payroll payable',0,v_run.net_amount,v_run.run_number),
      (v_batch_id,v_scope.tax_payable_account_code,'Tax payable',0,v_run.tax_amount,v_run.run_number),
      (v_batch_id,v_scope.pension_payable_account_code,'Pension payable',0,v_run.pension_amount+v_run.employer_pension_amount,v_run.run_number),
      (v_batch_id,'OTHER-DEDUCTIONS-PAYABLE','Other deductions payable',0,v_run.deduction_amount,v_run.run_number);
    update warehouse_payroll_runs set status='posted',posted_at=now(),updated_at=now() where id=p_run_id;
  else raise exception 'Unknown payroll action';
  end if;
end;
$$;

create or replace function refresh_operational_alerts(p_unit_id uuid, p_date date default current_date)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not user_can_view_operational_unit(p_unit_id) then raise exception 'Not allowed'; end if;
  delete from operational_alerts where operational_unit_id=p_unit_id and alert_date=p_date and not is_resolved;
  insert into operational_alerts(operational_unit_id,alert_date,alert_type,severity,title,message)
  select p_unit_id,p_date,'pending_overtime','medium','Overtime awaiting approval',count(*)||' overtime request(s) await approval'
  from overtime_requests where operational_unit_id=p_unit_id and overtime_date<=p_date and status='submitted' having count(*)>0;
  insert into operational_alerts(operational_unit_id,alert_date,alert_type,severity,title,message)
  select p_unit_id,p_date,'unapproved_batch','high','Production batches unapproved',count(*)||' production batch(es) block payroll'
  from production_batches where operational_unit_id=p_unit_id and production_date<=p_date and status in ('draft','active','completed','submitted') having count(*)>0;
  insert into operational_alerts(operational_unit_id,alert_date,alert_type,severity,title,message)
  select p_unit_id,p_date,'efficiency_decline','high','Employee efficiency declined',count(*)||' employee(s) need efficiency review'
  from employee_daily_efficiency where operational_unit_id=p_unit_id and log_date=p_date and needs_attention having count(*)>0;
  insert into operational_alerts(operational_unit_id,alert_date,alert_type,severity,title,message)
  select p_unit_id,p_date,'missing_attendance','medium','Attendance missing',count(*)||' assigned employee(s) have no attendance record'
  from operational_employee_directory d
  where d.operational_unit_id=p_unit_id and not exists (
    select 1 from employee_attendance a where a.employee_id=d.id and a.operational_unit_id=p_unit_id and a.attendance_date=p_date
  ) having count(*)>0;
end;
$$;

-- Approved operational records are immutable to warehouse managers.
create or replace function protect_approved_production_batch()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status='approved' and not user_can_approve_operational_unit(old.operational_unit_id) then
    raise exception 'Approved production batches are immutable';
  end if;
  return new;
end; $$;
drop trigger if exists trg_protect_approved_production_batch on production_batches;
create trigger trg_protect_approved_production_batch before update or delete on production_batches
for each row execute function protect_approved_production_batch();

-- RLS
alter table cost_centers enable row level security;
alter table operational_units enable row level security;
alter table warehouse_user_assignments enable row level security;
alter table workforce_groups enable row level security;
alter table workforce_group_members enable row level security;
alter table operational_shifts enable row level security;
alter table employee_shift_assignments enable row level security;
alter table operational_task_types enable row level security;
alter table production_batches enable row level security;
alter table production_batch_workers enable row level security;
alter table employee_attendance enable row level security;
alter table overtime_types enable row level security;
alter table overtime_requests enable row level security;
alter table employee_daily_efficiency enable row level security;
alter table operational_unit_daily_rollups enable row level security;
alter table operational_alerts enable row level security;
alter table payroll_scopes enable row level security;
alter table employee_payroll_assignments enable row level security;
alter table warehouse_payroll_runs enable row level security;
alter table warehouse_payroll_run_employees enable row level security;
alter table payroll_accounting_batches enable row level security;
alter table payroll_accounting_lines enable row level security;

create policy "view_cost_centers" on cost_centers for select using (has_active_role());
create policy "manage_cost_centers" on cost_centers for all using (current_role_name()='hr_system') with check (current_role_name()='hr_system');
create policy "view_operational_units" on operational_units for select using (user_can_view_operational_unit(id));
create policy "manage_operational_units" on operational_units for all using (current_role_name()='hr_system') with check (current_role_name()='hr_system');
create policy "view_own_unit_assignments" on warehouse_user_assignments for select using (
  profile_id=auth.uid() or current_role_name() in ('full_access','hr_system')
);
create policy "manage_unit_assignments" on warehouse_user_assignments for all using (
  current_role_name() in ('full_access','hr_system')
) with check (current_role_name() in ('full_access','hr_system'));

create policy "view_workforce_groups" on workforce_groups for select using (user_can_view_operational_unit(operational_unit_id));
create policy "manage_workforce_groups" on workforce_groups for all using (user_can_manage_operational_unit(operational_unit_id)) with check (user_can_manage_operational_unit(operational_unit_id));
create policy "view_group_members" on workforce_group_members for select using (
  exists(select 1 from workforce_groups g where g.id=workforce_group_id and user_can_view_operational_unit(g.operational_unit_id))
);
create policy "manage_group_members" on workforce_group_members for all using (
  exists(select 1 from workforce_groups g where g.id=workforce_group_id and user_can_manage_operational_unit(g.operational_unit_id))
) with check (
  exists(select 1 from workforce_groups g where g.id=workforce_group_id and user_can_manage_operational_unit(g.operational_unit_id))
);
create policy "view_shifts" on operational_shifts for select using (user_can_view_operational_unit(operational_unit_id));
create policy "manage_shifts" on operational_shifts for all using (user_can_manage_operational_unit(operational_unit_id)) with check (user_can_manage_operational_unit(operational_unit_id));
create policy "view_shift_assignments" on employee_shift_assignments for select using (user_can_view_operational_unit(operational_unit_id));
create policy "manage_shift_assignments" on employee_shift_assignments for all using (user_can_manage_operational_unit(operational_unit_id)) with check (user_can_manage_operational_unit(operational_unit_id));
create policy "view_task_types" on operational_task_types for select using (operational_unit_id is null or user_can_view_operational_unit(operational_unit_id));
create policy "manage_task_types" on operational_task_types for all using (
  (operational_unit_id is not null and user_can_manage_operational_unit(operational_unit_id)) or current_role_name()='hr_system'
) with check (
  (operational_unit_id is not null and user_can_manage_operational_unit(operational_unit_id)) or current_role_name()='hr_system'
);

create policy "view_production_batches" on production_batches for select using (user_can_view_operational_unit(operational_unit_id));
create policy "manage_production_batches" on production_batches for all using (
  user_can_manage_operational_unit(operational_unit_id) or user_can_approve_operational_unit(operational_unit_id)
) with check (
  user_can_manage_operational_unit(operational_unit_id) or user_can_approve_operational_unit(operational_unit_id)
);
create policy "view_batch_workers" on production_batch_workers for select using (
  exists(select 1 from production_batches b where b.id=production_batch_id and user_can_view_operational_unit(b.operational_unit_id))
);
create policy "manage_batch_workers" on production_batch_workers for all using (
  exists(select 1 from production_batches b where b.id=production_batch_id and b.status<>'approved' and user_can_manage_operational_unit(b.operational_unit_id))
) with check (
  exists(select 1 from production_batches b where b.id=production_batch_id and b.status<>'approved' and user_can_manage_operational_unit(b.operational_unit_id))
);
create policy "view_attendance" on employee_attendance for select using (user_can_view_operational_unit(operational_unit_id));
create policy "manage_attendance" on employee_attendance for all using (user_can_manage_operational_unit(operational_unit_id)) with check (user_can_manage_operational_unit(operational_unit_id));
create policy "view_overtime_types" on overtime_types for select using (has_active_role());
create policy "manage_overtime_types" on overtime_types for all using (current_role_name()='hr_system') with check (current_role_name()='hr_system');
create policy "view_overtime_requests" on overtime_requests for select using (user_can_view_operational_unit(operational_unit_id));
create policy "manage_overtime_requests" on overtime_requests for all using (
  user_can_manage_operational_unit(operational_unit_id) or user_can_approve_operational_unit(operational_unit_id) or current_role_name()='hr_system'
) with check (
  user_can_manage_operational_unit(operational_unit_id) or user_can_approve_operational_unit(operational_unit_id) or current_role_name()='hr_system'
);
create policy "view_employee_efficiency" on employee_daily_efficiency for select using (user_can_view_operational_unit(operational_unit_id));
create policy "view_unit_rollups" on operational_unit_daily_rollups for select using (user_can_view_operational_unit(operational_unit_id));
create policy "view_operational_alerts" on operational_alerts for select using (user_can_view_operational_unit(operational_unit_id));
create policy "manage_operational_alerts" on operational_alerts for all using (
  user_can_manage_operational_unit(operational_unit_id) or user_can_approve_operational_unit(operational_unit_id)
) with check (
  user_can_manage_operational_unit(operational_unit_id) or user_can_approve_operational_unit(operational_unit_id)
);

create policy "view_payroll_scopes" on payroll_scopes for select using (operational_unit_id is null or user_can_view_operational_unit(operational_unit_id));
create policy "manage_payroll_scopes" on payroll_scopes for all using (current_role_name()='hr_system') with check (current_role_name()='hr_system');
create policy "view_employee_payroll_assignments" on employee_payroll_assignments for select using (
  exists(select 1 from payroll_scopes p where p.id=payroll_scope_id and user_can_view_operational_unit(p.operational_unit_id))
);
create policy "manage_employee_payroll_assignments" on employee_payroll_assignments for all using (current_role_name()='hr_system') with check (current_role_name()='hr_system');
create policy "view_warehouse_payroll_runs" on warehouse_payroll_runs for select using (user_can_view_operational_unit(operational_unit_id));
create policy "view_warehouse_payroll_items" on warehouse_payroll_run_employees for select using (
  exists(select 1 from warehouse_payroll_runs r where r.id=payroll_run_id and user_can_view_operational_unit(r.operational_unit_id))
);
create policy "view_accounting_batches" on payroll_accounting_batches for select using (
  exists(select 1 from warehouse_payroll_runs r where r.id=payroll_run_id and user_can_view_operational_unit(r.operational_unit_id))
);
create policy "view_accounting_lines" on payroll_accounting_lines for select using (
  exists(select 1 from payroll_accounting_batches b join warehouse_payroll_runs r on r.id=b.payroll_run_id where b.id=accounting_batch_id and user_can_view_operational_unit(r.operational_unit_id))
);

grant execute on function approve_production_batch(uuid) to authenticated;
grant execute on function decide_overtime_request(uuid,boolean,numeric,text) to authenticated;
grant execute on function prepare_warehouse_payroll(uuid,date,date,uuid) to authenticated;
grant execute on function transition_warehouse_payroll(uuid,text) to authenticated;
grant execute on function refresh_operational_alerts(uuid,date) to authenticated;
