import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadConfig } from '../config.js';
import { DEFAULT_DEPARTMENTS, initDatabase } from './index.js';
import { verifyPassword } from '../services/password.js';

describe('SQLite database initialization and seeding', () => {
  it('initializes schema, pragmas, and default seeds on fresh boot and stays idempotent on restart', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-db-test-'));
    try {
      const config = loadConfig({
        dataDir: tmpDir,
        adminUsername: 'superadmin',
        adminPassword: 'SecretPassword!99',
      });

      const db1 = initDatabase(config);
      const journalMode = (db1.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;
      assert.equal(journalMode.toLowerCase(), 'wal');

      const foreignKeys = (db1.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys;
      assert.equal(foreignKeys, 1);

      const depts = db1.prepare('SELECT name, is_enabled FROM departments ORDER BY sort_order').all() as Array<{
        name: string;
        is_enabled: number;
      }>;
      assert.equal(depts.length, DEFAULT_DEPARTMENTS.length);
      assert.equal(depts[0].name, DEFAULT_DEPARTMENTS[0].name);

      const admin = db1
        .prepare('SELECT username, password_hash FROM admin_users WHERE username = ?')
        .get('superadmin') as { username: string; password_hash: string };
      assert.equal(admin.username, 'superadmin');
      assert.equal(verifyPassword('SecretPassword!99', admin.password_hash), true);
      assert.equal(verifyPassword('wrong', admin.password_hash), false);
      db1.close();

      // Re-initialize on existing database: must be idempotent
      const db2 = initDatabase(config);
      const deptCount = (db2.prepare('SELECT COUNT(*) as count FROM departments').get() as { count: number }).count;
      const adminCount = (db2.prepare('SELECT COUNT(*) as count FROM admin_users').get() as { count: number }).count;
      assert.equal(deptCount, DEFAULT_DEPARTMENTS.length);
      assert.equal(adminCount, 1);
      db2.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
