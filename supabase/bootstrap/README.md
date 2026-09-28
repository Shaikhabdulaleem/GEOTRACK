# Production bootstrap

This directory contains deliberately manual, one-time production setup—not
schema migrations and not demo seed data.

1. Create the first account in **Supabase Dashboard → Authentication → Users**.
   Use a real administrator email and a unique temporary password; require the
   administrator to change it through the normal password-reset flow.
2. Copy that Auth user's UUID.
3. Copy `first_admin.sql.example`, replace its four placeholders, and run the
   edited copy in **SQL Editor**. Do not commit the edited copy.
4. Sign in through the application and confirm the active role is
   `administrator`.

The trigger on `auth.users` creates the public profile automatically. The
bootstrap adds only the organization and active administrator membership. It
contains no password and never requires a service-role key in a client.
