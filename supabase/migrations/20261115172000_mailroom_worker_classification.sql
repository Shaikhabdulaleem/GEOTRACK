-- Align default Mailroom DLP classification with the workforce job titles in production.
update public.mailroom_employee_settings s
set labor_class = 'dlp',
    employment_source = case when e.employee_code ~* '^3PL' then '3pl' else 'own' end,
    overtime_eligible = true
from public.employee_profiles e
where e.id = s.employee_id
  and e.organization_id = s.organization_id
  and coalesce(e.job_title, '') ~* 'labou?r|worker|operation assistant'
  and s.labor_class = 'non_dlp';
