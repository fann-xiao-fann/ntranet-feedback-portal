# Spec Delta

## Purpose

定义员工在免登录前提下通过唯一回执码自助查询本人所提交意见的处理进度、历史状态变更记录及管理员官方回复的行为契约，形成透明可控的意见反馈闭环。

## ADDED Requirements

### Requirement: Look up feedback status by receipt code
The system SHALL allow any intranet user to look up a feedback record by entering its exact receipt code and view its submission summary, current status, attached photo references, and latest official reply.

#### Scenario: Query with a valid receipt code
- **WHEN** an employee submits an existing receipt code on the progress lookup page
- **THEN** the system displays the feedback receipt code, department, category, title, content, submission time, current processing status, attached photos, and latest official reply

#### Scenario: Query with an unknown or malformed receipt code
- **WHEN** an employee enters a receipt code that does not exist or does not match the receipt code format
- **THEN** the system returns a not-found response informing the user that no matching feedback record was found

### Requirement: Display processing history timeline
The system SHALL present the chronological history of status changes and official replies recorded by administrators for the queried feedback record.

#### Scenario: Feedback has multiple recorded updates
- **WHEN** an employee looks up a feedback record that transitioned from `pending` to `in_progress` and then to `resolved` with official replies
- **THEN** the system displays each status transition and its corresponding official reply and timestamp in chronological order

### Requirement: Protect submitter privacy on receipt lookup
The system MUST NOT expose submitter contact details on the public receipt-code lookup response and MUST display anonymous submissions without any personal identity fields.

#### Scenario: Lookup of an anonymous feedback submission
- **WHEN** an employee looks up an anonymous feedback record by receipt code
- **THEN** the system indicates the submitter is anonymous
- **AND** returns null or omitted values for submitter name, employee ID, and contact info

#### Scenario: Lookup of a named feedback submission
- **WHEN** an employee looks up a named feedback record by receipt code
- **THEN** the system omits raw personal contact info from the public lookup response
