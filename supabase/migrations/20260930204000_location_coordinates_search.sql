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
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT 
    g.id,
    g.name,
    g.branch_id,
    (
      6371000 * acos(
        cos(radians(p_latitude)) * cos(radians(g.latitude)) * 
        cos(radians(g.longitude) - radians(p_longitude)) + 
        sin(radians(p_latitude)) * sin(radians(g.latitude))
      )
    ) AS distance_meters
  FROM public.geofences g
  WHERE g.organization_id = p_organization_id
    AND g.status::text = 'active'
    AND g.latitude IS NOT NULL
    AND g.longitude IS NOT NULL
    -- Ensure the user has access to this organization
    AND exists (
      select 1 from public.organization_memberships m
      where m.organization_id = g.organization_id
        and m.user_id = (select auth.uid())
        and m.status::text = 'active'
    )
    -- Rough bounding box optimization (1 degree is ~111km)
    AND g.latitude BETWEEN p_latitude - (p_radius_meters / 111000.0) AND p_latitude + (p_radius_meters / 111000.0)
    AND g.longitude BETWEEN p_longitude - (p_radius_meters / (111000.0 * cos(radians(p_latitude)))) AND p_longitude + (p_radius_meters / (111000.0 * cos(radians(p_latitude))))
  HAVING (
    6371000 * acos(
      cos(radians(p_latitude)) * cos(radians(g.latitude)) * 
      cos(radians(g.longitude) - radians(p_longitude)) + 
      sin(radians(p_latitude)) * sin(radians(g.latitude))
    )
  ) <= p_radius_meters
  ORDER BY distance_meters ASC;
$$;

GRANT EXECUTE ON FUNCTION public.search_nearby_geofences(uuid, double precision, double precision, double precision) TO authenticated;

