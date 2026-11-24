import express from 'express';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { AppConfig } from '../config.js';
import { runInTransaction } from '../db/index.js';
import { ADMIN_SESSION_COOKIE, LoginRateLimiter, requireAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { isValidStatus } from '../services/constants.js';
import { buildFeedbackCsv, type FeedbackCsvRow } from '../services/csv.js';
import { generateSessionToken, hashToken, verifyPassword } from '../services/password.js';

interface FeedbackFilterResult {
  whereSql: string;
  params: SQLInputValue[];
}

function buildFeedbackFilters(query: Record<string, unknown>): FeedbackFilterResult {
  const conditions: string[] = [];
  const params: SQLInputValue[] = [];

  if (query.departmentId !== undefined && query.departmentId !== '') {
    const deptId = Number(query.departmentId);
    if (Number.isInteger(deptId) && deptId > 0) {
      conditions.push('f.department_id = ?');
      params.push(deptId);
    }
  }

  if (typeof query.status === 'string' && query.status.trim() !== '') {
    const status = query.status.trim();
    if (isValidStatus(status)) {
      conditions.push('f.status = ?');
      params.push(status);
    }
  }

  if (typeof query.category === 'string' && query.category.trim() !== '') {
    conditions.push('f.category = ?');
    params.push(query.category.trim());
  }

  if (typeof query.featureCategory === 'string' && query.featureCategory.trim() !== '') {
    conditions.push('f.feature_category = ?');
    params.push(query.featureCategory.trim());
  }

  if (typeof query.dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.dateFrom.trim())) {
    conditions.push('f.created_at >= ?');
    params.push(`${query.dateFrom.trim()}T00:00:00.000Z`);
  }

  if (typeof query.dateTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.dateTo.trim())) {
    conditions.push('f.created_at <= ?');
    params.push(`${query.dateTo.trim()}T23:59:59.999Z`);
  }

  if (typeof query.keyword === 'string' && query.keyword.trim() !== '') {
    const pattern = `%${query.keyword.trim()}%`;
    conditions.push(
      '(f.title LIKE ? OR f.content LIKE ? OR f.receipt_code LIKE ? OR COALESCE(f.submitter_name, \'\') LIKE ?)'
    );
    params.push(pattern, pattern, pattern, pattern);
  }

  return {
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export function createAdminRouter(db: DatabaseSync, config: AppConfig): express.Router {
  const router = express.Router();
  const rateLimiter = new LoginRateLimiter(config.loginRateLimitMax, config.loginRateLimitWindowMs);

  router.post('/login', (req, res, next) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      if (rateLimiter.isBlocked(clientIp)) {
        throw new AppError(429, 'TOO_MANY_LOGIN_ATTEMPTS', '登录失败次数过多，请稍后再试');
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      if (!username || !password) {
        rateLimiter.recordFailure(clientIp);
        throw new AppError(400, 'INVALID_CREDENTIALS', '请输入管理员账号和密码');
      }

      const user = db
        .prepare('SELECT id, username, password_hash FROM admin_users WHERE username = ?')
        .get(username) as { id: number; username: string; password_hash: string } | undefined;

      if (!user || !verifyPassword(password, user.password_hash)) {
        rateLimiter.recordFailure(clientIp);
        throw new AppError(401, 'INVALID_CREDENTIALS', '账号或密码错误');
      }

      rateLimiter.reset(clientIp);

      const token = generateSessionToken();
      const tokenHash = hashToken(token);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + config.sessionTtlHours * 3600 * 1000);

      // Clean expired sessions opportunistically
      db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now.toISOString());
      db.prepare(
        'INSERT INTO admin_sessions (token_hash, admin_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
      ).run(tokenHash, user.id, expiresAt.toISOString(), now.toISOString());

      res.cookie(ADMIN_SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.cookieSecure,
        path: '/',
        maxAge: config.sessionTtlHours * 3600 * 1000,
      });

      res.json({
        admin: {
          id: user.id,
          username: user.username,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', (req, res, next) => {
    try {
      const token = req.cookies?.[ADMIN_SESSION_COOKIE];
      if (token && typeof token === 'string') {
        db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashToken(token));
      }
      res.clearCookie(ADMIN_SESSION_COOKIE, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.cookieSecure,
        path: '/',
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.use(requireAdmin(db));

  router.get('/me', (req, res) => {
    res.json({ admin: req.admin });
  });

  router.get('/feedbacks', (req, res, next) => {
    try {
      const { whereSql, params } = buildFeedbackFilters(req.query as Record<string, unknown>);
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
      const offset = (page - 1) * pageSize;

      const totalRow = db
        .prepare(`SELECT COUNT(*) as total FROM feedbacks f ${whereSql}`)
        .get(...params) as { total: number };
      const total = totalRow.total;

      const rows = db
        .prepare(
          `SELECT
             f.id, f.receipt_code, f.department_id, d.name as department_name,
             f.category, f.feature_category, f.title, f.content, f.is_anonymous,
             f.submitter_name, f.employee_no, f.contact_info,
             f.status, f.admin_reply, f.created_at, f.updated_at,
             (SELECT COUNT(*) FROM attachments a WHERE a.feedback_id = f.id) as attachment_count
           FROM feedbacks f
           JOIN departments d ON d.id = f.department_id
           ${whereSql}
           ORDER BY f.created_at DESC, f.id DESC
           LIMIT ? OFFSET ?`
        )
        .all(...params, pageSize, offset) as Array<{
        id: number;
        receipt_code: string;
        department_id: number;
        department_name: string;
        category: string;
        feature_category: string | null;
        title: string;
        content: string;
        is_anonymous: number;
        submitter_name: string | null;
        employee_no: string | null;
        contact_info: string | null;
        status: string;
        admin_reply: string | null;
        created_at: string;
        updated_at: string;
        attachment_count: number;
      }>;

      res.json({
        items: rows.map((r) => ({
          id: r.id,
          receiptCode: r.receipt_code,
          departmentId: r.department_id,
          departmentName: r.department_name,
          category: r.category,
          featureCategory: r.feature_category,
          title: r.title,
          content: r.content,
          isAnonymous: r.is_anonymous === 1,
          submitterName: r.submitter_name,
          employeeNo: r.employee_no,
          contactInfo: r.contact_info,
          status: r.status,
          adminReply: r.admin_reply,
          attachmentCount: r.attachment_count,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/feedbacks/export', (req, res, next) => {
    try {
      const { whereSql, params } = buildFeedbackFilters(req.query as Record<string, unknown>);

      const rows = db
        .prepare(
          `SELECT
             f.receipt_code, f.created_at, d.name as department_name,
             f.is_anonymous, f.submitter_name, f.employee_no, f.contact_info,
             f.category, f.feature_category, f.title, f.content, f.status, f.admin_reply, f.updated_at,
             (SELECT COUNT(*) FROM attachments a WHERE a.feedback_id = f.id) as attachment_count
           FROM feedbacks f
           JOIN departments d ON d.id = f.department_id
           ${whereSql}
           ORDER BY f.created_at DESC, f.id DESC
           LIMIT 10000`
        )
        .all(...params) as Array<{
        receipt_code: string;
        created_at: string;
        department_name: string;
        is_anonymous: number;
        submitter_name: string | null;
        employee_no: string | null;
        contact_info: string | null;
        category: string;
        feature_category: string | null;
        title: string;
        content: string;
        status: string;
        admin_reply: string | null;
        updated_at: string;
        attachment_count: number;
      }>;

      const csvRows: FeedbackCsvRow[] = rows.map((r) => ({
        receiptCode: r.receipt_code,
        createdAt: r.created_at,
        departmentName: r.department_name,
        isAnonymous: r.is_anonymous === 1,
        submitterName: r.submitter_name,
        employeeNo: r.employee_no,
        contactInfo: r.contact_info,
        category: r.category,
        featureCategory: r.feature_category,
        title: r.title,
        content: r.content,
        attachmentCount: r.attachment_count,
        status: r.status,
        adminReply: r.admin_reply,
        updatedAt: r.updated_at,
      }));

      const csvContent = buildFeedbackCsv(csvRows);
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="feedbacks-${dateStr}.csv"`);
      res.send(csvContent);
    } catch (err) {
      next(err);
    }
  });

  function loadAdminFeedbackDetail(feedbackId: number) {
    const row = db
      .prepare(
        `SELECT
           f.id, f.receipt_code, f.department_id, d.name as department_name,
           f.category, f.feature_category, f.title, f.content, f.is_anonymous,
           f.submitter_name, f.employee_no, f.contact_info,
           f.status, f.admin_reply, f.created_at, f.updated_at
         FROM feedbacks f
         JOIN departments d ON d.id = f.department_id
         WHERE f.id = ?`
      )
      .get(feedbackId) as
      | {
          id: number;
          receipt_code: string;
          department_id: number;
          department_name: string;
          category: string;
          feature_category: string | null;
          title: string;
          content: string;
          is_anonymous: number;
          submitter_name: string | null;
          employee_no: string | null;
          contact_info: string | null;
          status: string;
          admin_reply: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    const attachments = (
      db
        .prepare(
          `SELECT id, original_name, mime_type, size_bytes, created_at
           FROM attachments
           WHERE feedback_id = ?
           ORDER BY rowid ASC`
        )
        .all(row.id) as Array<{
        id: string;
        original_name: string;
        mime_type: string;
        size_bytes: number;
        created_at: string;
      }>
    ).map((a) => ({
      id: a.id,
      originalName: a.original_name,
      mimeType: a.mime_type,
      sizeBytes: a.size_bytes,
      createdAt: a.created_at,
      url: `/api/attachments/${a.id}`,
      downloadUrl: `/api/attachments/${a.id}?download=1`,
    }));

    const logs = (
      db
        .prepare(
          `SELECT id, from_status, to_status, reply_content, operator_username, created_at
           FROM feedback_logs
           WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`
        )
        .all(row.id) as Array<{
        id: number;
        from_status: string | null;
        to_status: string;
        reply_content: string | null;
        operator_username: string | null;
        created_at: string;
      }>
    ).map((l) => ({
      id: l.id,
      fromStatus: l.from_status,
      toStatus: l.to_status,
      replyContent: l.reply_content,
      operatorUsername: l.operator_username,
      createdAt: l.created_at,
    }));

    return {
      id: row.id,
      receiptCode: row.receipt_code,
      departmentId: row.department_id,
      departmentName: row.department_name,
      category: row.category,
      featureCategory: row.feature_category,
      title: row.title,
      content: row.content,
      isAnonymous: row.is_anonymous === 1,
      submitterName: row.submitter_name,
      employeeNo: row.employee_no,
      contactInfo: row.contact_info,
      status: row.status,
      adminReply: row.admin_reply,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      attachments,
      logs,
    };
  }

  router.get('/feedbacks/:id', (req, res, next) => {
    try {
      const feedbackId = Number(req.params.id);
      if (!Number.isInteger(feedbackId) || feedbackId <= 0) {
        throw new AppError(404, 'FEEDBACK_NOT_FOUND', '意见记录不存在');
      }

      const detail = loadAdminFeedbackDetail(feedbackId);
      if (!detail) {
        throw new AppError(404, 'FEEDBACK_NOT_FOUND', '意见记录不存在');
      }

      res.json({ feedback: detail });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/feedbacks/:id', (req, res, next) => {
    try {
      const feedbackId = Number(req.params.id);
      if (!Number.isInteger(feedbackId) || feedbackId <= 0) {
        throw new AppError(404, 'FEEDBACK_NOT_FOUND', '意见记录不存在');
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const status = typeof body.status === 'string' ? body.status.trim() : '';
      const hasReply = body.adminReply !== undefined;
      const adminReply = typeof body.adminReply === 'string' ? body.adminReply.trim() : '';

      if (!status || !isValidStatus(status)) {
        throw new AppError(400, 'INVALID_STATUS', '无效的处理状态');
      }

      if (adminReply.length > 5000) {
        throw new AppError(400, 'REPLY_TOO_LONG', '回复内容不能超过 5000 个字符');
      }

      const existing = db
        .prepare('SELECT id, status, admin_reply FROM feedbacks WHERE id = ?')
        .get(feedbackId) as { id: number; status: string; admin_reply: string | null } | undefined;

      if (!existing) {
        throw new AppError(404, 'FEEDBACK_NOT_FOUND', '意见记录不存在');
      }

      const nowIso = new Date().toISOString();
      const nextReply = hasReply ? adminReply || null : existing.admin_reply;
      const logReply = hasReply ? adminReply || null : null;

      runInTransaction(db, () => {
        db.prepare('UPDATE feedbacks SET status = ?, admin_reply = ?, updated_at = ? WHERE id = ?').run(
          status,
          nextReply,
          nowIso,
          feedbackId
        );

        db.prepare(
          `INSERT INTO feedback_logs (
             feedback_id, from_status, to_status, reply_content, operator_username, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(feedbackId, existing.status, status, logReply, req.admin?.username ?? 'admin', nowIso);
      });

      const detail = loadAdminFeedbackDetail(feedbackId);
      res.json({ feedback: detail });
    } catch (err) {
      next(err);
    }
  });

  router.get('/departments', (_req, res, next) => {
    try {
      const rows = db
        .prepare(
          `SELECT
             d.id, d.name, d.sort_order, d.is_enabled, d.created_at, d.updated_at,
             (SELECT COUNT(*) FROM feedbacks f WHERE f.department_id = d.id) as feedback_count
           FROM departments d
           ORDER BY d.sort_order ASC, d.id ASC`
        )
        .all() as Array<{
        id: number;
        name: string;
        sort_order: number;
        is_enabled: number;
        created_at: string;
        updated_at: string;
        feedback_count: number;
      }>;

      res.json({
        departments: rows.map((d) => ({
          id: d.id,
          name: d.name,
          sortOrder: d.sort_order,
          isEnabled: d.is_enabled === 1,
          feedbackCount: d.feedback_count,
          createdAt: d.created_at,
          updatedAt: d.updated_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/departments', (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const sortOrder = body.sortOrder !== undefined ? Number(body.sortOrder) : 0;
      const isEnabled = body.isEnabled === undefined ? true : Boolean(body.isEnabled);

      if (!name) {
        throw new AppError(400, 'INVALID_DEPARTMENT_NAME', '部门名称不能为空');
      }
      if (name.length > 50) {
        throw new AppError(400, 'INVALID_DEPARTMENT_NAME', '部门名称不能超过 50 个字符');
      }
      if (!Number.isFinite(sortOrder)) {
        throw new AppError(400, 'INVALID_SORT_ORDER', '排序值必须为数字');
      }

      const nowIso = new Date().toISOString();
      try {
        const result = db
          .prepare(
            `INSERT INTO departments (name, sort_order, is_enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(name, Math.trunc(sortOrder), isEnabled ? 1 : 0, nowIso, nowIso);

        res.status(201).json({
          department: {
            id: Number(result.lastInsertRowid),
            name,
            sortOrder: Math.trunc(sortOrder),
            isEnabled,
            feedbackCount: 0,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        });
      } catch (err) {
        const msg = String((err as Error)?.message ?? '');
        if (msg.includes('UNIQUE constraint failed: departments.name')) {
          throw new AppError(409, 'DUPLICATE_DEPARTMENT', '部门名称已存在');
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  router.patch('/departments/:id', (req, res, next) => {
    try {
      const deptId = Number(req.params.id);
      if (!Number.isInteger(deptId) || deptId <= 0) {
        throw new AppError(404, 'DEPARTMENT_NOT_FOUND', '部门不存在');
      }

      const existing = db
        .prepare('SELECT id, name, sort_order, is_enabled, created_at FROM departments WHERE id = ?')
        .get(deptId) as
        | { id: number; name: string; sort_order: number; is_enabled: number; created_at: string }
        | undefined;

      if (!existing) {
        throw new AppError(404, 'DEPARTMENT_NOT_FOUND', '部门不存在');
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const nextName = body.name !== undefined ? String(body.name).trim() : existing.name;
      const nextSortOrder = body.sortOrder !== undefined ? Number(body.sortOrder) : existing.sort_order;
      const nextEnabled = body.isEnabled !== undefined ? Boolean(body.isEnabled) : existing.is_enabled === 1;

      if (!nextName) {
        throw new AppError(400, 'INVALID_DEPARTMENT_NAME', '部门名称不能为空');
      }
      if (nextName.length > 50) {
        throw new AppError(400, 'INVALID_DEPARTMENT_NAME', '部门名称不能超过 50 个字符');
      }
      if (!Number.isFinite(nextSortOrder)) {
        throw new AppError(400, 'INVALID_SORT_ORDER', '排序值必须为数字');
      }

      const nowIso = new Date().toISOString();
      try {
        db.prepare(
          'UPDATE departments SET name = ?, sort_order = ?, is_enabled = ?, updated_at = ? WHERE id = ?'
        ).run(nextName, Math.trunc(nextSortOrder), nextEnabled ? 1 : 0, nowIso, deptId);
      } catch (err) {
        const msg = String((err as Error)?.message ?? '');
        if (msg.includes('UNIQUE constraint failed: departments.name')) {
          throw new AppError(409, 'DUPLICATE_DEPARTMENT', '部门名称已存在');
        }
        throw err;
      }

      const countRow = db
        .prepare('SELECT COUNT(*) as count FROM feedbacks WHERE department_id = ?')
        .get(deptId) as { count: number };

      res.json({
        department: {
          id: existing.id,
          name: nextName,
          sortOrder: Math.trunc(nextSortOrder),
          isEnabled: nextEnabled,
          feedbackCount: countRow.count,
          createdAt: existing.created_at,
          updatedAt: nowIso,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
