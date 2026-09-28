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

const { error } = await supabase
  .from('organizations')
  .select('id', { count: 'exact', head: true })

if (error) {
  console.error(`Supabase Data API check failed: ${error.message}`)
  console.error('Confirm that the organizations table, Data API grants, and RLS policies have been deployed.')
  process.exit(1)
}

console.log('Supabase Auth and Data API connections are healthy.')
