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
export type MailroomProcessingMode = 'immediate' | 'validation_gated';
export type MailroomVolumeDriver = 'received' | 'validated' | 'processed';
export type MailroomActivityVolumeSource = 'client_mapping' | 'dsp_allocated' | 'returns_received';
export type MailroomLaborClass = 'dlp' | 'non_dlp';
export type MailroomEmploymentSource = 'own' | '3pl';
export type MailroomDailyEntryStatus = 'draft' | 'finalized';
export type PayrollRunStatus = 'draft' | 'under_review' | 'finalized';
export type PayrollReviewStatus = 'pending' | 'reviewed';
export type PayrollComponentKind = 'allowance' | 'deduction';
export type PayrollLineCategory =
  | 'base_salary'
  | 'allowance'
  | 'overtime'
  | 'absence_deduction'
  | 'unpaid_leave_deduction'
  | 'recurring_deduction'
  | 'manual_allowance'
  | 'manual_deduction';
export type PayrollExceptionType = 'late' | 'early_departure' | 'incomplete_attendance';
export type PayrollExceptionStatus = 'open' | 'corrected' | 'waived';

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
  auto_checkout_grace_minutes: number;
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
  manager_user_id?: string | null;
  status: RecordStatus;
  created_at: string;
  updated_at: string;
}

export interface ManagerProfileRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  manager_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: MembershipStatus;
  must_change_password: boolean;
  login_last_reset_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ManagerActivityLogRow {
  id: string;
  organization_id: string;
  manager_profile_id: string;
  actor_user_id: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface OrganizationManagerItem {
  id: string;
  organization_id: string;
  user_id: string | null;
  manager_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: MembershipStatus;
  must_change_password: boolean;
  login_last_reset_at: string | null;
  created_at: string;
  updated_at: string;
  assigned_department_ids: string[];
  assigned_department_names: string[];
  primary_department_id: string | null;
  primary_department_name: string | null;
}

export interface ManagerActivityHistoryItem {
  id: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
  actor_name: string;
  actor_email: string | null;
}

export type TransferStatus = 'active' | 'completed' | 'cancelled';
export type TransferType = 'temporary' | 'permanent' | 'shift' | 'overtime';

export interface EmployeeTransferRow {
  id: string;
  organization_id: string;
  employee_id: string;
  from_department_id: string;
  to_department_id: string;
  transfer_date: string;
  start_time: string;
  end_time: string | null;
  status: TransferStatus;
  transfer_type: TransferType;
  transferred_minutes: number;
  break_minutes: number;
  overtime_minutes: number;
  reason: string | null;
  notes: string | null;
  transferred_by: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeTransferItem extends EmployeeTransferRow {
  employee?: {
    id: string;
    employee_code: string;
    full_name: string;
    job_title?: string | null;
  };
  from_department?: {
    id: string;
    name: string;
    code: string;
  };
  to_department?: {
    id: string;
    name: string;
    code: string;
  };
  transferred_by_user?: {
    id: string;
    email: string;
    display_name?: string;
  };
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
  status_effective_date?: string | null;
  must_change_password: boolean;
  login_last_reset_at: string | null;
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

export type FcWeekStatus = 'draft' | 'finalized';

export interface FcProductivityWeekRow {
  id: string; organization_id: string; branch_id: string; department_id: string; week_start: string;
  status: FcWeekStatus; revision: number; source_file_name: string; source_sha256: string;
  source_rows: number; valid_rows: number; ignored_rows: number; duplicate_rows: number; blank_packer_rows: number;
  seller_supplements_reviewed: boolean; capacity_reviewed: boolean; adhoc_reviewed: boolean;
  imported_by: string | null; imported_at: string; finalized_by: string | null; finalized_at: string | null;
  created_at: string; updated_at: string;
}

export interface FcDailyPackerMetricRow {
  id: string; organization_id: string; branch_id: string; department_id: string; week_id: string;
  work_date: string; packer_label: string; normalized_packer_label: string;
  packed_orders: number; packed_quantity: number; created_at: string;
}

export interface FcDailySellerMetricRow {
  id: string; organization_id: string; branch_id: string; department_id: string; week_id: string;
  work_date: string; seller_name: string; order_type: 'B2B' | 'B2C' | 'Other';
  packed_orders: number; packed_quantity: number;
  a2p_minutes: number; a2p_samples: number; p2p_minutes: number; p2p_samples: number;
  o2p_minutes: number; o2p_samples: number; p2s_minutes: number; p2s_samples: number;
  o2s_minutes: number; o2s_samples: number; created_at: string;
}

export interface FcPackerMappingRow {
  id: string; organization_id: string; branch_id: string; department_id: string;
  packer_label: string; normalized_packer_label: string; employee_id: string;
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
}

export interface FcWeeklySellerSupplementRow {
  id: string; organization_id: string; branch_id: string; department_id: string; week_id: string;
  seller_name: string; purchase_order_units: number; return_order_units: number; return_orders: number;
}

export interface FcWeeklyCapacityMetricRow {
  week_id: string; organization_id: string; branch_id: string; department_id: string;
  capacity_bins: number; utilized_bins: number; capacity_pallets: number; utilized_pallets: number;
  capacity_units: number; utilized_units: number; capacity_cbm: number; utilized_cbm: number;
}

export interface FcWeeklyAdhocTaskRow {
  id: string; organization_id: string; branch_id: string; department_id: string; week_id: string;
  seller_name: string; task_name: string; usage: number; created_at: string;
}

export type FcActivityVolumeDriver = 'inbound' | 'return_rto' | 'return_cir' | 'returns_total' | 'outbound_b2c' | 'outbound_b2b' | 'vas' | 'gift_wrap' | 'other';

export interface FcActivityStandardRow {
  id: string; organization_id: string; branch_id: string; department_id: string;
  activity_code: string; activity_name: string; volume_driver: FcActivityVolumeDriver;
  target_uom: 'hour' | 'day'; units_per_worker: number; sort_order: number; is_active: boolean;
  created_at: string; updated_at: string;
}

export interface FcDailyManpowerProductivityRow {
  id: string; organization_id: string; branch_id: string; department_id: string; work_date: string;
  status?: 'draft' | 'finalized';
  available_hours: number; inbound_quantity: number; return_rto_quantity: number; return_cir_quantity: number;
  outbound_b2c_quantity: number; outbound_b2b_quantity: number; vas_quantity: number; gift_wrap_quantity: number;
  other_activity_name: string | null; other_activity_quantity: number; b2c_orders: number; b2b_orders: number;
  closing_storage_quantity: number; actual_own_dlp: number; actual_contract_dlp: number; cycle_count_staff: number;
  supervisor_staff: number; assistant_manager_staff: number; manager_staff: number; security_staff: number;
  security_supervisor_staff: number; housekeeping_staff: number; other_staff: number; notes: string | null;
  source_file_name: string | null; entered_by: string | null; created_at: string; updated_at: string;
}

export interface FcSettingsRow {
  id: string;
  organization_id: string;
  branch_id: string;
  department_id: string;
  standard_hours_per_day: number;
  planned_absence_percent: number;
  max_overtime_hours_per_day: number;
  overtime_hourly_cost_own: number;
  overtime_hourly_cost_3pl: number;
  created_at: string;
  updated_at: string;
}

export interface FcEmployeeSettingsRow {
  id: string;
  organization_id: string;
  branch_id: string;
  department_id: string;
  employee_id: string;
  labor_class: 'dlp' | 'non_dlp';
  employment_source: 'own' | '3pl';
  overtime_eligible: boolean;
  overtime_hourly_cost: number | null;
  created_at: string;
  updated_at: string;
}

export interface FcClientRow {
  id: string;
  organization_id: string;
  branch_id: string;
  department_id: string;
  code: string;
  name: string;
  status: RecordStatus;
  inbound_rate_override: number | null;
  outbound_b2c_rate_override: number | null;
  outbound_b2b_rate_override: number | null;
  returns_rate_override: number | null;
  vas_rate_override: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FcDailyClientVolumeRow {
  id: string;
  organization_id: string;
  branch_id: string;
  department_id: string;
  work_date: string;
  client_name: string;
  inbound_quantity: number;
  outbound_b2c_quantity: number;
  outbound_b2b_quantity: number;
  returns_quantity: number;
  vas_quantity: number;
  b2c_orders: number;
  b2b_orders: number;
  created_at: string;
  updated_at: string;
}

export interface MailroomProductivitySettingsRow {
  id: string;
  organization_id: string;
  branch_id: string;
  standard_hours_per_day: number;
  planned_absence_percent: number;
  max_overtime_hours_per_day: number;
  week_starts_on: number;
  opening_return_backlog: number;
  overtime_hourly_cost: number;
  overtime_hourly_cost_own: number;
  overtime_hourly_cost_3pl: number;
  created_at: string;
  updated_at: string;
}

export interface MailroomDailyTurnaroundMetricRow {
  organization_id: string;
  branch_id: string;
  client_id: string;
  work_date: string;
  warehouse_code: string;
  shift_type?: 'day' | 'night' | 'unassigned' | 'all';
  total_minutes: number;
  shipment_count: number;
  updated_at: string;
}

export interface MailroomClientRow {
  id: string;
  organization_id: string;
  branch_id: string;
  code: string;
  name: string;
  processing_mode: MailroomProcessingMode;
  opening_awaiting_validation: number;
  opening_ready_to_process: number;
  opening_unprocessed_units: number;
  status: RecordStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MailroomActivityRow {
  id: string;
  organization_id: string;
  branch_id: string;
  code: string;
  name: string;
  units_per_labor_hour: number;
  volume_source: MailroomActivityVolumeSource;
  status: RecordStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MailroomClientActivityRow {
  id: string;
  organization_id: string;
  branch_id: string;
  client_id: string;
  activity_id: string;
  volume_driver: MailroomVolumeDriver;
  workload_multiplier: number;
  created_at: string;
  updated_at: string;
}

export interface MailroomDailyShipmentRow {
  id: string;
  organization_id: string;
  branch_id: string;
  client_id: string;
  work_date: string;
  received_units: number;
  validated_units: number;
  processed_units: number;
  backlog_released_units: number;
  batch_closed_units: number;
  returns_received: number;
  returns_processed: number;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MailroomEmployeeSettingsRow {
  id: string;
  organization_id: string;
  branch_id: string;
  employee_id: string;
  labor_class: MailroomLaborClass;
  employment_source: MailroomEmploymentSource;
  overtime_eligible: boolean;
  max_overtime_hours_override: number | null;
  overtime_hourly_cost: number | null;
  created_at: string;
  updated_at: string;
}

export interface MailroomDspPartnerRow {
  id: string;
  organization_id: string;
  branch_id: string;
  code: string;
  name: string;
  status: RecordStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MailroomDailyEntryRow {
  id: string;
  organization_id: string;
  branch_id: string;
  work_date: string;
  status: MailroomDailyEntryStatus;
  returns_received: number;
  returns_processed: number;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  finalized_by: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MailroomDailyDspAllocationRow {
  id: string;
  organization_id: string;
  branch_id: string;
  daily_entry_id: string;
  client_id: string;
  partner_id: string;
  allocated_units: number;
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
  data_status: 'available' | 'partial' | 'permission_not_granted' | 'no_data';
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

export interface PayrollSettingsRow {
  organization_id: string;
  currency_code: string;
  month_basis_days: number;
  daily_hours: number;
  overtime_multiplier: number;
  updated_by?: string | null;
  created_at?: string;
  updated_at: string | null;
}

export interface EmployeeCompensationRow {
  id: string;
  organization_id: string;
  employee_id: string;
  monthly_base_salary: number;
  currency_code: string;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeePayrollComponentRow {
  id: string;
  organization_id: string;
  employee_id: string;
  component_kind: PayrollComponentKind;
  code: string;
  name: string;
  amount: number;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollRunRow {
  id: string;
  organization_id: string;
  payroll_month: string;
  status: PayrollRunStatus;
  currency_code: string;
  month_basis_days: number;
  daily_hours: number;
  overtime_multiplier: number;
  organization_timezone: string;
  employee_count: number;
  total_gross_pay: number;
  total_deductions: number;
  total_net_pay: number;
  generated_at: string | null;
  generated_by: string | null;
  finalized_at: string | null;
  finalized_by: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopen_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollEntryRow {
  id: string;
  payroll_run_id: string;
  organization_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  branch_id: string | null;
  branch_name: string;
  department_id: string | null;
  department_name: string;
  job_title: string | null;
  active_days: number;
  payable_days: number;
  scheduled_working_days: number;
  worked_days: number;
  absent_days: number;
  unpaid_leave_days: number;
  approved_overtime_minutes: number;
  pending_overtime_minutes: number;
  pending_overtime_count: number;
  unresolved_exception_count: number;
  base_pay: number;
  allowances_pay: number;
  overtime_pay: number;
  manual_additions: number;
  absence_deduction: number;
  unpaid_leave_deduction: number;
  recurring_deductions: number;
  manual_deductions: number;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  currency_code: string;
  review_status: PayrollReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  source_fingerprint: string;
  created_at: string;
  updated_at: string;
}

export interface PayrollLineItemRow {
  id: string;
  payroll_run_id: string;
  payroll_entry_id: string;
  organization_id: string;
  employee_id: string;
  category: PayrollLineCategory;
  direction: 'earning' | 'deduction';
  code: string;
  label: string;
  is_manual: boolean;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  amount: number;
  metadata: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollExceptionRow {
  id: string;
  payroll_run_id: string;
  payroll_entry_id: string;
  organization_id: string;
  employee_id: string;
  work_date: string;
  exception_type: PayrollExceptionType;
  minutes: number;
  attendance_record_id: string | null;
  status: PayrollExceptionStatus;
  waive_reason: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  details: Json;
  created_at: string;
  updated_at: string;
}

export interface PayrollEntryDetail {
  entry: PayrollEntryRow;
  line_items: PayrollLineItemRow[];
  exceptions: PayrollExceptionRow[];
}

export interface PayrollExportCsvRow {
  employee_code: string;
  employee_name: string;
  branch_name: string;
  department_name: string;
  job_title: string | null;
  base_pay: number;
  allowances_pay: number;
  overtime_hours: number;
  overtime_pay: number;
  absence_deduction: number;
  unpaid_leave_deduction: number;
  other_adjustments: number;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  currency_code: string;
  review_status: PayrollReviewStatus;
}

export interface Database {
  public: {
    Tables: {
      users: TableDefinition<UserRow, 'id' | 'display_name'>;
      organizations: TableDefinition<OrganizationRow, 'name' | 'slug'>;
      roles: TableDefinition<RoleRow, 'code' | 'name'>;
      payroll_settings: TableDefinition<PayrollSettingsRow, 'organization_id'>;
      employee_compensations: TableDefinition<EmployeeCompensationRow, 'organization_id' | 'employee_id' | 'monthly_base_salary' | 'effective_from'>;
      employee_payroll_components: TableDefinition<EmployeePayrollComponentRow, 'organization_id' | 'employee_id' | 'component_kind' | 'code' | 'name' | 'amount' | 'effective_from'>;
      payroll_runs: TableDefinition<PayrollRunRow, 'organization_id' | 'payroll_month'>;
      payroll_entries: TableDefinition<PayrollEntryRow, 'payroll_run_id' | 'organization_id' | 'employee_id' | 'employee_code' | 'employee_name' | 'branch_name' | 'department_name'>;
      payroll_line_items: TableDefinition<PayrollLineItemRow, 'payroll_run_id' | 'payroll_entry_id' | 'organization_id' | 'employee_id' | 'category' | 'direction' | 'code' | 'label' | 'amount'>;
      payroll_exceptions: TableDefinition<PayrollExceptionRow, 'payroll_run_id' | 'payroll_entry_id' | 'organization_id' | 'employee_id' | 'work_date' | 'exception_type'>;
      organization_memberships: TableDefinition<OrganizationMembershipRow, 'organization_id' | 'user_id' | 'role_code'>;
      manager_scopes: TableDefinition<ManagerScopeRow, 'organization_id' | 'manager_user_id'>;
      manager_profiles: TableDefinition<ManagerProfileRow, 'organization_id' | 'manager_code' | 'full_name'>;
      manager_activity_logs: TableDefinition<ManagerActivityLogRow, 'organization_id' | 'manager_profile_id' | 'actor_user_id' | 'action'>;
      branches: TableDefinition<BranchRow, 'organization_id' | 'code' | 'name' | 'timezone'>;
      departments: TableDefinition<DepartmentRow, 'organization_id' | 'branch_id' | 'code' | 'name'>;
      employee_profiles: TableDefinition<EmployeeProfileRow, 'organization_id' | 'employee_code' | 'iqama_number' | 'full_name' | 'branch_id' | 'department_id'>;
      employee_transfers: TableDefinition<
        EmployeeTransferRow,
        'organization_id' | 'employee_id' | 'from_department_id' | 'to_department_id',
        [
          {
            foreignKeyName: 'employee_transfers_employee_id_fkey';
            columns: ['employee_id'];
            isOneToOne: false;
            referencedRelation: 'employee_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'employee_transfers_from_department_id_fkey';
            columns: ['from_department_id'];
            isOneToOne: false;
            referencedRelation: 'departments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'employee_transfers_to_department_id_fkey';
            columns: ['to_department_id'];
            isOneToOne: false;
            referencedRelation: 'departments';
            referencedColumns: ['id'];
          },
        ]
      >;
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
      fc_productivity_weeks: TableDefinition<FcProductivityWeekRow, 'organization_id' | 'branch_id' | 'department_id' | 'week_start' | 'source_file_name' | 'source_sha256' | 'valid_rows'>;
      fc_daily_packer_metrics: TableDefinition<FcDailyPackerMetricRow, 'organization_id' | 'branch_id' | 'department_id' | 'week_id' | 'work_date' | 'packer_label' | 'normalized_packer_label' | 'packed_orders' | 'packed_quantity'>;
      fc_daily_seller_metrics: TableDefinition<FcDailySellerMetricRow, 'organization_id' | 'branch_id' | 'department_id' | 'week_id' | 'work_date' | 'seller_name' | 'order_type' | 'packed_orders' | 'packed_quantity'>;
      fc_packer_mappings: TableDefinition<FcPackerMappingRow, 'organization_id' | 'branch_id' | 'department_id' | 'packer_label' | 'normalized_packer_label' | 'employee_id'>;
      fc_weekly_seller_supplements: TableDefinition<FcWeeklySellerSupplementRow, 'organization_id' | 'branch_id' | 'department_id' | 'week_id' | 'seller_name'>;
      fc_weekly_capacity_metrics: TableDefinition<FcWeeklyCapacityMetricRow, 'organization_id' | 'branch_id' | 'department_id' | 'week_id'>;
      fc_weekly_adhoc_tasks: TableDefinition<FcWeeklyAdhocTaskRow, 'organization_id' | 'branch_id' | 'department_id' | 'week_id' | 'seller_name' | 'task_name' | 'usage'>;
      fc_activity_standards: TableDefinition<FcActivityStandardRow, 'organization_id' | 'branch_id' | 'department_id' | 'activity_code' | 'activity_name' | 'volume_driver' | 'target_uom' | 'units_per_worker'>;
      fc_daily_manpower_productivity: TableDefinition<FcDailyManpowerProductivityRow, 'organization_id' | 'branch_id' | 'department_id' | 'work_date'>;
      fc_settings: TableDefinition<FcSettingsRow, 'organization_id' | 'branch_id' | 'department_id'>;
      fc_employee_settings: TableDefinition<FcEmployeeSettingsRow, 'organization_id' | 'branch_id' | 'department_id' | 'employee_id'>;
      fc_clients: TableDefinition<FcClientRow, 'organization_id' | 'branch_id' | 'department_id' | 'code' | 'name'>;
      fc_daily_client_volumes: TableDefinition<FcDailyClientVolumeRow, 'organization_id' | 'branch_id' | 'department_id' | 'work_date' | 'client_name'>;
      mailroom_productivity_settings: TableDefinition<MailroomProductivitySettingsRow, 'organization_id' | 'branch_id'>;
      mailroom_clients: TableDefinition<MailroomClientRow, 'organization_id' | 'branch_id' | 'code' | 'name' | 'processing_mode'>;
      mailroom_activities: TableDefinition<MailroomActivityRow, 'organization_id' | 'branch_id' | 'code' | 'name' | 'units_per_labor_hour'>;
      mailroom_client_activities: TableDefinition<MailroomClientActivityRow, 'organization_id' | 'branch_id' | 'client_id' | 'activity_id' | 'volume_driver'>;
      mailroom_daily_shipments: TableDefinition<MailroomDailyShipmentRow, 'organization_id' | 'branch_id' | 'client_id' | 'work_date'>;
      mailroom_employee_settings: TableDefinition<MailroomEmployeeSettingsRow, 'organization_id' | 'branch_id' | 'employee_id'>;
      mailroom_dsp_partners: TableDefinition<MailroomDspPartnerRow, 'organization_id' | 'branch_id' | 'code' | 'name'>;
      mailroom_daily_entries: TableDefinition<MailroomDailyEntryRow, 'organization_id' | 'branch_id' | 'work_date'>;
      mailroom_daily_dsp_allocations: TableDefinition<MailroomDailyDspAllocationRow, 'organization_id' | 'branch_id' | 'daily_entry_id' | 'client_id' | 'partner_id'>;
      mailroom_daily_turnaround_metrics: TableDefinition<MailroomDailyTurnaroundMetricRow, 'organization_id' | 'branch_id' | 'client_id' | 'work_date' | 'warehouse_code' | 'total_minutes' | 'shipment_count'>;
      phone_usage_records: TableDefinition<PhoneUsageRecordRow, 'organization_id' | 'employee_id' | 'work_date'>;
      notifications: TableDefinition<NotificationRow, 'organization_id' | 'recipient_user_id' | 'notification_type' | 'title' | 'body'>;
      leave_requests: TableDefinition<LeaveRequestRow, 'organization_id' | 'employee_id' | 'leave_type' | 'from_date' | 'to_date' | 'days' | 'reason' | 'requested_by'>;
      audit_logs: TableDefinition<AuditLogRow, 'organization_id' | 'action' | 'entity_type'>;
    };
    Views: Record<string, never>;
    Functions: {
      request_employee_invitation: {
        Args: { p_employee_id: string; p_email: string };
        Returns: { id: string; organization_id: string; employee_id: string; invited_by: string; invited_at: string; requested_email: string | null; auth_user_id: string | null; status: string; accepted_at: string | null; revoked_at: string | null };
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
      list_overtime_review_employees: {
        Args: {
          p_organization_id: string;
          p_from_date: string;
          p_to_date: string;
          p_search?: string | null;
          p_branch_id?: string | null;
          p_department_id?: string | null;
          p_overtime_status?: string | null;
          p_attendance_issue?: string | null;
          p_device_status?: string | null;
          p_action_required?: boolean | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Array<{
          employee_id: string;
          employee_code: string;
          full_name: string;
          job_title: string | null;
          branch_id: string;
          branch_name: string;
          department_id: string;
          department_name: string;
          worked_days: number;
          worked_minutes: number;
          pending_count: number;
          pending_minutes: number;
          approved_minutes: number;
          attendance_issue_count: number;
          average_device_usage_percent: number | null;
          average_productivity_percent: number | null;
          action_required: boolean;
          total_count: number;
        }>;
      };
      get_overtime_review_detail: {
        Args: { p_organization_id: string; p_employee_id: string; p_from_date: string; p_to_date: string };
        Returns: Array<{
          work_date: string;
          schedule_state: string;
          shift_name: string | null;
          shift_start: string | null;
          shift_end: string | null;
          attendance_record_id: string | null;
          check_in_at: string | null;
          check_out_at: string | null;
          attendance_status: string | null;
          worked_minutes: number;
          missing_minutes: number;
          late_minutes: number;
          early_leaving_minutes: number;
          calculated_overtime_minutes: number;
          overtime_record_id: string | null;
          requested_minutes: number;
          approved_minutes: number | null;
          overtime_status: ApprovalStatus | null;
          device_minutes: number;
          device_usage_percent: number | null;
          device_data_status: string;
          productivity_percent: number | null;
          attendance_issue: boolean;
          reconciliation_issue: boolean;
        }>;
      };
      review_overtime_batch: {
        Args: { p_decisions: Json };
        Returns: OvertimeRecordRow[];
      };
      update_approved_overtime: {
        Args: {
          p_overtime_id: string;
          p_approved_minutes: number;
          p_review_note?: string | null;
        };
        Returns: OvertimeRecordRow;
      };
      get_dashboard_trends: {
        Args: {
          p_organization_id: string;
          p_end_date: string;
          p_days?: number;
          p_branch_id?: string | null;
          p_department_id?: string | null;
          p_shift_id?: string | null;
          p_manager_id?: string | null;
          p_employee_id?: string | null;
        };
        Returns: Json;
      };
      initialize_mailroom_productivity: {
        Args: { p_organization_id: string };
        Returns: Json;
      };
      save_mailroom_productivity_week: {
        Args: { p_organization_id: string; p_week_start: string; p_rows: Json };
        Returns: number;
      };
      save_mailroom_productivity_day: {
        Args: {
          p_organization_id: string;
          p_work_date: string;
          p_status: MailroomDailyEntryStatus;
          p_clients: Json;
          p_returns_received: number;
          p_returns_processed: number;
          p_dsp_allocations: Json;
          p_notes?: string | null;
        };
        Returns: Json;
      };
      save_mailroom_productivity_month: {
        Args: { p_organization_id: string; p_days: Json };
        Returns: Json;
      };
      save_mailroom_turnaround_metrics: {
        Args: { p_organization_id: string; p_rows: Json };
        Returns: number;
      };
      save_mailroom_client_returns: {
        Args: { p_organization_id: string; p_rows: Json };
        Returns: number;
      };
      save_fc_productivity_week: {
        Args: { p_organization_id: string; p_week_start: string; p_import: Json };
        Returns: Json;
      };
      save_fc_week_supplements: {
        Args: { p_organization_id: string; p_week_start: string; p_section: string; p_rows: Json; p_reviewed: boolean };
        Returns: number;
      };
      finalize_fc_productivity_week: {
        Args: { p_organization_id: string; p_week_start: string };
        Returns: undefined;
      };
      save_fc_packer_mapping: {
        Args: { p_organization_id: string; p_packer_label: string; p_employee_id: string };
        Returns: string;
      };
      initialize_fc_activity_standards: {
        Args: { p_organization_id: string };
        Returns: number;
      };
      save_fc_activity_standard: {
        Args: { p_organization_id: string; p_activity_code: string; p_units_per_worker: number; p_target_uom: string; p_is_active: boolean };
        Returns: undefined;
      };
      save_fc_manpower_day: {
        Args: { p_organization_id: string; p_work_date: string; p_data: Json };
        Returns: string;
      };
      import_fc_manpower_days: {
        Args: { p_organization_id: string; p_source_file_name: string; p_rows: Json };
        Returns: number;
      };
      initialize_fc_workspace_settings: {
        Args: { p_organization_id: string };
        Returns: undefined;
      };
      save_fc_settings: {
        Args: { p_organization_id: string; p_updates: Json };
        Returns: undefined;
      };
      save_fc_employee_setting: {
        Args: { p_organization_id: string; p_employee_id: string; p_updates: Json };
        Returns: undefined;
      };
      create_fc_client: {
        Args: { p_organization_id: string; p_code: string; p_name: string; p_template_client_id?: string | null; p_overrides?: Json };
        Returns: string;
      };
      update_fc_client: {
        Args: { p_organization_id: string; p_client_id: string; p_updates: Json };
        Returns: undefined;
      };
      delete_fc_client: {
        Args: { p_organization_id: string; p_client_id: string };
        Returns: undefined;
      };
      save_fc_client_daily_volumes: {
        Args: { p_organization_id: string; p_sources: Json; p_from_date: string; p_to_date: string; p_rows: Json };
        Returns: number;
      };
      import_fc_operational_workspace: {
        Args: {
          p_organization_id: string;
          p_source_file_names: string;
          p_sources: Json;
          p_from_date: string;
          p_to_date: string;
          p_rows: Json;
          p_client_rows: Json;
        };
        Returns: number;
      };
      import_fc_operational_metrics: {
        Args: { p_organization_id: string; p_source_file_names: string; p_sources: Json; p_rows: Json };
        Returns: number;
      };
      manager_correct_attendance: {
        Args: {
          p_organization_id: string;
          p_employee_id: string;
          p_work_date: string;
          p_attendance_record_id: string | null;
          p_check_in_at: string;
          p_check_out_at: string;
          p_reason: string;
        };
        Returns: AttendanceRecordRow[];
      };
      mark_notification_read: {
        Args: { p_notification_id: string };
        Returns: NotificationRow[];
      };
      complete_password_change: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      review_employee_device_enrollment: {
        Args: { p_device_id: string; p_decision: 'approve' | 'reject'; p_reason?: string | null };
        Returns: EmployeeDeviceRow;
      };
      record_location_ping: {
        Args: {
          p_employee_id: string;
          p_latitude: number;
          p_longitude: number;
          p_accuracy_meters: number;
          p_is_mock: boolean;
        };
        Returns: Array<{
          ping_id: string | null;
          inside_geofence: boolean | null;
          recorded: boolean;
        }>;
      };
      record_attendance_location: {
        Args: {
          p_employee_id: string;
          p_latitude: number;
          p_longitude: number;
          p_accuracy_meters: number;
          p_is_mock: boolean;
          p_observed_at: string;
          p_geofence_id: string;
          p_idempotency_key: string;
          p_device_hash: string;
          p_sample_source: string;
        };
        Returns: Array<{
          location_event_id: string | null;
          inside_geofence: boolean | null;
          classified_position: 'inside' | 'outside' | 'unknown' | 'rejected';
          outcome: string;
          attendance_record_id: string | null;
          checkout_at: string | null;
          overtime_minutes: number;
          reason: string;
        }>;
      };
      update_attendance_policy: {
        Args: {
          p_organization_id: string;
          p_auto_checkout_grace_minutes: number;
        };
        Returns: number;
      };
      get_active_geofence_breaches: {
        Args: { p_organization_id: string };
        Returns: Array<{
          breach_id: string;
          employee_id: string;
          employee_name: string | null;
          geofence_id: string | null;
          geofence_name: string | null;
          started_at: string;
          detected_at: string;
          last_seen_outside_at: string;
          minutes_outside: number;
        }>;
      };
      get_live_attendance_snapshot: {
        Args: {
          p_organization_id: string;
          p_date?: string | null;
          p_branch_id?: string | null;
          p_department_id?: string | null;
          p_shift_id?: string | null;
          p_manager_id?: string | null;
          p_employee_id?: string | null;
        };
        Returns: Array<{
          id: string;
          name: string;
          employee_code: string;
          department_id: string | null;
          department_name: string;
          shift: string | null;
          shift_id: string | null;
          shift_start: string | null;
          shift_end: string | null;
          crosses_midnight: boolean;
          checkin: string | null;
          checkout: string | null;
          status: string;
          attendance: string;
          worked_minutes: number;
          inside: boolean;
          is_off: boolean;
          last_event_at: string | null;
          latitude: number | null;
          longitude: number | null;
        }>;
      };
      list_organization_managers: {
        Args: {
          p_organization_id: string;
        };
        Returns: OrganizationManagerItem[];
      };
      admin_update_manager_status: {
        Args: {
          p_organization_id: string;
          p_manager_profile_id: string;
          p_new_status: MembershipStatus;
        };
        Returns: void;
      };
      admin_assign_manager_departments: {
        Args: {
          p_organization_id: string;
          p_manager_user_id: string;
          p_department_ids: string[];
          p_primary_department_id?: string | null;
        };
        Returns: void;
      };
      admin_set_department_primary_manager: {
        Args: {
          p_organization_id: string;
          p_department_id: string;
          p_manager_user_id?: string | null;
        };
        Returns: void;
      };
      get_manager_activity_history: {
        Args: {
          p_organization_id: string;
          p_manager_profile_id: string;
        };
        Returns: ManagerActivityHistoryItem[];
      };
      start_employee_transfer: {
        Args: {
          p_organization_id: string;
          p_employee_id: string;
          p_to_department_id: string;
          p_transfer_date?: string | null;
          p_start_time?: string | null;
          p_end_time?: string | null;
          p_break_minutes?: number | null;
          p_overtime_minutes?: number | null;
          p_transfer_type?: string | null;
          p_reason?: string | null;
          p_notes?: string | null;
        };
        Returns: EmployeeTransferRow;
      };
      complete_employee_transfer: {
        Args: {
          p_organization_id: string;
          p_transfer_id: string;
          p_end_time?: string | null;
          p_break_minutes?: number | null;
          p_overtime_minutes?: number | null;
          p_notes?: string | null;
        };
        Returns: EmployeeTransferRow;
      };
      cancel_employee_transfer: {
        Args: {
          p_organization_id: string;
          p_transfer_id: string;
          p_reason?: string | null;
        };
        Returns: EmployeeTransferRow;
      };
      update_employee_transfer: {
        Args: {
          p_organization_id: string;
          p_transfer_id: string;
          p_to_department_id?: string | null;
          p_transfer_date?: string | null;
          p_start_time?: string | null;
          p_end_time?: string | null;
          p_break_minutes?: number | null;
          p_overtime_minutes?: number | null;
          p_transfer_type?: string | null;
          p_reason?: string | null;
          p_notes?: string | null;
          p_status?: string | null;
        };
        Returns: EmployeeTransferRow;
      };
      get_payroll_settings: {
        Args: { p_organization_id: string };
        Returns: PayrollSettingsRow[];
      };
      upsert_payroll_settings: {
        Args: {
          p_organization_id: string;
          p_currency_code: string;
          p_month_basis_days: number;
          p_daily_hours: number;
          p_overtime_multiplier: number;
        };
        Returns: PayrollSettingsRow;
      };
      list_employee_compensations: {
        Args: { p_organization_id: string; p_employee_id?: string | null };
        Returns: EmployeeCompensationRow[];
      };
      upsert_employee_compensation: {
        Args: {
          p_organization_id: string;
          p_employee_id: string;
          p_monthly_base_salary: number;
          p_currency_code: string;
          p_effective_from: string;
          p_effective_to?: string | null;
          p_notes?: string | null;
          p_id?: string | null;
        };
        Returns: EmployeeCompensationRow;
      };
      delete_employee_compensation: {
        Args: { p_organization_id: string; p_id: string };
        Returns: void;
      };
      list_employee_payroll_components: {
        Args: { p_organization_id: string; p_employee_id?: string | null };
        Returns: EmployeePayrollComponentRow[];
      };
      upsert_employee_payroll_component: {
        Args: {
          p_organization_id: string;
          p_employee_id: string;
          p_component_kind: PayrollComponentKind;
          p_code: string;
          p_name: string;
          p_amount: number;
          p_effective_from: string;
          p_effective_to?: string | null;
          p_is_active?: boolean;
          p_notes?: string | null;
          p_id?: string | null;
        };
        Returns: EmployeePayrollComponentRow;
      };
      delete_employee_payroll_component: {
        Args: { p_organization_id: string; p_id: string };
        Returns: void;
      };
      generate_payroll_run: {
        Args: { p_organization_id: string; p_payroll_month: string };
        Returns: PayrollRunRow;
      };
      list_payroll_runs: {
        Args: { p_organization_id: string };
        Returns: PayrollRunRow[];
      };
      list_payroll_entries: {
        Args: {
          p_organization_id: string;
          p_payroll_run_id: string;
          p_search?: string | null;
          p_branch_id?: string | null;
          p_department_id?: string | null;
          p_review_status?: PayrollReviewStatus | null;
        };
        Returns: PayrollEntryRow[];
      };
      get_payroll_entry_detail: {
        Args: { p_organization_id: string; p_payroll_entry_id: string };
        Returns: PayrollEntryDetail;
      };
      add_payroll_manual_adjustment: {
        Args: {
          p_organization_id: string;
          p_payroll_entry_id: string;
          p_direction: 'earning' | 'deduction';
          p_code: string;
          p_label: string;
          p_amount: number;
          p_notes?: string | null;
        };
        Returns: PayrollLineItemRow;
      };
      delete_payroll_manual_adjustment: {
        Args: { p_organization_id: string; p_line_item_id: string };
        Returns: void;
      };
      waive_payroll_exception: {
        Args: { p_organization_id: string; p_exception_id: string; p_reason: string };
        Returns: PayrollExceptionRow;
      };
      review_payroll_entry: {
        Args: {
          p_organization_id: string;
          p_payroll_entry_id: string;
          p_review_status: PayrollReviewStatus;
          p_review_note?: string | null;
        };
        Returns: PayrollEntryRow;
      };
      submit_payroll_run_for_review: {
        Args: { p_organization_id: string; p_payroll_run_id: string };
        Returns: PayrollRunRow;
      };
      finalize_payroll_run: {
        Args: { p_organization_id: string; p_payroll_run_id: string };
        Returns: PayrollRunRow;
      };
      reopen_payroll_run: {
        Args: { p_organization_id: string; p_payroll_run_id: string; p_reason: string };
        Returns: PayrollRunRow;
      };
      export_payroll_run_rows: {
        Args: { p_organization_id: string; p_payroll_run_id: string };
        Returns: PayrollExportCsvRow[];
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
      payroll_run_status: PayrollRunStatus;
      payroll_review_status: PayrollReviewStatus;
      payroll_component_kind: PayrollComponentKind;
      payroll_line_category: PayrollLineCategory;
      payroll_exception_type: PayrollExceptionType;
      payroll_exception_status: PayrollExceptionStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
