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
  assert.match(migration, /save_mailroom_productivity_day\(/i)
  assert.match(migration, /DSP allocation must equal processed shipments/i)
  assert.match(migration, /status in \('draft', 'finalized'\)/i)
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /revoke all on table public\.mailroom_dsp_partners/i)
})
