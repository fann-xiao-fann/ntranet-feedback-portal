import cookieParser from 'cookie-parser';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { loadConfig, type AppConfig } from './config.js';
import { initDatabase } from './db/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createAdminRouter } from './routes/admin.js';
import { createPublicRouter } from './routes/public.js';

export interface AppInstance {
  app: express.Express;
  db: DatabaseSync;
  config: AppConfig;
  close: () => void;
}

export function createApp(overrides: Partial<AppConfig> = {}): AppInstance {
  const config = loadConfig(overrides);
  const db = initDatabase(config);
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res, next) => {
    try {
      const row = db.prepare('SELECT 1 as ok').get() as { ok: number };
      res.json({
        status: row?.ok === 1 ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', createPublicRouter(db, config));
  app.use('/api/admin', createAdminRouter(db, config));

  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: '接口不存在',
      },
    });
  });

  // Serve built frontend SPA in production when web/dist exists
  const indexHtmlPath = path.join(config.webDistDir, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    app.use(express.static(config.webDistDir));
    app.get('*', (_req, res) => {
      res.sendFile(indexHtmlPath);
    });
  }

  app.use(errorHandler);

  return {
    app,
    db,
    config,
    close: () => {
      db.close();
    },
  };
}
