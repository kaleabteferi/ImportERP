-- Let full_access (owner) act at every warehouse payroll approval stage.
-- HR/Finance separation of duties still applies to hr_system/
-- accounting_finance accounts, but the owner should never be blocked from
-- approving, rejecting, or posting when no dedicated HR/Finance user exists.

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
    if current_role_name() not in ('hr_system','full_access') or v_run.status<>'submitted' then raise exception 'HR approval is not allowed at this stage'; end if;
    update warehouse_payroll_runs set status='hr_approved',hr_approved_by=auth.uid(),updated_at=now() where id=p_run_id;
  elsif p_action='finance_approve' then
    if current_role_name() not in ('accounting_finance','full_access') or v_run.status<>'hr_approved' then raise exception 'Finance approval is not allowed at this stage'; end if;
    update warehouse_payroll_runs set status='finance_approved',finance_approved_by=auth.uid(),updated_at=now() where id=p_run_id;
  elsif p_action='post' then
    if current_role_name() not in ('accounting_finance','full_access') or v_run.status<>'finance_approved' then raise exception 'Only Finance can post an approved payroll'; end if;
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
      (v_batch_id,v_scope.pension_expense_account_code,'Employer pension expense',v_run.employer_pension_amount,0,v_run.run_number),
      (v_batch_id,v_scope.payroll_payable_account_code,'Employee payroll payable',0,v_run.net_amount,v_run.run_number),
      (v_batch_id,v_scope.tax_payable_account_code,'Tax payable',0,v_run.tax_amount,v_run.run_number),
      (v_batch_id,v_scope.pension_payable_account_code,'Pension payable',0,v_run.pension_amount+v_run.employer_pension_amount,v_run.run_number),
      (v_batch_id,'OTHER-DEDUCTIONS-PAYABLE','Other deductions payable',0,v_run.deduction_amount,v_run.run_number);
    update overtime_requests
    set status='posted'
    where operational_unit_id=v_run.operational_unit_id
      and overtime_date between v_run.period_start and v_run.period_end
      and status='approved';
    update warehouse_payroll_runs set status='posted',posted_at=now(),updated_at=now() where id=p_run_id;
  elsif p_action='reject' then
    if not (
      current_role_name()='full_access'
      or (v_run.status='submitted' and current_role_name()='hr_system')
      or (v_run.status='hr_approved' and current_role_name()='accounting_finance')
    ) then raise exception 'Payroll cannot be rejected by this role at the current stage'; end if;
    update warehouse_payroll_runs
    set status='rejected',notes=concat_ws(E'\n',notes,'Rejected during approval workflow'),updated_at=now()
    where id=p_run_id;
  else raise exception 'Unknown payroll action';
  end if;
end;
$$;
