# Threat Model: Training Management System

## Executive Summary

This document outlines the security threat landscape for a multi-tenant training attendance and inventory management system. The system processes sensitive trainee data (attendance, GPS coordinates, biometric selfies) and manages role-based access across multiple independent tenants.

**Risk Level:** HIGH — Multi-tenant architecture with sensitive personal data requires strong isolation and access controls.

---

## 1. Attack Surface

### 1.1 Authentication & Authorization Layer

**Entry Points:**
- JWT-based authentication via Authorization headers and cookies
- Role-based access control (super_admin, local_admin, staff_coordinator, trainee)
- Token refresh mechanism

**Threats:**
- **JWT Manipulation** (CRITICAL): Attacker modifies JWT payload to escalate role (trainee → admin)
- **Token Replay** (HIGH): Revoked tokens accepted if not checked against denylist
- **Weak Refresh Logic** (HIGH): Token refresh doesn't validate role immutability
- **Insufficient Role Checks** (CRITICAL): Endpoints missing role authorization or checking only existence, not correctness

### 1.2 Multi-Tenant Data Isolation

**Entry Points:**
- File access endpoints (/api/files/*, /api/attendance/submit)
- Database queries returning tenant-scoped data
- File storage paths

**Threats:**
- **Cross-Tenant File Access** (CRITICAL): No tenant_id validation in file paths; users access other tenant's selfies/documents
- **Path Traversal** (CRITICAL): Filenames with ../ or %2e%2e/ escape tenant directories
- **RLS Bypasses** (HIGH): Supabase Row-Level Security not applied to all queries
- **Tenant Context Loss** (HIGH): Middleware doesn't enforce tenant_id in every request

### 1.3 File Upload & Storage

**Entry Points:**
- POST /api/attendance/submit (multipart form, selfie image + metadata)
- POST /api/upload (generic file upload)
- POST /api/files (document storage)

**Threats:**
- **No Input Validation** (CRITICAL): Filenames, MIME types, sizes unchecked
- **Decompression Bombs** (HIGH): Malicious ZIP/TAR files crash server (500 MB uncompressed from 1 MB)
- **Unrestricted File Types** (HIGH): Executable files (.exe, .php) accepted and stored
- **No Encryption at Rest** (HIGH): Selfies stored unencrypted; tenant-accessible
- **File Enumeration** (MEDIUM): Predictable file paths allow brute-force access to other users' files

### 1.4 GPS Data & Biometric Privacy

**Entry Points:**
- POST /api/attendance/submit accepts gps_lat, gps_lng, gps_accuracy
- No explicit consent tracking or privacy controls
- GPS data returned in queries without audit logging

**Threats:**
- **Location Tracking Abuse** (HIGH): Coordinators track trainee locations without audit
- **No Consent Validation** (HIGH): No check that trainee agreed to GPS tracking
- **Unencrypted Location Data** (HIGH): GPS coordinates stored plaintext in database
- **No Location Sanitization** (MEDIUM): Invalid coordinates (0,0), negative values accepted
- **Location History Retention** (MEDIUM): No policy for purging old location records

### 1.5 API Rate Limiting & DOS

**Entry Points:**
- POST /api/attendance/submit — bulk submission attempts
- POST /api/upload — bulk file uploads
- POST /api/auth/login — brute force login attempts
- GET /api/attendance?... — large result sets

**Threats:**
- **No Rate Limiting** (CRITICAL): Unauthenticated DOS on submit endpoint
- **Bulk Submission Spam** (HIGH): Single trainee submits 1000x attendance in loop
- **Compression Bomb + Rate Limit** (HIGH): Attacker uploads decompression bombs repeatedly
- **Large Query DOS** (MEDIUM): Malicious query filters return 1M+ records, consuming RAM

### 1.6 Request Validation & Injection

**Entry Points:**
- Query parameters: ?trainee_id=X, ?month=YYYY-MM
- Form fields: device_info (JSON), gps_address (string)
- JSON bodies in other endpoints

**Threats:**
- **No JSONB Size Limits** (HIGH): device_info field accepts 10MB JSON, causing OOM
- **JSONB Injection** (MEDIUM): Malicious JSON corrupts data or causes parsing errors
- **No Device Validation** (MEDIUM): Device info schema unchecked; accepts arbitrary keys
- **Timezone Issues** (MEDIUM): Queries use local time instead of UTC, causing data misalignment

### 1.7 Privilege Escalation & Admin Functions

**Entry Points:**
- Bulk attendance marking (POST /api/attendance/bulk)
- Role assignment endpoints
- User creation/modification

**Threats:**
- **Insufficient Staff Checks** (HIGH): Bulk operations don't validate that all trainees belong to same tenant
- **Bulk Absent Ignores Exceptions** (HIGH): Marking bulk absent skips exception records, violating business rules
- **No Audit Trail** (HIGH): Bulk operations don't log which trainees affected, by whom
- **Header-Based Roles** (CRITICAL): If x-user-role header accepted, easy escalation

### 1.8 Session & State Management

**Entry Points:**
- Session order validation (morning before afternoon submission)
- Duplicate submission detection
- Token refresh state

**Threats:**
- **No Session Order Enforcement** (HIGH): Trainee submits afternoon before morning, breaking attendance logic
- **No Duplicate Detection** (HIGH): Same GPS + selfie submitted 10x, counted as 10 days attended
- **Weak Idempotency** (HIGH): Resubmissions create duplicate records without checking timestamp
- **Concurrent Request Race** (MEDIUM): Two simultaneous submissions may both succeed

---

## 2. Threat Actors & Motivations

### 2.1 Insider Threats (Highest Risk)

**Actor:** Disgruntled coordinator or local_admin  
**Capability:** Database access, API key compromise, legitimate login  
**Motivation:** Fraud (mark themselves as attended), data theft (sell trainee info), sabotage

**Attack Scenarios:**
- Coordinator marks all trainees as absent to cover fraud
- Admin exports trainee GPS locations and sells to data broker
- Coordinator uploads malware disguised as training certificate

### 2.2 External Attackers (High Risk)

**Actor:** Automated bots, script kiddies, organized groups  
**Capability:** Port scanning, brute force, malicious file uploads  
**Motivation:** Data theft, service disruption, ransomware

**Attack Scenarios:**
- Brute-force login to discover weak passwords
- Path traversal to access Tenant B's selfies from Tenant A account
- DOS via decompression bombs or bulk submissions

### 2.3 Malicious Trainees (Medium Risk)

**Actor:** Trainee with legitimate account  
**Capability:** API access as their own role, multi-submit  
**Motivation:** Fraud (fake attendance), privacy violation (access peer data)

**Attack Scenarios:**
- Escalate role via JWT manipulation to view other trainees
- Rate-limit bypass to submit attendance 1000x and game the system
- Access other trainee's GPS location history

### 2.4 Passive Eavesdroppers (Low Risk, but possible)

**Actor:** Network-level attacker (MITM, ISP eavesdropping)  
**Capability:** Intercept HTTPS traffic (if misconfigured)  
**Motivation:** Data exfiltration

**Attack Scenarios:**
- Intercept unencrypted selfie downloads
- Harvest JWT tokens from cookies over HTTP

---

## 3. Risk Matrix

| Threat | Severity | Likelihood | Impact | Mitigation Priority |
|--------|----------|------------|--------|---------------------|
| JWT Role Escalation | CRITICAL | HIGH | Full system compromise | URGENT (Task 4) |
| Cross-Tenant File Access | CRITICAL | HIGH | Privacy breach, data theft | URGENT (Task 3) |
| Path Traversal Attacks | CRITICAL | MEDIUM | Data disclosure | URGENT (Task 5) |
| No Rate Limiting | CRITICAL | MEDIUM | DOS, service down | URGENT (Task 6) |
| Decompression Bombs | HIGH | MEDIUM | Server crash, DOS | HIGH (Task 8) |
| No Encryption at Rest | HIGH | MEDIUM | Breach impact amplified | HIGH (Task 10) |
| GPS Privacy Abuse | HIGH | MEDIUM | Regulatory breach (privacy) | HIGH (Tasks 11) |
| No Session Order Validation | HIGH | MEDIUM | Attendance fraud | HIGH (Task 12) |
| JSONB DOS via Size | HIGH | LOW | Server memory exhaustion | MEDIUM (Task 15) |
| Timezone Misalignment | MEDIUM | MEDIUM | Data integrity issue | MEDIUM (Task 13) |
| No Audit Logging | MEDIUM | HIGH | Forensics impossible | MEDIUM (Task 20) |
| No Duplicate Detection | MEDIUM | MEDIUM | Attendance inflation | MEDIUM (Task 19) |

---

## 4. Data Classification

### High-Risk Data (PII + Biometric)

- **Selfie Images** — Biometric data, personally identifiable, high re-identification risk
- **GPS Coordinates** — Location tracking, real-time movement, privacy-sensitive
- **Email Addresses** — Used for account recovery, phishing vector
- **Phone Numbers** — Used for SMS phishing
- **Name + Photo** — Combined, enables identity theft

**Controls Required:**
- Encryption at rest (AES-256-GCM)
- Role-based access (trainee sees only own data, staff sees tenant scope)
- Audit logging (who accessed what, when)
- Data retention limits (delete after 90 days, archive at 1 year)
- Consent tracking (GPS opt-in with audit trail)

### Medium-Risk Data (Personal)

- **Birth Date, Province, Barangay** — De-identification risk if combined
- **Employment Status, Educational Level** — Demographic profiling risk
- **Emergency Contact Info** — Could be used for social engineering

**Controls Required:**
- Tenant isolation
- Staff role restriction
- Audit logging

### Low-Risk Data

- Item inventory, program names, session schedules — limited PII exposure

---

## 5. Compliance & Regulatory Context

### Data Protection Laws

- **GDPR (if EU trainees):** Explicit consent for GPS, right to delete
- **Data Privacy Act 2012 (Philippines):** Purpose limitation, data protection, breach notification
- **Local Regulations:** Varies by region, jurisdiction

### Regulatory Threats

- **Fines for Unauthorized Access:** Up to 4% revenue if GDPR
- **Breach Notification:** Required within 72 hours
- **User Rights:** Erasure, data portability, rectification

---

## 6. Recommended Fix Priorities

### Phase 1: CRITICAL (Days 1-5)

1. Task 1: Threat model + utilities
2. Task 2: Lock down selfie endpoints
3. Task 3: Fix cross-tenant isolation
4. Task 4: Prevent privilege escalation
5. Task 5: Path traversal protection
6. Task 6: Add rate limiting
7. Task 7: Trainee record authorization
8. Task 8: Decompression bomb protection

### Phase 2: HIGH (Days 6-10)

9. Task 9: GPS validation
10. Task 10: Selfie encryption at rest
11. Task 11: GPS privacy + audit logging
12. Task 12: Fix bulk operations
13. Task 13: Timezone standardization
14. Task 14: CSRF protection
15. Task 15: JSONB size limits
16. Task 16: Login attempt lockout
17. Task 17: Device validation schema

### Phase 3: MEDIUM (Days 11-20)

18-25: Session order, duplicate detection, audit logging, retention, geofence, malware scan, JWT refresh, webhooks

---

## 7. Testing & Validation

**Security Test Cases:**
- ✅ Attempt JWT role modification → rejected
- ✅ Access Tenant B file as Tenant A user → 403 Forbidden
- ✅ Path traversal filenames → sanitized or rejected
- ✅ 1000 submissions in 1 hour → 429 Too Many Requests after limit
- ✅ 500 MB file decompresses to 5 GB → rejected
- ✅ Trainee views other trainee's data → 403 Forbidden
- ✅ Unauthenticated submit → 401 Unauthorized
- ✅ Admin marks tenant B trainees absent → forbidden or soft-limited to own tenant

**Audit Trail Validation:**
- ✅ All failed auth attempts logged
- ✅ All authorization denials logged
- ✅ All file uploads logged with user, filename, size
- ✅ All GPS accesses logged with justification (field name, admin override reason)

---

## 8. Dependencies & Assumptions

**Assumptions:**
- Supabase provides row-level security (RLS) if enabled
- File storage is local disk (/uploads/ directory)
- Single-instance deployment (in-memory rate limiting sufficient)
- No existing encryption infrastructure

**Future Upgrades:**
- Move to KMS (AWS, Azure) for key management
- S3/Blob storage for files
- Redis-backed rate limiting (multi-instance)
- Webhook signing + delivery system

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2024 | 1.0 | Initial threat model |
