# GEOTRACK employee privacy and monitoring notice

> Deployment template — complete every bracketed field and obtain Saudi legal/HR
> approval before issuing it to employees. This document is not legal advice.

**Controller:** [legal company name], [commercial registration/address]  
**Privacy contact / DPO:** [name or role, email, phone]  
**Effective date:** [date]  
**Notice version:** 1.0

## What GEOTRACK collects

GEOTRACK processes work identity and employment data (name, employee number,
organization, branch, department, manager and assigned schedule); attendance
events; the device time and identifier used for a work attendance event;
location coordinates, accuracy, mock-location status and assigned geofence at
check-in/check-out; leave, overtime and productivity records; and push
notification tokens.

On a company-managed Android device, phone-usage summaries are collected only
after the employee explicitly enables Android Usage Access. The summary is
limited to active minutes, minutes within the assigned shift, total shift
minutes, percentage, date, device identifier and consent-version record.
GEOTRACK does not collect message contents, passwords, photographs, microphone
audio, contacts or the contents of personal browsing.

## Why the data is used

The data is used only to administer work schedules and attendance, validate
whether attendance occurred within an assigned workplace geofence, calculate
working/late/early/overtime minutes, manage leave and corrections, deliver
work notifications, maintain security and audit records, and investigate
attendance or service incidents.

The employer must document the applicable legal basis for each purpose:
[employment obligation / legal obligation / legitimate interest / explicit
consent where required]. Consent must not be described as the legal basis when
the employee cannot freely refuse it.

## When monitoring occurs

- Location is requested for an attendance action and, if the employee enables
  background location, for automatic entry/exit detection around an assigned
  workplace geofence.
- Phone-usage summaries are limited to active working hours and company-managed
  devices. Personal/BYOD devices are excluded.
- GEOTRACK must not be used for continuous off-duty tracking.

## Sharing and international transfers

Authorized administrators and the employee's assigned manager receive only the
records needed for their role. Service providers may process data to operate
the application, including Supabase, Vercel, Firebase/Google Cloud and Mapbox.
Before production use, the controller must document each provider, processing
location, retention period, contract, security controls and any cross-border
transfer mechanism required by Saudi law.

## Retention and deletion

Use the approved retention schedule: attendance/payroll records [period],
precise location and device-event details [shorter period], push tokens until
revoked or inactive, audit/security logs [period], and rejected/offline events
[period]. Data must be deleted or irreversibly anonymized when no longer
needed, subject to legal holds and statutory recordkeeping.

## Employee choices and rights

Employees may ask the privacy contact for access, correction, a copy of their
data, or other rights available under applicable law. Employees can disable
Android Usage Access and optional background location in device settings,
although doing so may disable the related automatic features. Provide an
alternative attendance method where required by policy or law. Complaints may
also be raised with the competent Saudi data-protection authority.

## Security and incidents

GEOTRACK uses authenticated access, role-based row-level controls, encryption
in transit, restricted client credentials and audit logging. Employees should
report a lost device, suspected unauthorized access or inaccurate attendance
record immediately to [security/helpdesk contact].

## Acknowledgement

I acknowledge that I received and understood this notice. Acknowledgement
confirms receipt; it is not used as blanket consent for processing that relies
on another legal basis.

Employee name: ____________________  ID: ____________________  
Signature: ________________________  Date: __________________

## Drafting references

- Saudi Personal Data Protection Law:
  https://dgp.sdaia.gov.sa/wps/portal/pdp/knowledgecenter/details/PDPL
- Implementing Regulation of the Personal Data Protection Law:
  https://dgp.sdaia.gov.sa/wps/portal/pdp/knowledgecenter/details/PDPL2
- SDAIA controller/processor guidance:
  https://dgp.sdaia.gov.sa/wps/portal/pdp/knowledgecenter/details/PDPLCP
