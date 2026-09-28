-- Evaluate auth.uid() once per statement for mobile token policies.
drop policy if exists "users manage their own push tokens_insert" on public.mobile_push_tokens;
drop policy if exists "users manage their own push tokens_update" on public.mobile_push_tokens;
drop policy if exists "users manage their own push tokens_delete" on public.mobile_push_tokens;

create policy mobile_push_tokens_insert_self on public.mobile_push_tokens
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy mobile_push_tokens_update_self on public.mobile_push_tokens
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy mobile_push_tokens_delete_self on public.mobile_push_tokens
  for delete to authenticated
  using (user_id = (select auth.uid()));
