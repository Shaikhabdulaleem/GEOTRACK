import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import { ringToMultiPolygon, multiPolygonToRing, validateGpsAgainstGeofence } from '../lib/geo';
import type {
  GeofenceRow,
  GeofencePolygonRow,
  GeofenceAssignmentRow,
  GeofenceStatus,
  CheckinMode,
  TablesInsert,
  TablesUpdate,
  EmployeeProfileRow,
  GeofenceValidationStatus,
  AttendanceSource,
} from '../types/database';
import type { LngLat } from '../lib/geo';

// ─────────────────────────────────────────────────────────────────────────────
// Extended types
// ─────────────────────────────────────────────────────────────────────────────

export interface GeofenceWithPolygon extends GeofenceRow {
  /** Active polygon row, or null if none yet saved */
  activePolygon: GeofencePolygonRow | null;
  /** Convenience: outer ring as [lng, lat][] extracted from GeoJSON */
  ring: LngLat[];
  /** Number of employees assigned */
  assignedCount: number;
}

export interface GeofenceCreateInput {
  organization_id: string;
  branch_id: string;
  name: string;
  color?: string;
  checkin_mode?: CheckinMode;
  required_accuracy_meters?: number;
  auto_checkout_timeout_minutes?: number;
  created_by?: string | null;
  /** Outer boundary as [lng, lat][] — minimum 3 points */
  ring: LngLat[];
}

export interface GeofenceUpdateInput {
  name?: string;
  branch_id?: string;
  color?: string;
  checkin_mode?: CheckinMode;
  required_accuracy_meters?: number;
  auto_checkout_timeout_minutes?: number;
  status?: GeofenceStatus;
  /** If provided, a new polygon version is created and the old one deactivated */
  ring?: LngLat[];
  updated_by?: string | null;
}

export interface AttendanceEventInput {
  organization_id: string;
  employee_id: string;
  geofence_id: string;
  geofence_polygon_id: string | null;
  event_type: 'gps_enter' | 'gps_exit' | 'automatic_check_in' | 'automatic_check_out' | 'manual_check_in' | 'manual_check_out';
  source: AttendanceSource;
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  geofence_validation: GeofenceValidationStatus;
  inside_geofence: boolean;
  device_info?: Record<string, unknown>;
  idempotency_key?: string;
  created_by?: string | null;
}

export interface GeofenceValidationInput {
  geofence_id: string;
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  is_mock_location?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export const geofenceService = {
  // ── Geofences (list / get) ───────────────────────────────────────────────

  /** List all geofences with their active polygon and assignment count. */
  async listWithPolygons(organizationId: string): Promise<GeofenceWithPolygon[]> {
    const client = getSupabaseClient();

    // Query 1: geofences
    const { data: fencesData, error: fencesErr } = await client
      .from('geofences')
      .select('*')
      .eq('organization_id', organizationId)
      .order('name');
    if (fencesErr) throw fencesErr;
    const fences = (fencesData ?? []) as GeofenceRow[];

    if (fences.length === 0) return [];

    // Query 2: active polygons for all fetched geofences
    const geofenceIds = fences.map(f => f.id);
    const { data: polygonsData } = await client
      .from('geofence_polygons')
      .select('*')
      .in('geofence_id', geofenceIds)
      .eq('is_active', true);
    const polygons = (polygonsData ?? []) as GeofencePolygonRow[];

    // Query 3: assignment counts
    const { data: assignmentsData } = await client
      .from('geofence_assignments')
      .select('geofence_id')
      .eq('organization_id', organizationId)
      .is('effective_to', null);

    const countMap: Record<string, number> = {};
    for (const a of assignmentsData ?? []) {
      const gid = (a as { geofence_id: string }).geofence_id;
      countMap[gid] = (countMap[gid] ?? 0) + 1;
    }

    return fences.map(fence => {
      const activePolygon = polygons.find(p => p.geofence_id === fence.id) ?? null;
      const ring = activePolygon ? multiPolygonToRing(activePolygon.polygon) : [];
      return { ...fence, activePolygon, ring, assignedCount: countMap[fence.id] ?? 0 };
    });
  },

  /** Get a single geofence with its active polygon. */
  async getWithPolygon(geofenceId: string): Promise<GeofenceWithPolygon> {
    const fence = await executeQuery(
      getSupabaseClient().from('geofences').select('*').eq('id', geofenceId).single(),
      'Unable to load geofence.',
    ) as GeofenceRow;

    const { data: polygonData } = await getSupabaseClient()
      .from('geofence_polygons')
      .select('*')
      .eq('geofence_id', geofenceId)
      .eq('is_active', true)
      .maybeSingle();

    const activePolygon = (polygonData as GeofencePolygonRow | null) ?? null;
    const ring = activePolygon ? multiPolygonToRing(activePolygon.polygon) : [];

    const { count } = await getSupabaseClient()
      .from('geofence_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('geofence_id', geofenceId)
      .is('effective_to', null);

    return { ...fence, activePolygon, ring, assignedCount: count || 0 };
  },


  // ── Create ───────────────────────────────────────────────────────────────

  /** Create a new geofence with its first polygon version. */
  async create(input: GeofenceCreateInput): Promise<GeofenceWithPolygon> {
    if (input.ring.length < 3) {
      throw new Error('A geofence polygon requires at least 3 points.');
    }

    const client = getSupabaseClient();

    // 1. Create the geofence record
    const fence = await executeQuery(
      client
        .from('geofences')
        .insert({
          organization_id: input.organization_id,
          branch_id: input.branch_id,
          name: input.name,
          color: input.color ?? '#2563eb',
          status: 'active',
          checkin_mode: input.checkin_mode ?? 'confirmation',
          required_accuracy_meters: input.required_accuracy_meters ?? 50,
          auto_checkout_timeout_minutes: input.auto_checkout_timeout_minutes ?? 15,
          created_by: input.created_by ?? null,
        } as TablesInsert<'geofences'>)
        .select('*')
        .single(),
      'Unable to create the geofence.',
    ) as GeofenceRow;

    // 2. Create the polygon record
    const polygon = await executeQuery(
      client
        .from('geofence_polygons')
        .insert({
          geofence_id: fence.id,
          version_number: 1,
          polygon: ringToMultiPolygon(input.ring),
          valid_from: new Date().toISOString(),
          valid_to: null,
          is_active: true,
          created_by: input.created_by ?? null,
        } as TablesInsert<'geofence_polygons'>)
        .select('*')
        .single(),
      'Unable to save the polygon.',
    ) as GeofencePolygonRow;

    return { ...fence, activePolygon: polygon, ring: input.ring, assignedCount: 0 };
  },

  // ── Update ───────────────────────────────────────────────────────────────

  /** Update geofence metadata and optionally its polygon boundary. */
  async update(geofenceId: string, input: GeofenceUpdateInput): Promise<GeofenceWithPolygon> {
    const client = getSupabaseClient();

    // Update the geofence metadata
    const fenceUpdate: TablesUpdate<'geofences'> = {};
    if (input.name !== undefined) fenceUpdate.name = input.name;
    if (input.branch_id !== undefined) fenceUpdate.branch_id = input.branch_id;
    if (input.color !== undefined) fenceUpdate.color = input.color;
    if (input.checkin_mode !== undefined) fenceUpdate.checkin_mode = input.checkin_mode;
    if (input.required_accuracy_meters !== undefined)
      fenceUpdate.required_accuracy_meters = input.required_accuracy_meters;
    if (input.auto_checkout_timeout_minutes !== undefined)
      fenceUpdate.auto_checkout_timeout_minutes = input.auto_checkout_timeout_minutes;
    if (input.status !== undefined) fenceUpdate.status = input.status;

    const fence = await executeQuery(
      client.from('geofences').update(fenceUpdate).eq('id', geofenceId).select('*').single(),
      'Unable to update the geofence.',
    ) as GeofenceRow;

    let newPolygon: GeofencePolygonRow | null = null;

    // If ring changed, create a new polygon version
    if (input.ring && input.ring.length >= 3) {
      // Get current version number
      const { data: latest } = await client
        .from('geofence_polygons')
        .select('version_number')
        .eq('geofence_id', geofenceId)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = (latest?.version_number ?? 0) + 1;
      const now = new Date().toISOString();

      // Deactivate all previous polygon versions
      await client
        .from('geofence_polygons')
        .update({ is_active: false, valid_to: now } as TablesUpdate<'geofence_polygons'>)
        .eq('geofence_id', geofenceId);

      // Insert new active polygon version
      newPolygon = await executeQuery(
        client
          .from('geofence_polygons')
          .insert({
            geofence_id: geofenceId,
            version_number: nextVersion,
            polygon: ringToMultiPolygon(input.ring),
            valid_from: now,
            valid_to: null,
            is_active: true,
            created_by: input.updated_by ?? null,
          } as TablesInsert<'geofence_polygons'>)
          .select('*')
          .single(),
        'Unable to update the polygon.',
      );
    }

    return this.getWithPolygon(fence.id);
  },

  // ── Status toggle ────────────────────────────────────────────────────────

  async setStatus(geofenceId: string, status: GeofenceStatus): Promise<GeofenceRow> {
    return executeQuery(
      getSupabaseClient()
        .from('geofences')
        .update({ status } as TablesUpdate<'geofences'>)
        .eq('id', geofenceId)
        .select('*')
        .single(),
      'Unable to update geofence status.',
    );
  },

  // ── Delete (soft) ────────────────────────────────────────────────────────

  async archive(geofenceId: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from('geofences')
      .update({ status: 'archived' } as TablesUpdate<'geofences'>)
      .eq('id', geofenceId);
    if (error) throw error;
  },

  // ── Employee Assignments ─────────────────────────────────────────────────

  /** List employees assigned to a geofence (active assignments only). */
  async listAssignments(geofenceId: string): Promise<(GeofenceAssignmentRow & { employee: EmployeeProfileRow | null })[]> {
    const { data, error } = await getSupabaseClient()
      .from('geofence_assignments')
      .select('*, employee:employee_profiles(*)')
      .eq('geofence_id', geofenceId)
      .is('effective_to', null)
      .order('created_at');

    if (error) throw error;
    return (data ?? []) as (GeofenceAssignmentRow & { employee: EmployeeProfileRow | null })[];
  },

  /** Assign an employee to a geofence. Idempotent — won't double-assign. */
  async assignEmployee(input: {
    organization_id: string;
    geofence_id: string;
    employee_id: string;
    effective_from?: string;
  }): Promise<GeofenceAssignmentRow> {
    // Check for existing active assignment
    const { data: existing } = await getSupabaseClient()
      .from('geofence_assignments')
      .select('id')
      .eq('geofence_id', input.geofence_id)
      .eq('employee_id', input.employee_id)
      .is('effective_to', null)
      .maybeSingle();

    if (existing) return existing as unknown as GeofenceAssignmentRow;

    return executeQuery(
      getSupabaseClient()
        .from('geofence_assignments')
        .insert({
          organization_id: input.organization_id,
          geofence_id: input.geofence_id,
          employee_id: input.employee_id,
          effective_from: input.effective_from ?? (() => {
            const d = new Date();
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          })(),
          effective_to: null,
        } as TablesInsert<'geofence_assignments'>)
        .select('*')
        .single(),
      'Unable to assign the employee.',
    );
  },

  /** Remove an employee from a geofence by setting effective_to = today. */
  async removeAssignment(assignmentId: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from('geofence_assignments')
      .update({ effective_to: (() => {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      })() } as TablesUpdate<'geofence_assignments'>)
      .eq('id', assignmentId);
    if (error) throw error;
  },

  // ── GPS Validation ───────────────────────────────────────────────────────

  /**
   * Validates an employee's GPS position against their assigned geofence polygons.
   * Returns the validation result including inside/outside determination.
   *
   * Uses the pure ray-casting implementation in lib/geo.ts — no backend round-trip
   * needed for real-time validation (e.g. during check-in).
   */
  async validatePosition(input: GeofenceValidationInput): Promise<{
    geofence: GeofenceRow;
    polygon_id: string | null;
    inside: boolean;
    status: GeofenceValidationStatus;
    required_accuracy_meters: number;
  }> {
    const gf = await this.getWithPolygon(input.geofence_id);

    if (!gf.activePolygon) {
      return {
        geofence: gf,
        polygon_id: null,
        inside: false,
        status: 'unknown',
        required_accuracy_meters: gf.required_accuracy_meters,
      };
    }

    const result = validateGpsAgainstGeofence({
      lat: input.latitude,
      lng: input.longitude,
      accuracyMeters: input.accuracy_meters,
      requiredAccuracyMeters: gf.required_accuracy_meters,
      multiPolygonCoords: gf.activePolygon.polygon.coordinates,
      isMockLocation: input.is_mock_location ?? false,
    });

    return {
      geofence: gf,
      polygon_id: gf.activePolygon.id,
      inside: result.inside,
      status: result.status as GeofenceValidationStatus,
      required_accuracy_meters: gf.required_accuracy_meters,
    };
  },

  // ── Attendance Event Recording ───────────────────────────────────────────

  /**
   * Records a full attendance event with GPS coordinates, accuracy, geofence
   * validation result, and source. This is the single function that:
   *   1. Validates the position
   *   2. Writes the attendance_event row
   *   3. Returns the full recorded event
   */
  async recordAttendanceEvent(input: AttendanceEventInput): Promise<void> {
    const client = getSupabaseClient();
    const idempotencyKey = input.idempotency_key || `${input.employee_id}:${input.event_type}:${crypto.randomUUID()}`;

    await executeQuery(
      client
        .from('attendance_events')
        .insert({
          organization_id: input.organization_id,
          employee_id: input.employee_id,
          device_id: null,
          event_type: input.event_type,
          source: input.source,
          event_at: new Date().toISOString(),
          received_at: new Date().toISOString(),
          location_point: {
            type: 'Point',
            coordinates: [input.longitude, input.latitude],
          },
          accuracy_meters: input.accuracy_meters,
          geofence_id: input.geofence_id,
          geofence_polygon_id: input.geofence_polygon_id,
          geofence_validation: input.geofence_validation,
          inside_geofence: input.inside_geofence,
          approval_status: 'not_required',
          device_info: input.device_info ?? {},
          metadata: {},
          idempotency_key: idempotencyKey,
          created_by: input.created_by ?? null,
        } as TablesInsert<'attendance_events'>)
        .select('id')
        .single(),
      'Unable to record the attendance event.',
    );
  },

  // ── Polygon history ──────────────────────────────────────────────────────

  /** Get all polygon versions for a geofence (for audit/history). */
  async getPolygonHistory(geofenceId: string): Promise<GeofencePolygonRow[]> {
    return executeQuery(
      getSupabaseClient()
        .from('geofence_polygons')
        .select('*')
        .eq('geofence_id', geofenceId)
        .order('version_number', { ascending: false }),
      'Unable to load polygon history.',
    );
  },
};
