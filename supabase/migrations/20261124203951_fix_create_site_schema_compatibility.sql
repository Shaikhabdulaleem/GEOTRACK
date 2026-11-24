-- Keep site creation compatible with the current geofence schema. The
-- previously deployed RPC referenced columns from an abandoned schema draft.

create or replace function public.create_site(
  p_organization_id uuid,
  p_name text,
  p_code text,
  p_timezone text default 'UTC',
  p_address text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_create_geofence boolean default false,
  p_geofence_radius_meters integer default 30
)
returns public.branches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site public.branches%rowtype;
  v_geofence_id uuid;
  v_points jsonb;
begin
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Site management denied: administrator role required' using errcode = '42501';
  end if;
  if p_create_geofence and (p_latitude is null or p_longitude is null) then
    raise exception 'Coordinates are required to create a geofence' using errcode = '22023';
  end if;
  if p_geofence_radius_meters <= 0 then
    raise exception 'Geofence radius must be positive' using errcode = '22023';
  end if;

  insert into public.branches (
    organization_id, code, name, timezone, address, location_point,
    latitude, longitude, created_by
  ) values (
    p_organization_id, upper(btrim(p_code)), btrim(p_name), coalesce(nullif(btrim(p_timezone), ''), 'UTC'),
    nullif(btrim(p_address), ''),
    case when p_latitude is not null and p_longitude is not null
         then jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(p_longitude, p_latitude))
         else null end,
    p_latitude, p_longitude, (select auth.uid())
  ) returning * into v_site;

  if p_create_geofence then
    insert into public.geofences (
      organization_id, branch_id, name, status, required_accuracy_meters,
      latitude, longitude, created_by
    ) values (
      p_organization_id, v_site.id, v_site.name || ' geofence', 'active',
      greatest(5, p_geofence_radius_meters), p_latitude, p_longitude, (select auth.uid())
    ) returning id into v_geofence_id;

    select jsonb_agg(
      jsonb_build_array(
        p_longitude + (p_geofence_radius_meters / (111320.0 * cos(radians(p_latitude)))) * sin(radians(i * 360.0 / 32.0)),
        p_latitude + (p_geofence_radius_meters / 110540.0) * cos(radians(i * 360.0 / 32.0))
      ) order by i
    )
    into v_points
    from generate_series(0, 32) i;

    insert into public.geofence_polygons (geofence_id, version_number, polygon, created_by)
    values (
      v_geofence_id, 1,
      jsonb_build_object('type', 'MultiPolygon', 'coordinates', jsonb_build_array(jsonb_build_array(v_points))),
      (select auth.uid())
    );
  end if;

  return v_site;
end;
$$;

revoke all on function public.create_site(uuid, text, text, text, text, double precision, double precision, boolean, integer) from public, anon;
grant execute on function public.create_site(uuid, text, text, text, text, double precision, double precision, boolean, integer) to authenticated;
