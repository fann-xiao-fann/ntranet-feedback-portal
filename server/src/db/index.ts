import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config.js';
import { hashPassword } from '../services/password.js';

export const DEFAULT_DEPARTMENTS = [
  { name: '研发部', sortOrder: 10 },
  { name: '产品部', sortOrder: 20 },
  { name: '运营部', sortOrder: 30 },
  { name: '市场部', sortOrder: 40 },
  { name: '综合行政部', sortOrder: 50 },
  { name: '财务部', sortOrder: 60 },
  { name: '人事部', sortOrder: 70 },
  { name: '其他', sortOrder: 100 },
];

export function initDatabase(config: AppConfig): DatabaseSync {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  fs.mkdirSync(config.tmpUploadsDir, { recursive: true });

  const db = new DatabaseSync(config.dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_code TEXT NOT NULL UNIQUE,
      department_id INTEGER NOT NULL REFERENCES departments(id),
      category TEXT NOT NULL,
      feature_category TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      submitter_name TEXT,
      employee_no TEXT,
      contact_info TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_reply TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_feedbacks_dept ON feedbacks(department_id);
    CREATE INDEX IF NOT EXISTS idx_feedbacks_status ON feedbacks(status);
    CREATE INDEX IF NOT EXISTS idx_feedbacks_created ON feedbacks(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_feedbacks_receipt ON feedbacks(receipt_code);

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      feedback_id INTEGER NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_rel_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_attachments_feedback ON attachments(feedback_id);

    CREATE TABLE IF NOT EXISTS feedback_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feedback_id INTEGER NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      reply_content TEXT,
      operator_username TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_logs_feedback ON feedback_logs(feedback_id, created_at);

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
  `);

  // Idempotent migration for existing databases created before feature_category existed
  const feedbackCols = db.prepare('PRAGMA table_info(feedbacks)').all() as Array<{ name: string }>;
  if (!feedbackCols.some((c) => c.name === 'feature_category')) {
    db.exec('ALTER TABLE feedbacks ADD COLUMN feature_category TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_feedbacks_feature_category ON feedbacks(feature_category);');

  seedInitialData(db, config);

  return db;
}

function seedInitialData(db: DatabaseSync, config: AppConfig): void {
  const now = new Date().toISOString();

  const deptCount = (db.prepare('SELECT COUNT(*) as count FROM departments').get() as { count: number }).count;
  if (deptCount === 0) {
    const insertDept = db.prepare(
      'INSERT INTO departments (name, sort_order, is_enabled, created_at, updated_at) VALUES (?, ?, 1, ?, ?)'
    );
    runInTransaction(db, () => {
      for (const dept of DEFAULT_DEPARTMENTS) {
        insertDept.run(dept.name, dept.sortOrder, now, now);
      }
    });
  }

  const adminCount = (db.prepare('SELECT COUNT(*) as count FROM admin_users').get() as { count: number }).count;
  if (adminCount === 0) {
    const passwordHash = hashPassword(config.adminPassword);
    db.prepare(
      'INSERT INTO admin_users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(config.adminUsername, passwordHash, now, now);
  }
}

export function runInTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback errors if transaction already aborted
    }
    throw err;
  }
}
