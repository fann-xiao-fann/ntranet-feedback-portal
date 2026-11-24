import type { NextFunction, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from './errorHandler.js';
import { hashToken } from '../services/password.js';

export const ADMIN_SESSION_COOKIE = 'fp_admin_session';

export interface AuthenticatedAdmin {
  id: number;
  username: string;
}

declare global {
  namespace Express {
    interface Request {
      admin?: AuthenticatedAdmin;
    }
  }
}

export function getAuthenticatedAdmin(req: Request, db: DatabaseSync): AuthenticatedAdmin | null {
  const token = req.cookies?.[ADMIN_SESSION_COOKIE];
  if (!token || typeof token !== 'string') {
    return null;
  }

  const tokenHash = hashToken(token);
  const nowIso = new Date().toISOString();

  const row = db
    .prepare(
      `SELECT u.id, u.username, s.expires_at
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as { id: number; username: string; expires_at: string } | undefined;

  if (!row) {
    return null;
  }

  if (row.expires_at <= nowIso) {
    db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }

  return { id: row.id, username: row.username };
}

export function requireAdmin(db: DatabaseSync) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const admin = getAuthenticatedAdmin(req, db);
    if (!admin) {
      next(new AppError(401, 'UNAUTHORIZED', '请先登录管理员账号'));
      return;
    }
    req.admin = admin;
    next();
  };
}

export class LoginRateLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts: number, windowMs: number) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  private prune(ip: string, now: number): number[] {
    const list = this.attempts.get(ip) ?? [];
    const cutoff = now - this.windowMs;
    const active = list.filter((ts) => ts > cutoff);
    if (active.length === 0) {
      this.attempts.delete(ip);
    } else {
      this.attempts.set(ip, active);
    }
    return active;
  }

  public isBlocked(ip: string, now = Date.now()): boolean {
    const active = this.prune(ip, now);
    return active.length >= this.maxAttempts;
  }

  public recordFailure(ip: string, now = Date.now()): void {
    const active = this.prune(ip, now);
    active.push(now);
    this.attempts.set(ip, active);
  }

  public reset(ip: string): void {
    this.attempts.delete(ip);
  }
}
