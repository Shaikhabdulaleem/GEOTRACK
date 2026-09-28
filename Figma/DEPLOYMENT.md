# GEOTRACK production deployment

## Supabase checklist

- [ ] Use separate Supabase projects for development, staging, and production.
- [ ] Apply `supabase/migrations/20260928000000_rls_hardening.sql` to staging,
      run the smoke check, then promote the same migration to production.
- [ ] Confirm the base schema and enum types exist before applying the RLS
      migration; this repository intentionally does not include the original
      base-schema migration.
- [ ] Enable email/password authentication and configure the production SMTP
      provider, sender, rate limits, and password policy.
- [ ] Set **Site URL** to the exact `VITE_APP_URL` origin.
- [ ] This SPA has no Vercel API route, so it does not need a wildcard CORS
      response header. If Supabase Edge Functions are added, allow-list the
      production and staging origins explicitly and never combine credentials
      with `Access-Control-Allow-Origin: *`.
- [ ] Add only the required redirect URLs, including
      `https://app.example.com/reset-password`, plus the exact staging and local
      URLs needed by those environments. Do not use a wildcard in production.
- [ ] Treat the publishable/anon key as browser-visible. Never put a
      `service_role`, `sb_secret_`, database password, or JWT signing secret in
      a `VITE_*` variable or the repository.
- [ ] Verify the Data API exposes only the required tables/RPCs, `anon` has no
      table access, and authenticated reads/writes are constrained by RLS.
- [ ] Test administrator, manager, and employee accounts from different
      organizations. Confirm cross-tenant reads, direct table writes, and
      unauthorized RPC calls fail.
- [ ] Keep demo fixtures out of production. The `supabase/seed/` directory is
      for local/staging-only data and is not part of the production deploy.
- [ ] Configure database backups/PITR, retention, log access, and an alert for
      failed migrations or elevated PostgREST/Auth errors.

## Vercel checklist

- [ ] Import the `Figma/` directory as the Vercel project root (or set the
      project root to the directory containing `package.json`).
- [ ] Use `pnpm install --frozen-lockfile` for installation and `pnpm build` for
      the build command. Output directory is `dist`.
- [ ] Add the production variables from `.env.production.example` to the
      **Production** environment only. Add staging variables separately to
      **Preview**; never copy production keys into Preview.
- [ ] Set `VITE_APP_URL` to the canonical HTTPS domain and configure the same
      domain in Supabase Auth URL settings.
- [ ] Attach the production domain, enforce HTTPS, and verify the canonical
      redirect and password-reset flow.
- [ ] Keep `vercel.json` enabled: it provides the SPA route fallback and
      security headers (CSP, frame blocking, referrer and permissions policy).
- [ ] Confirm `/`, `/sign-in`, `/reset-password`, and a deep route such as
      `/attendance` work on a cold request, not only after client navigation.
- [ ] Review the build output. The largest current chunk is the lazy-loaded
      charts chunk (~398 kB / ~114 kB gzip); maps and Supabase are split into
      their own lazy/vendor chunks.
- [ ] Run the post-deploy smoke test with a non-production test account and
      `pnpm test:supabase` using a temporary `.env.local` that is never
      committed.
- [ ] Enable Vercel deployment protection/preview access controls and alerts;
      do not expose authenticated staging data publicly.

## Release gate

Run `pnpm check` before promotion. It performs TypeScript checking, production
linting, configuration tests, and a production Vite build. A live Supabase smoke
test remains environment-dependent and must be run after staging credentials and
the migration are available.
