# Supabase migrations

This repository-root directory is the only deployable database source of truth
for both the web and Android applications. Filenames match the production
Supabase migration history exactly. The ordered history includes the base
schema, canonical RLS, Android RPCs, and database-advisor remediation.

For future changes, create a new timestamped migration here and apply it to a
development or staging project before promoting the exact same SQL to
production:

```sh
supabase db push --db-url "$SUPABASE_DB_URL"
```

The production project currently records the same ten migration versions in
this directory. Keep demo data in `../seed/`; never place fake users,
organizations, attendance, or location history in production migrations.
