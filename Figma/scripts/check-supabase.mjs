import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL?.trim()
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

if (!url || !publishableKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env.local.')
  process.exit(1)
}

if (/(service[_-]?role|secret|sb_secret_)/i.test(publishableKey)) {
  console.error('Refusing to use a Supabase secret key from a frontend environment variable.')
  process.exit(1)
}

const authHealth = await fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, {
  headers: { apikey: publishableKey },
})

if (!authHealth.ok) {
  console.error(`Supabase Auth health check failed with HTTP ${authHealth.status}.`)
  process.exit(1)
}

const supabase = createClient(url, publishableKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
})

// Production intentionally grants no table privileges to anon. A successful
// unauthenticated table read is therefore a security failure, while a PostgREST
// permission response confirms both connectivity and the expected boundary.
const dataApiProbe = await fetch(`${url.replace(/\/$/, '')}/rest/v1/organizations?select=id&limit=1`, {
  headers: {
    apikey: publishableKey,
    Authorization: `Bearer ${publishableKey}`,
  },
})

if (dataApiProbe.ok) {
  console.error('Supabase Data API security check failed: anon can read organizations.')
  process.exit(1)
}

if (![401, 403].includes(dataApiProbe.status)) {
  console.error(`Supabase Data API connectivity check failed with HTTP ${dataApiProbe.status}.`)
  process.exit(1)
}

const testEmail = process.env.SUPABASE_TEST_EMAIL?.trim()
const testPassword = process.env.SUPABASE_TEST_PASSWORD?.trim()

if (testEmail && testPassword) {
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  })
  if (signInError) {
    console.error(`Authenticated smoke-test sign-in failed: ${signInError.message}`)
    process.exit(1)
  }

  const { error: membershipError } = await supabase
    .from('organization_memberships')
    .select('organization_id, role_code, status')
    .eq('status', 'active')
    .limit(1)
  await supabase.auth.signOut()

  if (membershipError) {
    console.error(`Authenticated Data API check failed: ${membershipError.message}`)
    process.exit(1)
  }
}

console.log(`Supabase Auth is healthy; Data API correctly denies anon table access${testEmail && testPassword ? '; authenticated access passed' : ''}.`)
