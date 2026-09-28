# Supabase migrations

`20260928000000_rls_hardening.sql` is the reviewed, idempotent authorization
migration for the current database schema. `rls_policies.sql` at the project
root is retained as the human-readable source copy (the migration omits the
explicit `BEGIN`/`COMMIT` wrapper so the Supabase CLI owns the transaction).
Apply the migration in a
staging Supabase project first, then promote the exact same SQL to production:

```sh
supabase db push --db-url "$SUPABASE_DB_URL"
```

The repository does not contain the original base-schema migration, so the RLS
script intentionally fails if required tables or enum types are missing. Add
future schema changes as timestamped SQL files in this directory and keep demo
data in a separate, explicitly invoked seed script. Never run demo seeds
against the production project.
