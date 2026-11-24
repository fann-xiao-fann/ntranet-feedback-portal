# Tasks

## 1. Project Scaffolding & Database Foundation

- [x] 1.1 Initialize `feedback-portal/` workspace (`package.json`, `server/` Express + TypeScript config, `web/` React + Vite + Tailwind CSS config, `.env.example`, `.gitignore`) and verify `npm install` and TypeScript typecheck succeed in both `server/` and `web/`.
- [x] 1.2 Implement `server/src/config.ts` and `server/src/db/` using Node built-in `node:sqlite` (`DatabaseSync`, WAL mode, `foreign_keys = ON`, `busy_timeout = 5000`), schema initialization for `departments`, `feedbacks`, `attachments`, `feedback_logs`, `admin_users`, and `admin_sessions`, plus idempotent default department and initial admin seeding; verify with automated unit tests covering fresh database boot, idempotent restart, and seeded records.
- [x] 1.3 Add `GET /api/health` endpoint and unified error-handling middleware in `server/src/app.ts`; verify via automated HTTP test returning HTTP 200 with healthy database status.

## 2. Photo Upload Security & Local Attachment Storage

- [x] 2.1 Implement magic-byte image validation (JPEG/PNG/WebP), filename sanitization, opaque `YYYY/MM/<uuid>.<ext>` storage mover, and request-scoped temp/file cleanup in `server/src/services/attachments.ts`; verify with unit tests covering valid JPEG/PNG/WebP signatures, spoofed `.jpg` non-image files, path-traversal filenames (`../../etc/passwd.png`), size/count limits, and rollback cleanup.
- [x] 2.2 Implement `GET /api/attachments/:id` controlled file delivery checking either valid admin session or exact matching `?receiptCode`, enforcing uploads-root path containment, validated `Content-Type`, `X-Content-Type-Options: nosniff`, and optional `?download=1` `Content-Disposition: attachment`; verify with API tests covering admin access, matching receipt-code access, and HTTP 403 on unauthorized or mismatched requests.

## 3. Public Feedback Submission & Progress Lookup APIs

- [x] 3.1 Implement `GET /api/departments` (enabled departments ordered by `sort_order`) and non-sequential receipt-code generator (`FB-YYYYMMDD-XXXXXX` with unambiguous uppercase alphabet and collision retry); verify with unit and API tests confirming disabled departments are excluded and generated receipt codes match the expected format.
- [x] 3.2 Implement `POST /api/feedbacks` handling `multipart/form-data` (up to 5 photos, 10 MB each), field validation (enabled department, category, title <= 100 chars, content <= 5000 chars, named vs anonymous rules), transactional persistence (`feedbacks`, `attachments`, initial `feedback_logs`), and orphan-file cleanup on any validation or DB failure; verify with API tests covering named submission, anonymous submission, invalid inputs, and spoofed-image rejection leaving zero orphan files on disk.
- [x] 3.3 Implement `GET /api/feedbacks/lookup/:receiptCode` with input trimming/uppercasing, chronological `feedback_logs` timeline, receipt-scoped photo references, and submitter privacy filtering (anonymous omits all identity fields; named omits raw `contact_info`); verify with API tests covering valid lookup, multi-step timeline order, privacy guarantees, and HTTP 404 on unknown or malformed codes.

## 4. Admin Authentication, Management & Export APIs

- [x] 4.1 Implement salted `scrypt` password hashing/verification, SQLite-backed `admin_sessions` (`HttpOnly`, `SameSite=Lax`, configurable `COOKIE_SECURE`), IP sliding-window login rate limiter, admin auth middleware, and `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/me`; verify with API tests covering successful login, session check, unauthenticated HTTP 401, logout invalidation, and HTTP 429 after repeated failures.
- [x] 4.2 Implement `GET /api/admin/feedbacks` (paginated, newest-first, filtering by department, status, category, date range, and keyword matching title/content/receipt code/submitter name), `GET /api/admin/feedbacks/:id` (full submitter info, attachments, processing logs), and `PATCH /api/admin/feedbacks/:id` (status validation for `pending`/`in_progress`/`resolved`/`closed`, official reply, and appending to `feedback_logs`); verify with API tests covering combined filters, search, status/reply updates, and HTTP 400 on invalid status values.
- [x] 4.3 Implement `GET/POST/PATCH /api/admin/departments` for creating, renaming, reordering, enabling, and disabling departments with unique-name HTTP 409 conflict detection and historical feedback preservation; verify with API tests covering creation, duplicate-name conflict, and disabling a department that has linked feedback records.
- [x] 4.4 Implement RFC 4180 CSV serializer and `GET /api/admin/feedbacks/export` reusing list filter logic, outputting UTF-8 with BOM (`\uFEFF`) and spreadsheet formula-injection neutralization (`=`, `+`, `-`, `@`, `\t`, `\r`); verify with unit and API tests inspecting BOM prefix, filtered record subset, quoting, and neutralized formula cells.

## 5. Employee Frontend Portal (Submission & Progress Lookup)

- [x] 5.1 Build responsive portal layout and client routing (`/` 意见提交, `/lookup` 进度查询, `/admin` 管理入口) with local Tailwind CSS and system fonts (zero external CDN requests); verify `npm run build` in `web/` succeeds and generated HTML/CSS contains no external CDN URLs.
- [x] 5.2 Implement Employee Feedback Submission page (`/`): enabled department selector (with unavailable notice when empty), category selector, title/content character counters, anonymous toggle hiding/disabling identity inputs, multi-photo selector/drag-drop/mobile capture with thumbnail preview, size/count validation and removal, and confirmation screen showing the receipt code with one-click copy and direct link to progress lookup; verify via TypeScript typecheck and `web/` production build.
- [x] 5.3 Implement Progress Lookup page (`/lookup`): receipt-code search input (supporting `?code=` prefill), status badge, feedback details, chronological processing history timeline, official reply highlight, photo thumbnail gallery with lightbox preview, and not-found error state; verify via TypeScript typecheck and `web/` production build.

## 6. Admin Frontend Dashboard

- [x] 6.1 Implement Admin Login page (`/admin/login`) and authenticated admin layout shell with session verification (`GET /api/admin/me`), redirect on 401, and logout button; verify via TypeScript typecheck and `web/` production build.
- [x] 6.2 Implement Admin Feedback List & Detail pages (`/admin/feedbacks`, `/admin/feedbacks/:id`): multi-criteria filter bar (department, status, category, date range, keyword), pagination, CSV export button, full detail panel with submitter info, photo lightbox preview and download links, status update and official reply form, and history timeline refresh; verify via TypeScript typecheck and `web/` production build.
- [x] 6.3 Implement Department Management page (`/admin/departments`): table of all departments with sort order and enabled toggle, create/rename/reorder controls, and duplicate-name error display; verify via TypeScript typecheck and `web/` production build.

## 7. Production Packaging, Intranet Deployment & End-to-End Verification

- [x] 7.1 Configure Express production static serving of `web/dist` with SPA fallback (excluding `/api/*`), author `feedback-portal/Dockerfile` (multi-stage `node:24-alpine`, non-root user, `/api/health` healthcheck), `feedback-portal/docker-compose.yml` (`./data:/app/data`), and `feedback-portal/README.md` documenting `.env` setup, LAN access, `./data` backup, and optional HTTPS `COOKIE_SECURE=true` setup; verify production build runs as a single process and `docker compose config` validates cleanly.
- [x] 7.2 Execute full automated test suite and production build, then run an end-to-end smoke check against the built single-process server using a temporary `DATA_DIR` verifying: named & anonymous photo submissions → receipt lookup & photo preview → unauthorized photo HTTP 403 → admin login → filter/detail/reply update → receipt lookup timeline reflection → CSV export download → department disable preserving historical feedback.
