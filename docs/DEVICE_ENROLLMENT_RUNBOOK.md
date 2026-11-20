# Device enrollment and replacement runbook

## Purpose

Attendance and work-period telemetry are accepted only from an employee device
whose hashed app-scoped identity has been reviewed by an administrator. The hash
is an identifier, not proof of hardware integrity; never describe it as Play
Integrity attestation.

## Initial rollout

1. Deploy the database gate and Android build to staging first.
2. Confirm administrators can view pending devices and the audit log through an
   approved administrative workflow. Do not grant direct table writes.
3. Pilot a small group. The first attendance attempt from a new device creates a
   `suspected` enrollment and returns `device_pending_approval`; it must not
   create attendance.
4. Verify the employee through the approved helpdesk/HR process. Compare only
   non-secret device metadata and the employee record; never ask for passwords.
5. An organization administrator calls
   `review_employee_device_enrollment(device_id, 'approve', reason)`. Approval
   revokes the employee's prior valid device and writes audit records.
6. Ask the employee to retry the original action. Offline events retained as
   review-required must be reconciled through attendance correction; do not
   silently discard or auto-approve them.

## Replacement or lost device

1. Authenticate the request through the approved support channel.
2. Immediately call `reset_employee_device(employee_id)` for a lost, stolen, or
   compromised device. This blocks all existing identifiers; it does not approve
   a replacement.
3. Install the approved Android build on the replacement. Let it create a new
   pending enrollment.
4. Review and approve the new row with a reason referencing the support case.
5. Verify the previous device remains `blocked` with `revoked_at` set and the
   audit log contains reset/enrollment/approval transitions.

## Rejection and exception handling

- Reject unknown, duplicated, policy-ineligible, or unverifiable devices with a
  documented reason. A rejected device cannot reactivate itself.
- Managers cannot approve devices. Cross-organization administrators cannot
  approve them.
- If the employee cannot use an eligible device, use the documented manual
  attendance/correction process. Missing device evidence is not absence or an
  automatic policy violation.
- Legacy Android clients without a device hash return a permanent
  `client_upgrade_required`/review outcome. Upgrade the client and reconcile the
  retained event; never change it to synced merely to clear the queue.

## Audit review

At least monthly, review pending devices older than the approved SLA, multiple
replacement attempts, resets without a support case, cross-organization access
denials, and employees with no valid device. Retain audit logs according to the
approved security/HR schedule and legal holds.
