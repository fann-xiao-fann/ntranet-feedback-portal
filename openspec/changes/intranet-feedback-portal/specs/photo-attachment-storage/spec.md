# Spec Delta

## Purpose

定义意见反馈中照片附件的格式、大小与数量校验、本地磁盘安全存储、受控访问预览与下载以及提交流程失败时的孤立文件清理契约，确保内网图片数据安全可靠。

## ADDED Requirements

### Requirement: Validate photo file type, size, and count
The system SHALL allow up to 5 photo attachments per feedback submission, each no larger than 10 MB and in JPEG, PNG, or WebP format verified by actual file content rather than filename extension alone.

#### Scenario: Valid multi-photo upload accepted
- **WHEN** an employee attaches between 1 and 5 valid JPEG, PNG, or WebP images each at or below 10 MB to a submission
- **THEN** the system accepts all attached images and associates them with the created feedback record

#### Scenario: Reject unsupported format or spoofed extension
- **WHEN** an employee uploads a non-image file or a file renamed to `.jpg` whose binary signature is not JPEG, PNG, or WebP
- **THEN** the system rejects the submission with an unsupported image format error
- **AND** does not retain the rejected file on disk

#### Scenario: Reject oversized photo or excessive count
- **WHEN** an employee uploads an image larger than 10 MB or attempts to upload more than 5 images in one submission
- **THEN** the system rejects the submission with a clear size-limit or count-limit validation error

### Requirement: Store uploaded photos safely with opaque identifiers
The system MUST persist validated photos inside the configured local uploads directory using system-generated opaque filenames and MUST NOT allow path traversal or script execution via uploaded filenames.

#### Scenario: Original filename contains path traversal characters
- **WHEN** a valid PNG image is uploaded with original filename `../../etc/passwd.png`
- **THEN** the system writes the file to a generated safe path strictly inside the configured uploads directory
- **AND** stores sanitized display metadata without exposing server filesystem paths

### Requirement: Enforce authorized access for photo preview and download
The system SHALL serve stored photo attachments only to an authenticated administrator or a requester supplying the matching receipt code of the owning feedback, using safe HTTP response headers.

#### Scenario: Administrator views or downloads a photo attachment
- **WHEN** an authenticated administrator requests an existing photo attachment
- **THEN** the system returns the image binary with its validated image `Content-Type` header and `X-Content-Type-Options: nosniff`

#### Scenario: Submitter views a photo attachment using receipt code
- **WHEN** an unauthenticated requester requests a photo attachment accompanied by the exact matching `receiptCode` of its owning feedback
- **THEN** the system returns the image binary with its validated image `Content-Type` header and `X-Content-Type-Options: nosniff`

#### Scenario: Unauthorized photo access rejected
- **WHEN** an unauthenticated requester requests a photo attachment without a receipt code or with a non-matching receipt code
- **THEN** the system rejects the request with HTTP 403
- **AND** does not return the image content

### Requirement: Clean up orphaned files when submission fails
If feedback persistence or subsequent attachment validation fails after one or more photos have been written to disk, the system MUST delete all files written during that request.

#### Scenario: Rollback stored files on failed multi-photo submission
- **WHEN** a submission with 2 photos writes the first photo and then fails validation on the second photo or fails database persistence
- **THEN** the system deletes the first photo from local storage before returning the error response
- **AND** leaves no orphaned file on disk
