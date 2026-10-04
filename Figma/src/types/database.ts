export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AppRole = 'employee' | 'manager' | 'administrator';
export type OrgStatus = 'active' | 'suspended' | 'archived';
export type MembershipStatus = 'invited' | 'active' | 'suspended' | 'removed';
export type RecordStatus = 'active' | 'inactive' | 'archived';
export type EmploymentStatus = 'active' | 'inactive' | 'on_leave' | 'terminated';
export type ShiftAssignmentStatus = 'scheduled' | 'off' | 'leave' | 'cancelled';
export type AssignmentSource = 'manual' | 'recurring' | 'imported';
export type CheckinMode = 'automatic' | 'confirmation' | 'manual_only';
export type GeofenceStatus = 'draft' | 'active' | 'disabled' | 'archived';
export type AttendanceEventType =
  | 'gps_enter'
  | 'gps_exit'
  | 'automatic_check_in'
  | 'automatic_check_out'
  | 'manual_check_in'
  | 'manual_check_out'
  | 'correction_applied';
export type AttendanceSource =
  | 'automatic_geofence'
  | 'manual_employee'
  | 'manual_manager'
  | 'admin'
  | 'imported';
export type GeofenceValidationStatus =
  | 'valid'
  | 'invalid'
  | 'low_accuracy'
  | 'permission_denied'
  | 'mock_location'
  | 'unknown';
export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';
export type AttendanceStatus =
  | 'present'
  | 'late'
  | 'absent'
  | 'missing_check_in'
  | 'missing_check_out'
  | 'outside_geofence'
  | 'off_day'
  | 'on_leave'
  | 'invalid';
export type ManualRequestType = 'check_in' | 'check_out' | 'correction';
export type LeaveType = 'sick' | 'annual' | 'emergency' | 'personal' | 'hajj' | 'unpaid';
export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type NotificationSeverity = 'info' | 'warning' | 'error';
export type DevicePlatform = 'android' | 'ios' | 'web';
export type DeviceIntegrityStatus = 'unknown' | 'valid' | 'suspected' | 'blocked';

export interface GeoJsonPoint {
  type: 'Point';
  coordinates: [longitude: number, latitude: number];
}

export interface GeoJsonMultiPolygon {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type TableDefinition<
  Row,
  RequiredInsertKeys extends keyof Row = never,
  Relationships extends Relationship[] = [],
> = {
  Row: Row & Record<string, unknown>;
  Insert: (Omit<Partial<Row>, RequiredInsertKeys> & Pick<Row, RequiredInsertKeys>) & Record<string, unknown>;
  Update: Partial<Row> & Record<string, unknown>;
  Relationships: Relationships;
};

export interface UserRow {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  avatar_path: string | null;
  locale: string;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: OrgStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoleRow {
  code: AppRole;
  name: string;
  description: string | null;
}

export interface OrganizationMembershipRow {
  id: string;
  organization_id: string;
  user_id: string;
  role_code: AppRole;
  status: MembershipStatus;
  created_at: string;
  updated_at: string;
}

export interface ManagerScopeRow {
  id: string;
  organization_id: string;
  manager_user_id: string;
  branch_id: string | null;
  department_id: string | null;
  employee_id: string | null;
  created_at: string;
}

export interface BranchRow {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  timezone: string;
  address: string | null;
  location_point: GeoJsonPoint | null;
  latitude: number | null;
  longitude: number | null;
  status: RecordStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DepartmentRow {
  id: string;
  organization_id: string;
  branch_id: string;
  code: string;
  name: string;
  status: RecordStatus;
  created_at: string;
  updated_at: string;
}

export interface EmployeeProfileRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  employee_code: string;
  iqama_number: string;
  full_name: string;
  mobile_number: string | null;
  branch_id: string;
  department_id: string;
  job_title: string | null;
  manager_user_id: string | null;
  joining_date: string | null;
  employment_status: EmploymentStatus;
  created_at: string;
  updated_at: string;
}

export interface EmployeeDeviceRow {
  id: string;
  organization_id: string;
  employee_id: string;
  device_identifier_hash: string;
  platform: DevicePlatform;
  model: string | null;
  os_version: string | null;
  app_version: string | null;
  integrity_status: DeviceIntegrityStatus;
  registered_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShiftRow {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
  break_minutes: number;
  color: string | null;
  status: RecordStatus;
  template_key: string;
  version_number: number;
  effective_from: string;
  effective_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecurringScheduleRow {
  id: string;
  organization_id: string;
  employee_id: string;
  effective_from: string;
  effective_to: string | null;
  status: RecordStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecurringScheduleRuleRow {
  id: string;
  organization_id: string;
  schedule_id: string;
  weekday: number;
  shift_id: string | null;
  is_off: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResolvedScheduleRow {
  work_date: string;
  state: 'working' | 'off' | 'leave' | 'cancelled' | 'holiday' | 'unassigned';
  source: 'leave' | 'dated_override' | 'holiday' | 'recurring' | 'legacy_weekly_off' | 'unassigned';
  shift_assignment_id: string | null;
  recurring_schedule_id: string | null;
  shift_id: string | null;
  shift_name: string | null;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number | null;
  crosses_midnight: boolean;
  reason: string | null;
}

export interface ShiftAssignmentRow {
  id: string;
  organization_id: string;
  employee_id: string;
  shift_id: string | null;
  work_date: string;
  status: ShiftAssignmentStatus;
  source: AssignmentSource;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeeklyOffRow {
  id: string;
  organization_id: string;
  employee_id: string;
  weekday: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface HolidayRow {
  id: string;
  organization_id: string;
  branch_id: string | null;
  holiday_date: string;
  name: string;
  is_working_day: boolean;
  created_by: string | null;
  created_at: string;
}

export interface GeofenceRow {
  id: string;
  organization_id: string;
  branch_id: string;
  name: string;
  color: string | null;
  status: GeofenceStatus;
  checkin_mode: CheckinMode;
  required_accuracy_meters: number;
  auto_checkout_timeout_minutes: number;
  latitude: number | null;
  longitude: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeofencePolygonRow {
  id: string;
  geofence_id: string;
  version_number: number;
  polygon: GeoJsonMultiPolygon;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface GeofenceAssignmentRow {
  id: string;
  organization_id: string;
  geofence_id: string;
  employee_id: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
}

export interface AttendanceEventRow {
  id: string;
  organization_id: string;
  employee_id: string;
  device_id: string | null;
  event_type: AttendanceEventType;
  source: AttendanceSource;
  event_at: string;
  received_at: string;
  location_point: GeoJsonPoint | null;
  accuracy_meters: number | null;
  geofence_id: string | null;
  geofence_polygon_id: string | null;
  geofence_validation: GeofenceValidationStatus;
  inside_geofence: boolean | null;
  approval_status: ApprovalStatus;
  device_info: Json;
  metadata: Json;
  idempotency_key: string;
  created_by: string | null;
  created_at: string;
}

export interface AttendanceRecordRow {
  id: string;
  organization_id: string;
  employee_id: string;
  shift_assignment_id: string | null;
  attendance_date: string;
  session_number: number;
  check_in_event_id: string | null;
  check_out_event_id: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  source: AttendanceSource;
  status: AttendanceStatus;
  late_minutes: number;
  early_leaving_minutes: number;
  worked_minutes: number;
  missing_minutes: number;
  overtime_minutes: number;
  geofence_validated: boolean;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ManualAttendanceRequestRow {
  id: string;
  organization_id: string;
  employee_id: string;
  attendance_record_id: string | null;
  request_type: ManualRequestType;
  requested_at: string;
  location_point: GeoJsonPoint | null;
  reason: string;
  supporting_file_path: string | null;
  status: ApprovalStatus;
  requested_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface OvertimeRecordRow {
  id: string;
  organization_id: string;
  employee_id: string;
  attendance_record_id: string;
  requested_minutes: number;
  approved_minutes: number | null;
  status: ApprovalStatus;
  reason: string | null;
  requested_by: string;
  approved_by: string | null;
  requested_at: string;
  approved_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductivityRecordRow {
  id: string;
  organization_id: string;
  employee_id: string;
  shift_assignment_id: string | null;
  work_date: string;
  metric_code: string; // Used for task/category
  target_units: number;
  actual_units: number;
  productive_hours: number | null;
  productivity_percent: number | null;
  manager_notes: string | null;
  source: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface PhoneUsageRecordRow {
  id: string;
  organization_id: string;
  employee_id: string;
  device_id: string | null;
  shift_assignment_id: string | null;
  work_date: string;
  active_minutes: number;
  within_shift_minutes: number;
  total_shift_minutes: number | null;
  usage_percentage: number | null;
  synced_at: string | null;
  policy_limit_minutes: number | null;
  source: string | null;
  consent_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: string;
  organization_id: string;
  recipient_user_id: string;
  notification_type: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface LeaveRequestRow {
  id: string;
  organization_id: string;
  employee_id: string;
  leave_type: LeaveType;
  from_date: string;
  to_date: string;
  days: number;
  reason: string;
  supporting_file_path: string | null;
  status: LeaveRequestStatus;
  requested_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRow {
  id: string;
  organization_id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: Json | null;
  after_data: Json | null;
  metadata: Json;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      users: TableDefinition<UserRow, 'id' | 'display_name'>;
      organizations: TableDefinition<OrganizationRow, 'name' | 'slug'>;
      roles: TableDefinition<RoleRow, 'code' | 'name'>;
      organization_memberships: TableDefinition<OrganizationMembershipRow, 'organization_id' | 'user_id' | 'role_code'>;
      manager_scopes: TableDefinition<ManagerScopeRow, 'organization_id' | 'manager_user_id'>;
      branches: TableDefinition<BranchRow, 'organization_id' | 'code' | 'name' | 'timezone'>;
      departments: TableDefinition<DepartmentRow, 'organization_id' | 'branch_id' | 'code' | 'name'>;
      employee_profiles: TableDefinition<EmployeeProfileRow, 'organization_id' | 'employee_code' | 'iqama_number' | 'full_name' | 'branch_id' | 'department_id'>;
      employee_devices: TableDefinition<EmployeeDeviceRow, 'organization_id' | 'employee_id' | 'device_identifier_hash' | 'platform'>;
      shifts: TableDefinition<ShiftRow, 'organization_id' | 'code' | 'name' | 'start_time' | 'end_time'>;
      shift_assignments: TableDefinition<
        ShiftAssignmentRow,
        'organization_id' | 'employee_id' | 'work_date',
        [
          {
            foreignKeyName: 'shift_assignments_shift_id_fkey';
            columns: ['shift_id'];
            isOneToOne: false;
            referencedRelation: 'shifts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shift_assignments_employee_id_fkey';
            columns: ['employee_id'];
            isOneToOne: false;
            referencedRelation: 'employee_profiles';
            referencedColumns: ['id'];
          },
        ]
      >;
      recurring_schedules: TableDefinition<RecurringScheduleRow, 'organization_id' | 'employee_id' | 'effective_from'>;
      recurring_schedule_rules: TableDefinition<RecurringScheduleRuleRow, 'organization_id' | 'schedule_id' | 'weekday' | 'is_off'>;
      weekly_offs: TableDefinition<WeeklyOffRow, 'organization_id' | 'employee_id' | 'weekday' | 'effective_from'>;
      holidays: TableDefinition<HolidayRow, 'organization_id' | 'holiday_date' | 'name'>;
      geofences: TableDefinition<GeofenceRow, 'organization_id' | 'branch_id' | 'name'>;
      geofence_polygons: TableDefinition<GeofencePolygonRow, 'geofence_id' | 'version_number' | 'polygon'>;
      geofence_assignments: TableDefinition<
        GeofenceAssignmentRow,
        'organization_id' | 'geofence_id' | 'employee_id' | 'effective_from',
        [
          {
            foreignKeyName: 'geofence_assignments_employee_id_fkey';
            columns: ['employee_id'];
            isOneToOne: false;
            referencedRelation: 'employee_profiles';
            referencedColumns: ['id'];
          },
        ]
      >;
      attendance_events: TableDefinition<AttendanceEventRow, 'organization_id' | 'employee_id' | 'event_type' | 'source' | 'event_at' | 'idempotency_key'>;
      attendance_records: TableDefinition<AttendanceRecordRow, 'organization_id' | 'employee_id' | 'attendance_date' | 'source' | 'status'>;
      manual_attendance_requests: TableDefinition<ManualAttendanceRequestRow, 'organization_id' | 'employee_id' | 'request_type' | 'requested_at' | 'reason' | 'requested_by'>;
      overtime_records: TableDefinition<OvertimeRecordRow, 'organization_id' | 'employee_id' | 'attendance_record_id' | 'requested_minutes' | 'requested_by'>;
      productivity_records: TableDefinition<ProductivityRecordRow, 'organization_id' | 'employee_id' | 'work_date' | 'metric_code'>;
      phone_usage_records: TableDefinition<PhoneUsageRecordRow, 'organization_id' | 'employee_id' | 'work_date'>;
      notifications: TableDefinition<NotificationRow, 'organization_id' | 'recipient_user_id' | 'notification_type' | 'title' | 'body'>;
      leave_requests: TableDefinition<LeaveRequestRow, 'organization_id' | 'employee_id' | 'leave_type' | 'from_date' | 'to_date' | 'days' | 'reason' | 'requested_by'>;
      audit_logs: TableDefinition<AuditLogRow, 'organization_id' | 'action' | 'entity_type'>;
    };
    Views: Record<string, never>;
    Functions: {
      request_employee_invitation: {
        Args: { p_employee_id: string };
        Returns: { id: string; organization_id: string; employee_id: string; invited_by: string; invited_at: string; accepted_at: string | null; revoked_at: string | null };
      };
      resolve_employee_schedule: {
        Args: { p_employee_id: string; p_start_date: string; p_end_date: string };
        Returns: ResolvedScheduleRow[];
      };
      set_recurring_schedule: {
        Args: { p_employee_id: string; p_effective_from: string; p_effective_to: string | null; p_rules: Json };
        Returns: RecurringScheduleRow;
      };
      save_shift_template: {
        Args: {
          p_shift_id: string | null;
          p_organization_id: string;
          p_code: string;
          p_name: string;
          p_start_time: string;
          p_end_time: string;
          p_break_minutes: number;
          p_color: string | null;
          p_effective_from: string;
        };
        Returns: ShiftRow;
      };
      create_site: {
        Args: {
          p_organization_id: string;
          p_name: string;
          p_code: string;
          p_timezone: string;
          p_address: string;
          p_latitude: number | null;
          p_longitude: number | null;
          p_create_geofence: boolean;
          p_geofence_radius_meters: number;
        };
        Returns: BranchRow;
      };
      process_attendance_event: {
        Args: {
          p_employee_id: string;
          p_geofence_id: string | null;
          p_action_type: 'check_in' | 'check_out';
          p_is_auto: boolean;
          p_latitude: number;
          p_longitude: number;
          p_accuracy_meters: number;
          p_is_mock_location: boolean;
          p_idempotency_key: string;
          p_device_info: Json;
        };
        Returns: Array<{
          attendance_record_id: string | null;
          event_id: string;
          status: string;
          inside_geofence: boolean;
          validation_status: GeofenceValidationStatus;
        }>;
      };
      review_manual_attendance_request: {
        Args: {
          p_request_id: string;
          p_status: 'approved' | 'rejected';
          p_review_note: string | null;
        };
        Returns: ManualAttendanceRequestRow[];
      };
      review_overtime_record: {
        Args: {
          p_overtime_id: string;
          p_status: 'approved' | 'rejected';
          p_approved_minutes: number | null;
          p_review_note: string | null;
        };
        Returns: OvertimeRecordRow[];
      };
      mark_notification_read: {
        Args: { p_notification_id: string };
        Returns: NotificationRow[];
      };
    };
    Enums: {
      app_role: AppRole;
      org_status: OrgStatus;
      membership_status: MembershipStatus;
      record_status: RecordStatus;
      employment_status: EmploymentStatus;
      shift_assignment_status: ShiftAssignmentStatus;
      assignment_source: AssignmentSource;
      checkin_mode: CheckinMode;
      geofence_status: GeofenceStatus;
      attendance_event_type: AttendanceEventType;
      attendance_source: AttendanceSource;
      geofence_validation_status: GeofenceValidationStatus;
      approval_status: ApprovalStatus;
      attendance_status: AttendanceStatus;
      manual_request_type: ManualRequestType;
      leave_type: LeaveType;
      leave_request_status: LeaveRequestStatus;
      notification_severity: NotificationSeverity;
      device_platform: DevicePlatform;
      device_integrity_status: DeviceIntegrityStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
