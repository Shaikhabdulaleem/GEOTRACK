# Supabase migrations

This repository-root directory is the deployable database source of truth for
both the web and Android applications. The ordered history includes the base
schema, canonical RLS, Android RPCs, and database-advisor remediation.

For future changes, create a new timestamped migration here and apply it to a
development or staging project before promoting the exact same SQL to
production:

```sh
supabase db push --db-url "$SUPABASE_DB_URL"
```

Production contains several legacy migrations applied under deployment-time
timestamps rather than their repository timestamps. Do not use an unreviewed
`db push` against that ledger. The reconciled automatic-checkout rollout is
recorded in production as `20261103130402_reliable_auto_checkout_overtime` and
`20261103130652_reconcile_auto_checkout_cron`;
`20261029120000_auto_close_grace_early_checkout.sql` is superseded and must not
be deployed independently. Keep demo data in `../seed/`; never place fake
users, organizations, attendance, or location history in production migrations.
