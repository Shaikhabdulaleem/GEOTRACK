import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')

test('environment templates only expose browser-safe configuration', async () => {
  const [local, staging, production] = await Promise.all([
    read('.env.example'),
    read('.env.staging.example'),
    read('.env.production.example'),
  ])

  for (const contents of [local, staging, production]) {
    assert.match(contents, /VITE_SUPABASE_URL=/)
    assert.match(contents, /VITE_SUPABASE_PUBLISHABLE_KEY=/)
    assert.match(contents, /VITE_APP_ENV=/)
    assert.doesNotMatch(contents, /service_role|sb_secret_/i)
  }
})

test('Vercel serves the SPA shell for client-side routes and sets security headers', async () => {
  const vercel = JSON.parse(await read('vercel.json'))
  assert.equal(vercel.outputDirectory, 'dist')
  assert.equal(vercel.rewrites[0].destination, '/index.html')
  const headers = vercel.headers[0].headers.map(header => header.key)
  assert.ok(headers.includes('Content-Security-Policy'))
  assert.ok(headers.includes('X-Frame-Options'))
})

test('RLS hardening is present and does not grant anonymous access', async () => {
  const sql = await read('../supabase/migrations/20260928200408_rls_hardening.sql')
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /revoke all on table/i)
  assert.match(sql, /to authenticated/i)
  assert.doesNotMatch(sql, /grant .* to anon/i)
})

test('overtime review RPCs enforce authentication, scope, and least privilege', async () => {
  const sql = await read('../supabase/migrations/20261112120000_employee_overtime_review.sql')
  assert.match(sql, /p_to_date - p_from_date > 89/i)
  assert.match(sql, /private\.can_access_employee/i)
  assert.match(sql, /set search_path = ''/i)
  assert.match(sql, /revoke all on function public\.review_overtime_batch\(jsonb\) from public, anon/i)
  assert.match(sql, /grant execute on function public\.review_overtime_batch\(jsonb\) to authenticated/i)
  assert.match(sql, /attendance_manager_corrected/i)
  assert.match(sql, /for update/i)
})

test('Mailroom productivity is department-scoped, RLS protected, and atomically saved', async () => {
  const sql = await read('../supabase/migrations/20261115150000_mailroom_productivity_module.sql')
  assert.match(sql, /join public\.departments d/i)
  assert.match(sql, /d\.name ilike 'Mailroom'/i)
  assert.match(sql, /e\.department_id = v_department_id/i)
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /revoke all on table .* from public, anon, authenticated/is)
  assert.match(sql, /private\.can_access_mailroom/i)
  assert.match(sql, /save_mailroom_productivity_week\(/i)
  assert.match(sql, /save_mailroom_productivity_week[\s\S]*security definer[\s\S]*set search_path = ''/i)
  assert.doesNotMatch(sql, /grant insert, update, delete on table public\.mailroom_daily_shipments/i)
  assert.match(sql, /extract\(dow from p_week_start\) <> 0/i)
  assert.match(sql, /would make a client backlog negative/i)
  assert.match(sql, /grant execute on function public\.save_mailroom_productivity_week\(uuid, date, jsonb\) to authenticated/i)
})

test('Mailroom productivity UI preserves employee performance and adds operations workflow', async () => {
  const [view, migration] = await Promise.all([
    read('src/views/Productivity.tsx'),
    read('../supabase/migrations/20261115170000_mailroom_daily_operations.sql'),
  ])
  assert.match(view, /Operations Dashboard/)
  assert.match(view, /Daily Entry/)
  assert.match(view, /Employee Performance/)
  assert.match(view, /Add Mailroom client or bank/)
  assert.match(view, /Suggested overtime allocation/)
  assert.match(view, /Received/)
  assert.match(view, /Processed \/ handover/)
  assert.doesNotMatch(view, />Validated</)
  assert.match(view, /Live staffing impact/)
  assert.match(view, /DSP allocation/)
  assert.match(view, /Returns received/)
  assert.match(view, /Save draft/)
  assert.match(view, /Finalize day/)
  assert.match(view, /Save & finalize imported data/)
  assert.match(view, /status: 'finalized'/)
  assert.match(migration, /save_mailroom_productivity_day\(/i)
  assert.match(migration, /DSP allocation must equal processed shipments/i)
  assert.match(migration, /status in \('draft', 'finalized'\)/i)
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /revoke all on table public\.mailroom_dsp_partners/i)
})

test('validation-client batches close using aggregate counts only', async () => {
  const [migration, releaseMigration, importer] = await Promise.all([
    read('../supabase/migrations/20261120094307_mailroom_validation_batch_closures.sql'),
    read('../supabase/migrations/20261120124500_allow_backlog_release_after_early_validation.sql'),
    read('src/lib/aymakan-import.ts'),
  ])
  assert.match(migration, /backlog_released_units bigint not null default 0/i)
  assert.match(migration, /batch_closed_units bigint not null default 0/i)
  assert.match(migration, /d\.received_units - d\.backlog_released_units - d\.batch_closed_units/i)
  assert.match(migration, /c\.processing_mode = 'validation_gated'/i)
  assert.match(importer, /validationBatchCloseDate/i)
  assert.match(importer, /shipment\.validation_date > selectedWorkDate/i)
  assert.doesNotMatch(migration, /backlog_released_units, x\.processed_units\) <= x\.processed_units/i)
  assert.match(releaseMigration, /cumulative backlog must remain nonnegative/i)
  assert.doesNotMatch(migration, /tracking_number|address/i)
})

test('turnaround, returns, daily dashboard, and overtime cost remain aggregate-only', async () => {
  const [view, importer, service, migration] = await Promise.all([
    read('src/views/Productivity.tsx'),
    read('src/lib/aymakan-import.ts'),
    read('src/services/productivity.service.ts'),
    read('../supabase/migrations/20261120143000_mailroom_turnaround_and_ot_cost.sql'),
  ])
  assert.match(view, /\['day', 'week', 'month'\]/)
  assert.match(view, /Actual OT/)
  assert.match(view, /OT Cost Saved/)
  assert.match(view, /Destination branch/)
  assert.match(view, /Client-wise returns/)
  assert.match(view, /aggregateAymakanReturnsByClient\(groupSnapshot, activeClients, date\)/)
  assert.match(service, /save_mailroom_client_returns/)
  assert.match(importer, /mronhold/)
  assert.match(importer, /updated_date/)
  assert.match(importer, /lmd_handover_at_ms/)
  assert.match(service, /attendance.*overtime_minutes/is)
  assert.match(migration, /mailroom_daily_turnaround_metrics/i)
  assert.match(migration, /overtime_hourly_cost/i)
  assert.match(migration, /enable row level security/i)
  assert.doesNotMatch(migration, /tracking_number|customer_name|address/i)
})

test('administrator device approvals compare phones and use the audited review RPC', async () => {
  const [view, access, service, migration] = await Promise.all([
    read('src/views/DeviceApprovals.tsx'),
    read('src/auth/view-access.ts'),
    read('src/services/device.service.ts'),
    read('../supabase/migrations/20261116183000_device_enrollment_admin_review.sql'),
  ])

  assert.match(access, /'device-approvals': \['administrator'\]/)
  assert.match(view, /Last approved mobile/)
  assert.match(view, /Current mobile requesting access/)
  assert.match(view, /New attendance device detected/)
  assert.match(view, /Approve current mobile/)
  assert.match(view, /Reject device/)
  assert.match(service, /rpc\('review_employee_device_enrollment'/)
  assert.match(migration, /private\.has_org_role\(v_device\.organization_id, array\['administrator'\]\)/i)
  assert.match(migration, /previous_integrity_status, new_integrity_status, reason/i)
  assert.match(migration, /revoke all on function public\.review_employee_device_enrollment\(uuid, text, text\)/i)
})
