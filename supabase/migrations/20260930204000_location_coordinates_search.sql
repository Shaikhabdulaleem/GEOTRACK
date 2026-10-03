-- Add explicit coordinate fields for easy indexing and distance querying
-- without requiring PostGIS or complex JSONB traversal.

ALTER TABLE public.geofences
  ADD COLUMN latitude double precision check (latitude between -90 and 90),
  ADD COLUMN longitude double precision check (longitude between -180 and 180);

ALTER TABLE public.branches
  ADD COLUMN latitude double precision check (latitude between -90 and 90),
  ADD COLUMN longitude double precision check (longitude between -180 and 180);

-- Create a helper function to find nearby geofences using the Haversine formula.
-- This returns geofences within the given radius in meters, sorted by distance.
CREATE OR REPLACE FUNCTION public.search_nearby_geofences(
  p_organization_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_radius_meters double precision DEFAULT 10000
)
RETURNS TABLE (
  id uuid,
  name text,
  branch_id uuid,
  distance_meters double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  with candidates as (
    select
      g.id,
      g.name,
      g.branch_id,
      6371000 * acos(
        least(
          1.0,
          greatest(
            -1.0,
            cos(radians(p_latitude)) * cos(radians(g.latitude)) *
            cos(radians(g.longitude) - radians(p_longitude)) +
            sin(radians(p_latitude)) * sin(radians(g.latitude))
          )
        )
      ) as distance_meters
    from public.geofences g
    where g.organization_id = p_organization_id
      and g.status = 'active'
      and g.latitude is not null
      and g.longitude is not null
      -- RLS applies because this function is SECURITY INVOKER. The explicit
      -- membership predicate also keeps the function safe if policies change.
      and exists (
        select 1
        from public.organization_memberships m
        where m.organization_id = g.organization_id
          and m.user_id = (select auth.uid())
          and m.status::text = 'active'
      )
      -- Rough bounding box optimization (1 degree is approximately 111 km).
      and g.latitude between
        p_latitude - (p_radius_meters / 111000.0)
        and p_latitude + (p_radius_meters / 111000.0)
      and g.longitude between
        p_longitude - (p_radius_meters / (111000.0 * greatest(abs(cos(radians(p_latitude))), 0.000001)))
        and p_longitude + (p_radius_meters / (111000.0 * greatest(abs(cos(radians(p_latitude))), 0.000001)))
  )
  select id, name, branch_id, distance_meters
  from candidates
  where distance_meters <= p_radius_meters
  order by distance_meters asc;
$$;

create index if not exists geofences_org_active_coordinates_idx
  on public.geofences (organization_id, latitude, longitude)
  where status = 'active' and latitude is not null and longitude is not null;

revoke all on function public.search_nearby_geofences(uuid, double precision, double precision, double precision)
  from public, anon;
grant execute on function public.search_nearby_geofences(uuid, double precision, double precision, double precision)
  to authenticated;

