insert into public.mailroom_dsp_partners (
  organization_id,
  branch_id,
  code,
  name,
  sort_order
)
select
  settings.organization_id,
  settings.branch_id,
  partner.code,
  partner.name,
  partner.sort_order
from public.mailroom_productivity_settings settings
cross join (values
  ('J_AND_T', 'J&T', 10),
  ('IMILE', 'iMile', 20),
  ('ARAMEX', 'Aramex', 30)
) as partner(code, name, sort_order)
on conflict (organization_id, code) do update set
  name = excluded.name,
  branch_id = excluded.branch_id,
  sort_order = excluded.sort_order,
  status = 'active';
