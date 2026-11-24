import express from 'express';
import fs from 'node:fs';
import multer from 'multer';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config.js';
import { runInTransaction } from '../db/index.js';
import { getAuthenticatedAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  cleanupFiles,
  MAX_PHOTO_COUNT,
  MAX_PHOTO_SIZE_BYTES,
  resolveSafeUploadPath,
  validateAndStagePhotos,
} from '../services/attachments.js';
import {
  FEATURE_CATEGORIES,
  FEEDBACK_CATEGORIES,
  isValidCategory,
  isValidFeatureCategory,
} from '../services/constants.js';
import { generateReceiptCode, normalizeReceiptCode, RECEIPT_CODE_REGEX } from '../services/receiptCode.js';

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    return lowered === 'true' || lowered === '1' || lowered === 'yes' || lowered === 'on';
  }
  return false;
}

export function createPublicRouter(db: DatabaseSync, config: AppConfig): express.Router {
  const router = express.Router();

  const upload = multer({
    dest: config.tmpUploadsDir,
    limits: {
      fileSize: MAX_PHOTO_SIZE_BYTES,
      files: MAX_PHOTO_COUNT,
      fields: 20,
    },
  });

  router.get('/departments', (_req, res, next) => {
    try {
      const rows = db
        .prepare(
          `SELECT id, name, sort_order as sortOrder
           FROM departments
           WHERE is_enabled = 1
           ORDER BY sort_order ASC, id ASC`
        )
        .all() as Array<{ id: number; name: string; sortOrder: number }>;

      res.json({
        departments: rows,
        categories: FEEDBACK_CATEGORIES,
        featureCategories: FEATURE_CATEGORIES,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/feedbacks', upload.array('photos', MAX_PHOTO_COUNT), (req, res, next) => {
    const uploadedFiles = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];
    const cleanupRawUploads = (): void => cleanupFiles(uploadedFiles.map((f) => f.path));

    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const departmentId = Number(body.departmentId);
      const category = typeof body.category === 'string' ? body.category.trim() : '';
      const featureCategory = typeof body.featureCategory === 'string' ? body.featureCategory.trim() : '';
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const content = typeof body.content === 'string' ? body.content.trim() : '';
      const isAnonymous = parseBooleanFlag(body.isAnonymous);
      const submitterName = !isAnonymous && typeof body.submitterName === 'string' ? body.submitterName.trim() : '';
      const employeeNo = !isAnonymous && typeof body.employeeNo === 'string' ? body.employeeNo.trim() : '';
      const contactInfo = !isAnonymous && typeof body.contactInfo === 'string' ? body.contactInfo.trim() : '';

      const fieldErrors: Record<string, string> = {};

      if (!Number.isInteger(departmentId) || departmentId <= 0) {
        fieldErrors.departmentId = '请选择所属部门';
      }
      if (!category || !isValidCategory(category)) {
        fieldErrors.category = '请选择有效的意见分类';
      }
      if (featureCategory && !isValidFeatureCategory(featureCategory)) {
        fieldErrors.featureCategory = '请选择有效的功能分类';
      }
      if (!title) {
        fieldErrors.title = '请填写意见标题';
      } else if (title.length > 100) {
        fieldErrors.title = '意见标题不能超过 100 个字符';
      }
      if (!content) {
        fieldErrors.content = '请填写意见详细内容';
      } else if (content.length > 5000) {
        fieldErrors.content = '意见内容不能超过 5000 个字符';
      }
      if (!isAnonymous && !submitterName) {
        fieldErrors.submitterName = '请填写姓名，或开启匿名提交';
      } else if (submitterName.length > 50) {
        fieldErrors.submitterName = '姓名不能超过 50 个字符';
      }
      if (employeeNo.length > 50) {
        fieldErrors.employeeNo = '工号不能超过 50 个字符';
      }
      if (contactInfo.length > 100) {
        fieldErrors.contactInfo = '联系方式不能超过 100 个字符';
      }

      if (Object.keys(fieldErrors).length > 0) {
        cleanupRawUploads();
        throw new AppError(400, 'VALIDATION_ERROR', Object.values(fieldErrors)[0], fieldErrors);
      }

      const dept = db
        .prepare('SELECT id, name FROM departments WHERE id = ? AND is_enabled = 1')
        .get(departmentId) as { id: number; name: string } | undefined;

      if (!dept) {
        cleanupRawUploads();
        throw new AppError(400, 'INVALID_DEPARTMENT', '所选部门不存在或已停用');
      }

      const { staged, cleanup } = validateAndStagePhotos(uploadedFiles, config.uploadsDir);
      const resolvedContent = content.replace(/\[\[photo:(\d+)\]\]/g, (match, indexStr: string) => {
        const idx = Number(indexStr);
        if (Number.isInteger(idx) && idx >= 0 && idx < staged.length) {
          return `[[attachment:${staged[idx].id}]]`;
        }
        return match;
      });
      const nowIso = new Date().toISOString();

      try {
        let created: { id: number; receiptCode: string } | null = null;

        for (let attempt = 0; attempt < 5; attempt++) {
          const receiptCode = generateReceiptCode();
          try {
            created = runInTransaction(db, () => {
              const insertFeedback = db
                .prepare(
                  `INSERT INTO feedbacks (
                     receipt_code, department_id, category, feature_category, title, content,
                     is_anonymous, submitter_name, employee_no, contact_info,
                     status, admin_reply, created_at, updated_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`
                )
                .run(
                  receiptCode,
                  dept.id,
                  category,
                  featureCategory || null,
                  title,
                  resolvedContent,
                  isAnonymous ? 1 : 0,
                  isAnonymous ? null : submitterName,
                  isAnonymous ? null : employeeNo || null,
                  isAnonymous ? null : contactInfo || null,
                  nowIso,
                  nowIso
                );

              const feedbackId = Number(insertFeedback.lastInsertRowid);

              const insertAttachment = db.prepare(
                `INSERT INTO attachments (
                   id, feedback_id, original_name, stored_rel_path, mime_type, size_bytes, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`
              );
              for (const att of staged) {
                insertAttachment.run(
                  att.id,
                  feedbackId,
                  att.originalName,
                  att.storedRelPath,
                  att.mimeType,
                  att.sizeBytes,
                  nowIso
                );
              }

              db.prepare(
                `INSERT INTO feedback_logs (
                   feedback_id, from_status, to_status, reply_content, operator_username, created_at
                 ) VALUES (?, NULL, 'pending', NULL, NULL, ?)`
              ).run(feedbackId, nowIso);

              return { id: feedbackId, receiptCode };
            });
            break;
          } catch (dbErr) {
            const msg = String((dbErr as Error)?.message ?? '');
            if (msg.includes('UNIQUE constraint failed: feedbacks.receipt_code') && attempt < 4) {
              continue;
            }
            throw dbErr;
          }
        }

        if (!created) {
          throw new AppError(500, 'RECEIPT_GENERATION_FAILED', '生成回执码失败，请重试');
        }

        res.status(201).json({
          feedback: {
            id: created.id,
            receiptCode: created.receiptCode,
            departmentName: dept.name,
            featureCategory: featureCategory || null,
            status: 'pending',
            attachmentCount: staged.length,
            createdAt: nowIso,
          },
        });
      } catch (err) {
        cleanup();
        throw err;
      }
    } catch (err) {
      cleanupRawUploads();
      next(err);
    }
  });

  router.get('/feedbacks/lookup/:receiptCode', (req, res, next) => {
    try {
      const normalized = normalizeReceiptCode(req.params.receiptCode || '');
      if (!RECEIPT_CODE_REGEX.test(normalized)) {
        throw new AppError(404, 'FEEDBACK_NOT_FOUND', '未找到对应回执码的意见记录，请核对后重试');
      }

      const row = db
        .prepare(
          `SELECT
             f.id, f.receipt_code, f.category, f.feature_category, f.title, f.content,
             f.is_anonymous, f.submitter_name, f.employee_no,
             f.status, f.admin_reply, f.created_at, f.updated_at,
             d.name as department_name
           FROM feedbacks f
           JOIN departments d ON d.id = f.department_id
           WHERE f.receipt_code = ?`
        )
        .get(normalized) as
        | {
            id: number;
            receipt_code: string;
            category: string;
            feature_category: string | null;
            title: string;
            content: string;
            is_anonymous: number;
            submitter_name: string | null;
            employee_no: string | null;
            status: string;
            admin_reply: string | null;
            created_at: string;
            updated_at: string;
            department_name: string;
          }
        | undefined;

      if (!row) {
        throw new AppError(404, 'FEEDBACK_NOT_FOUND', '未找到对应回执码的意见记录，请核对后重试');
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
        url: `/api/attachments/${a.id}?receiptCode=${encodeURIComponent(row.receipt_code)}`,
      }));

      const logs = (
        db
          .prepare(
            `SELECT id, from_status, to_status, reply_content, created_at
             FROM feedback_logs
             WHERE feedback_id = ?
             ORDER BY created_at ASC, id ASC`
          )
          .all(row.id) as Array<{
          id: number;
          from_status: string | null;
          to_status: string;
          reply_content: string | null;
          created_at: string;
        }>
      ).map((l) => ({
        id: l.id,
        fromStatus: l.from_status,
        toStatus: l.to_status,
        replyContent: l.reply_content,
        createdAt: l.created_at,
      }));

      const isAnonymous = row.is_anonymous === 1;

      res.json({
        feedback: {
          receiptCode: row.receipt_code,
          departmentName: row.department_name,
          category: row.category,
          featureCategory: row.feature_category,
          title: row.title,
          content: row.content,
          isAnonymous,
          submitterName: isAnonymous ? null : row.submitter_name,
          employeeNo: isAnonymous ? null : row.employee_no,
          status: row.status,
          adminReply: row.admin_reply,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          attachments,
          logs,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/attachments/:id', (req, res, next) => {
    try {
      const attachmentId = (req.params.id || '').trim();
      if (!attachmentId) {
        throw new AppError(404, 'ATTACHMENT_NOT_FOUND', '附件不存在');
      }

      const row = db
        .prepare(
          `SELECT a.id, a.original_name, a.stored_rel_path, a.mime_type, f.receipt_code
           FROM attachments a
           JOIN feedbacks f ON f.id = a.feedback_id
           WHERE a.id = ?`
        )
        .get(attachmentId) as
        | {
            id: string;
            original_name: string;
            stored_rel_path: string;
            mime_type: string;
            receipt_code: string;
          }
        | undefined;

      if (!row) {
        throw new AppError(404, 'ATTACHMENT_NOT_FOUND', '附件不存在');
      }

      const admin = getAuthenticatedAdmin(req, db);
      const queryCode =
        typeof req.query.receiptCode === 'string' ? normalizeReceiptCode(req.query.receiptCode) : '';

      if (!admin && queryCode !== row.receipt_code) {
        throw new AppError(403, 'FORBIDDEN', '无权访问该照片附件');
      }

      const absPath = resolveSafeUploadPath(config.uploadsDir, row.stored_rel_path);
      if (!fs.existsSync(absPath)) {
        throw new AppError(404, 'ATTACHMENT_FILE_MISSING', '附件文件已不存在');
      }

      res.setHeader('Content-Type', row.mime_type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=3600');

      const wantsDownload = req.query.download === '1' || req.query.download === 'true';
      if (wantsDownload) {
        const asciiFallback = row.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'photo';
        const encoded = encodeURIComponent(row.original_name);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
        );
      }

      const stream = fs.createReadStream(absPath);
      stream.on('error', (streamErr) => next(streamErr));
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
