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
  const sql = await read('rls_policies.sql')
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /revoke all on table/i)
  assert.match(sql, /to authenticated/i)
  assert.doesNotMatch(sql, /grant .* to anon/i)
})
