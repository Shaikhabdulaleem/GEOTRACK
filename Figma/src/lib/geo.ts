/**
 * geo.ts — Pure geometry utilities with no external dependencies.
 *
 * ALL coordinate pairs are [longitude, latitude] (GeoJSON convention).
 * The functions below deliberately mirror the PostGIS / GeoJSON semantics
 * used in the Supabase backend so front-end and back-end always agree.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** [longitude, latitude] — GeoJSON order */
export type LngLat = [number, number];

/** Leaflet / display order: [lat, lng] */
export type LatLng = [number, number];

export interface GeofenceValidationResult {
  inside: boolean;
  /** Distance in metres from polygon boundary. Negative = outside. */
  distanceMeters: number | null;
  /** 'valid' | 'invalid' | 'low_accuracy' | 'permission_denied' | 'mock_location' | 'unknown' */
  status: 'valid' | 'invalid' | 'low_accuracy' | 'permission_denied' | 'mock_location' | 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// Point-in-polygon — Ray-casting algorithm (O(n))
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the point [px, py] is inside the simple polygon
 * described by `ring` (array of [x, y] pairs — any coordinate system).
 *
 * Uses the ray-casting algorithm which handles convex AND concave polygons
 * correctly. Does NOT require a closed ring (i.e. first ≠ last point).
 *
 * Reference: W. Randolph Franklin, PNPOLY
 */
export function pointInPolygon(point: [number, number], ring: [number, number][]): boolean {
  const [px, py] = point;
  let inside = false;
  const n = ring.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    const intersects =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

/**
 * GeoJSON MultiPolygon point-in-polygon.
 * Returns true if [lng, lat] is inside ANY polygon of the MultiPolygon.
 * A polygon consists of an outer boundary (first ring) and optional holes (subsequent rings).
 * A point is inside the polygon if it is inside the outer boundary AND NOT inside any holes.
 */
export function pointInMultiPolygon(
  lngLat: LngLat,
  multiPolygonCoords: number[][][][],
): boolean {
  for (const polygon of multiPolygonCoords) {
    if (polygon.length === 0) continue;
    
    // Check outer boundary (first ring)
    const outerRing = polygon[0] as [number, number][];
    if (pointInPolygon(lngLat, outerRing)) {
      let insideHole = false;
      // Check holes (subsequent rings)
      for (let i = 1; i < polygon.length; i++) {
        const holeRing = polygon[i] as [number, number][];
        if (pointInPolygon(lngLat, holeRing)) {
          insideHole = true;
          break;
        }
      }
      if (!insideHole) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Haversine distance
// ─────────────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000;

/** Returns the great-circle distance in metres between two [lat, lng] pairs. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aVal =
    sinDLat * sinDLat + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
}

// ─────────────────────────────────────────────────────────────────────────────
// Approximate centroid of a polygon ring
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the arithmetic centroid [lng, lat] of a ring. */
export function polygonCentroid(ring: LngLat[]): LngLat {
  const n = ring.length;
  if (n === 0) return [0, 0];
  const sum = ring.reduce(
    (acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat] as LngLat,
    [0, 0] as LngLat,
  );
  return [sum[0] / n, sum[1] / n];
}

/** Bounding box of a ring. Returns { minLng, maxLng, minLat, maxLat }. */
export function polygonBBox(ring: LngLat[]): {
  minLng: number; maxLng: number; minLat: number; maxLat: number;
} {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, maxLng, minLat, maxLat };
}

// ─────────────────────────────────────────────────────────────────────────────
// GPS Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a GPS position against a GeoJSON MultiPolygon.
 *
 * @param lat  - Latitude from device GPS
 * @param lng  - Longitude from device GPS
 * @param accuracyMeters - GPS accuracy reported by device (null = unknown)
 * @param requiredAccuracyMeters - Minimum accuracy required (from geofence config)
 * @param multiPolygonCoords - GeoJSON MultiPolygon coordinates array
 * @param isMockLocation - Whether device reports mock/spoofed location
 */
export function validateGpsAgainstGeofence(input: {
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  requiredAccuracyMeters: number;
  multiPolygonCoords: number[][][][];
  isMockLocation?: boolean;
}): GeofenceValidationResult {
  const { lat, lng, accuracyMeters, requiredAccuracyMeters, multiPolygonCoords, isMockLocation } =
    input;

  if (isMockLocation) {
    return { inside: false, distanceMeters: null, status: 'mock_location' };
  }

  if (accuracyMeters !== null && accuracyMeters > requiredAccuracyMeters) {
    return { inside: false, distanceMeters: null, status: 'low_accuracy' };
  }

  const inside = pointInMultiPolygon([lng, lat], multiPolygonCoords);

  return {
    inside,
    distanceMeters: null, // approximate distance could be computed if needed
    status: inside ? 'valid' : 'invalid',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GeoJSON helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a simple flat ring of [lng, lat] pairs to a GeoJSON MultiPolygon
 * structure (single outer ring, no holes).
 *
 * GeoJSON requires the ring to be explicitly closed (first === last point).
 */
export function ringToMultiPolygon(ring: LngLat[]): { type: 'MultiPolygon'; coordinates: number[][][][] } {
  const closed =
    ring.length > 0 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring
      : [...ring, ring[0]]; // close the ring

  return {
    type: 'MultiPolygon',
    coordinates: [[closed.map(([lng, lat]) => [lng, lat])]],
  };
}

/**
 * Extracts the first outer ring from a GeoJSON MultiPolygon as [lng, lat][].
 */
export function multiPolygonToRing(mp: { coordinates: number[][][][] }): LngLat[] {
  const ring = mp.coordinates?.[0]?.[0] ?? [];
  // Remove the closing duplicate point
  const last = ring[ring.length - 1];
  const first = ring[0];
  if (last && first && last[0] === first[0] && last[1] === first[1]) {
    return ring.slice(0, -1) as LngLat[];
  }
  return ring as LngLat[];
}
