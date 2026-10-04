-- Remove elevated execution from RPCs that can be enforced safely with RLS.
-- The remaining SECURITY DEFINER RPCs are transactional boundaries that write
-- to otherwise non-writable attendance/review tables. They retain explicit
-- auth.uid(), ownership, organization and manager-scope checks.

drop policy if exists notifications_update_self on public.notifications;
create policy notifications_update_self on public.notifications
  for update to authenticated
  using (recipient_user_id = (select auth.uid()))
  with check (recipient_user_id = (select auth.uid()));

grant update (read_at) on table public.notifications to authenticated;

drop policy if exists mobile_push_tokens_insert_self on public.mobile_push_tokens;
create policy mobile_push_tokens_insert_self on public.mobile_push_tokens
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_org_member(organization_id)
  );

drop policy if exists mobile_push_tokens_update_self on public.mobile_push_tokens;
create policy mobile_push_tokens_update_self on public.mobile_push_tokens
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and private.is_org_member(organization_id)
  );

grant select, insert, update, delete on table public.mobile_push_tokens to authenticated;

drop policy if exists overtime_update_explanation_self on public.overtime_records;
create policy overtime_update_explanation_self on public.overtime_records
  for update to authenticated
  using (
    private.is_employee_owner(employee_id)
    and status::text = 'pending'
  )
  with check (
    private.is_employee_owner(employee_id)
    and status::text = 'pending'
    and nullif(btrim(reason), '') is not null
    and char_length(reason) <= 2000
  );

grant update (reason, updated_at) on table public.overtime_records to authenticated;

alter function public.mark_notification_read(uuid) security invoker;
alter function public.register_mobile_push_token(text, text, text) security invoker;
alter function public.unregister_mobile_push_token(text) security invoker;
alter function public.request_overtime_explanation(uuid, text) security invoker;
alter function public.upsert_phone_usage_summary(
  uuid, uuid, text, date, uuid, integer, integer, integer, numeric, text, text, timestamptz
) security invoker;

revoke all on function public.mark_notification_read(uuid) from public, anon;
revoke all on function public.register_mobile_push_token(text, text, text) from public, anon;
revoke all on function public.unregister_mobile_push_token(text) from public, anon;
revoke all on function public.request_overtime_explanation(uuid, text) from public, anon;
revoke all on function public.upsert_phone_usage_summary(
  uuid, uuid, text, date, uuid, integer, integer, integer, numeric, text, text, timestamptz
) from public, anon;

grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.register_mobile_push_token(text, text, text) to authenticated;
grant execute on function public.unregister_mobile_push_token(text) to authenticated;
grant execute on function public.request_overtime_explanation(uuid, text) to authenticated;
grant execute on function public.upsert_phone_usage_summary(
  uuid, uuid, text, date, uuid, integer, integer, integer, numeric, text, text, timestamptz
) to authenticated;
