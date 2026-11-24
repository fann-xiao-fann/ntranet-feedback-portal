# Spec Delta

## Purpose

定义公司各部门员工在内网免登录提交意见建议与问题反馈的表单行为、字段校验规则、实名与匿名选项以及回执码签发契约，确保跨部门反馈高效、规范地进入系统。

## ADDED Requirements

### Requirement: Load enabled departments for submission
The system SHALL provide the list of enabled company departments for employees to select when submitting feedback, without requiring login.

#### Scenario: Employee opens the feedback submission page
- **WHEN** an intranet employee opens the feedback submission page
- **THEN** the system displays all enabled departments in their configured sort order
- **AND** disabled departments are not offered for selection

#### Scenario: No enabled departments exist
- **WHEN** no departments are currently enabled in the system
- **THEN** the system displays a notice that feedback submission is temporarily unavailable
- **AND** prevents submitting the form

### Requirement: Submit structured feedback without login
The system SHALL allow any intranet employee to submit feedback containing an enabled department, category, title, and detailed content, optionally accompanied by photo attachments, without requiring authentication.

#### Scenario: Successful named feedback submission
- **WHEN** an employee selects an enabled department, selects a valid category, enters a title, detailed content, and submitter name, and submits the form
- **THEN** the system persists the feedback with initial status `pending`
- **AND** associates any valid uploaded photo attachments with the new feedback record
- **AND** returns the generated receipt code

#### Scenario: Reject submission with missing required fields
- **WHEN** an employee submits feedback without an enabled department, with an empty title, or with empty content
- **THEN** the system rejects the submission with a validation error identifying the missing fields
- **AND** does not persist a feedback record

#### Scenario: Enforce text length limits
- **WHEN** an employee submits a title exceeding 100 characters or detailed content exceeding 5000 characters
- **THEN** the system rejects the submission with a field-length validation error
- **AND** does not persist a feedback record

### Requirement: Support optional anonymous submission
The system SHALL allow employees to submit feedback either anonymously or with identity details (name, optional employee ID, and optional contact information).

#### Scenario: Successful anonymous submission
- **WHEN** an employee enables anonymous mode and submits valid department, category, title, and content without providing a name, employee ID, or contact info
- **THEN** the system accepts and persists the feedback marked as anonymous
- **AND** stores no submitter personal identity fields

#### Scenario: Named submission requires submitter name
- **WHEN** an employee leaves anonymous mode disabled and submits with a blank submitter name
- **THEN** the system rejects the submission with a validation error prompting for a submitter name or anonymous mode

### Requirement: Issue unique receipt code on submission
Upon successfully persisting a feedback submission, the system MUST generate a unique, non-sequential receipt code and return it to the submitter.

#### Scenario: Receipt code generated and displayed on confirmation
- **WHEN** a feedback submission is persisted successfully
- **THEN** the system generates a unique receipt code in the format `FB-YYYYMMDD-XXXXXX` using unpredictable uppercase alphanumeric characters
- **AND** displays the receipt code on the confirmation screen with a one-click copy action
