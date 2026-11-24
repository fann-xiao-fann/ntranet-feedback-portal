# Spec Delta

## Purpose

定义管理后台的管理员登录认证、跨部门意见列表的多条件筛选检索、详情与照片审阅、处理状态流转与官方回复、部门配置维护以及 CSV 数据导出的完整管理行为契约。

## ADDED Requirements

### Requirement: Authenticate administrators for management operations
The system MUST require authenticated administrator sessions for all management pages and API endpoints and SHALL rate-limit repeated failed login attempts.

#### Scenario: Successful administrator login
- **WHEN** an administrator submits a valid username and password to the login endpoint
- **THEN** the system creates a server-verified session stored in an `HttpOnly`, `SameSite=Lax` cookie
- **AND** grants access to management pages and APIs

#### Scenario: Unauthenticated access to management endpoints
- **WHEN** an unauthenticated client requests any admin API endpoint other than login
- **THEN** the system rejects the request with HTTP 401

#### Scenario: Administrator logout invalidates session
- **WHEN** an authenticated administrator invokes logout
- **THEN** the system invalidates the active session and clears the session cookie
- **AND** subsequent admin API requests using the previous cookie return HTTP 401

#### Scenario: Excessive failed login attempts throttled
- **WHEN** a client submits repeated invalid credentials exceeding the configured login failure threshold within the rate-limit window
- **THEN** the system rejects further login attempts temporarily with HTTP 429

### Requirement: Browse, filter, and search submitted feedback
The system SHALL allow authenticated administrators to view paginated feedback submissions sorted newest-first and filter them by department, status, category, submission date range, and search keyword.

#### Scenario: Filter feedback by department and status
- **WHEN** an administrator selects a department and status `pending` in the management list
- **THEN** the system returns only feedback records matching both filters along with total record count and pagination metadata

#### Scenario: Search feedback by keyword or receipt code
- **WHEN** an administrator enters a keyword or receipt code in the search filter
- **THEN** the system returns feedback records whose title, content, receipt code, or submitter name contains the search term

### Requirement: Inspect full feedback details and photo attachments
The system SHALL allow authenticated administrators to view complete details of any feedback record, including submitter identity or anonymous status, message content, processing history, and full-size photo preview and download.

#### Scenario: Open feedback detail with multiple photos
- **WHEN** an administrator opens a feedback record containing attached photos
- **THEN** the system displays all submitted metadata, full content, processing history, and full-resolution photo previews with download actions

### Requirement: Update processing status and publish official replies
The system SHALL allow authenticated administrators to change a feedback item's processing status among `pending`, `in_progress`, `resolved`, and `closed`, optionally add or update an official reply, and record each change in processing history.

#### Scenario: Transition status and publish reply
- **WHEN** an administrator updates a feedback record to status `resolved` with an official reply message
- **THEN** the system saves the new status, official reply, and updated timestamp
- **AND** appends an audit entry to the feedback processing history visible on receipt lookup

#### Scenario: Reject invalid status transition payload
- **WHEN** an administrator submits an unrecognized status value
- **THEN** the system rejects the request with HTTP 400
- **AND** leaves the feedback record unchanged

### Requirement: Manage department options
The system SHALL allow authenticated administrators to create, rename, reorder, enable, and disable departments while preserving historical department associations on existing feedback records.

#### Scenario: Create a new department
- **WHEN** an administrator creates a department with a unique non-empty name
- **THEN** the system persists the department and exposes it on the submission form when enabled

#### Scenario: Disable a department with existing feedback
- **WHEN** an administrator disables a department that already has submitted feedback records
- **THEN** the department is hidden from the employee submission form
- **AND** historical feedback records continue to display that department name and remain filterable in the admin list

#### Scenario: Reject duplicate department name
- **WHEN** an administrator attempts to create or rename a department to a name already used by another department
- **THEN** the system rejects the request with HTTP 409

### Requirement: Export filtered feedback records to CSV
The system SHALL allow authenticated administrators to export feedback records matching the active filters as a UTF-8 CSV file with BOM and spreadsheet formula-injection neutralization.

#### Scenario: Export filtered feedback list
- **WHEN** an administrator triggers CSV export while department and status filters are active
- **THEN** the system returns a downloadable UTF-8 CSV file with BOM containing only matching records and columns for receipt code, submission time, department, submitter info, category, title, content, photo count, status, official reply, and last updated time
- **AND** prefixes cell values starting with `=`, `+`, `-`, or `@` so spreadsheet tools treat them as plain text
