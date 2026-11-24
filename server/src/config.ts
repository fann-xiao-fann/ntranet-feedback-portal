import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AppConfig {
  port: number;
  dataDir: string;
  dbPath: string;
  uploadsDir: string;
  tmpUploadsDir: string;
  adminUsername: string;
  adminPassword: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  webDistDir: string;
  loginRateLimitMax: number;
  loginRateLimitWindowMs: number;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const defaultDataDir = path.resolve(__dirname, '../../data');
  const dataDir = overrides.dataDir
    ? path.resolve(overrides.dataDir)
    : process.env.DATA_DIR
      ? path.resolve(process.env.DATA_DIR)
      : defaultDataDir;

  const uploadsDir = overrides.uploadsDir ?? path.join(dataDir, 'uploads');
  const tmpUploadsDir = overrides.tmpUploadsDir ?? path.join(uploadsDir, '.tmp');
  const dbPath = overrides.dbPath ?? path.join(dataDir, 'feedback.db');

  return {
    port: overrides.port ?? (Number(process.env.PORT) || 3000),
    dataDir,
    dbPath,
    uploadsDir,
    tmpUploadsDir,
    adminUsername: overrides.adminUsername ?? (process.env.ADMIN_USERNAME?.trim() || 'admin'),
    adminPassword: overrides.adminPassword ?? (process.env.ADMIN_PASSWORD || 'ChangeMe123!'),
    sessionTtlHours: overrides.sessionTtlHours ?? (Number(process.env.SESSION_TTL_HOURS) || 24),
    cookieSecure: overrides.cookieSecure ?? process.env.COOKIE_SECURE === 'true',
    webDistDir: overrides.webDistDir ?? path.resolve(__dirname, '../../web/dist'),
    loginRateLimitMax: overrides.loginRateLimitMax ?? (Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10),
    loginRateLimitWindowMs:
      overrides.loginRateLimitWindowMs ?? (Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000),
  };
}
