import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../middleware/errorHandler.js';

export const MAX_PHOTO_COUNT = 5;
export const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface DetectedImageType {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  ext: '.jpg' | '.png' | '.webp';
}

export interface StagedAttachment {
  id: string;
  originalName: string;
  storedRelPath: string;
  absolutePath: string;
  mimeType: DetectedImageType['mimeType'];
  sizeBytes: number;
}

export function detectImageTypeFromBuffer(header: Buffer): DetectedImageType | null {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return { mimeType: 'image/jpeg', ext: '.jpg' };
  }
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  ) {
    return { mimeType: 'image/png', ext: '.png' };
  }
  if (
    header.length >= 12 &&
    header.subarray(0, 4).toString('ascii') === 'RIFF' &&
    header.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', ext: '.webp' };
  }
  return null;
}

export function detectImageTypeFromFile(filePath: string): DetectedImageType | null {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, buf, 0, 12, 0);
    return detectImageTypeFromBuffer(buf.subarray(0, bytesRead));
  } finally {
    fs.closeSync(fd);
  }
}

export function sanitizeOriginalFilename(rawName: string, fallbackExt: string): string {
  // Decode multer's default latin1 filename back to UTF-8 when valid UTF-8 bytes were latin1-decoded
  let decoded = rawName;
  if (rawName && !/[^\x00-\xff]/.test(rawName)) {
    const asUtf8 = Buffer.from(rawName, 'latin1').toString('utf8');
    if (!asUtf8.includes('\ufffd')) {
      decoded = asUtf8;
    }
  }
  // Strip any directory components across POSIX & Windows separators
  const normalized = decoded.replace(/\\/g, '/');
  const base = path.posix.basename(normalized);
  const cleaned = base
    .replace(/\.\./g, '')
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_')
    .trim();

  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return `photo${fallbackExt}`;
  }

  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
}

export function resolveSafeUploadPath(uploadsDir: string, storedRelPath: string): string {
  const root = path.resolve(uploadsDir);
  const resolved = path.resolve(root, storedRelPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new AppError(403, 'INVALID_ATTACHMENT_PATH', '非法的附件路径');
  }
  return resolved;
}

export function cleanupFiles(filePaths: string[]): void {
  for (const filePath of filePaths) {
    if (!filePath) continue;
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        console.warn(`Failed to cleanup file ${filePath}:`, err);
      }
    }
  }
}

function moveFileSafe(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'EXDEV') {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }
}

export function validateAndStagePhotos(
  files: Express.Multer.File[],
  uploadsDir: string,
  now = new Date()
): { staged: StagedAttachment[]; cleanup: () => void } {
  const trackedPaths = new Set<string>(files.map((f) => f.path).filter(Boolean));
  const cleanup = (): void => {
    cleanupFiles(Array.from(trackedPaths));
  };

  if (files.length > MAX_PHOTO_COUNT) {
    cleanup();
    throw new AppError(400, 'TOO_MANY_FILES', `单次最多上传 ${MAX_PHOTO_COUNT} 张照片`);
  }

  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const subDirRel = path.posix.join(year, month);
  const subDirAbs = resolveSafeUploadPath(uploadsDir, subDirRel);

  const staged: StagedAttachment[] = [];

  try {
    for (const file of files) {
      if (file.size <= 0) {
        throw new AppError(400, 'EMPTY_FILE', '上传的图片文件为空');
      }
      if (file.size > MAX_PHOTO_SIZE_BYTES) {
        throw new AppError(400, 'FILE_TOO_LARGE', '单张照片大小不能超过 10 MB');
      }

      const detected = detectImageTypeFromFile(file.path);
      if (!detected) {
        throw new AppError(400, 'UNSUPPORTED_IMAGE_TYPE', '仅支持上传 JPEG、PNG 或 WebP 格式的真实图片');
      }

      fs.mkdirSync(subDirAbs, { recursive: true });
      const id = crypto.randomUUID();
      const storedRelPath = path.posix.join(subDirRel, `${id}${detected.ext}`);
      const absolutePath = resolveSafeUploadPath(uploadsDir, storedRelPath);

      moveFileSafe(file.path, absolutePath);
      trackedPaths.delete(file.path);
      trackedPaths.add(absolutePath);

      staged.push({
        id,
        originalName: sanitizeOriginalFilename(file.originalname || '', detected.ext),
        storedRelPath,
        absolutePath,
        mimeType: detected.mimeType,
        sizeBytes: file.size,
      });
    }
  } catch (err) {
    cleanup();
    throw err;
  }

  return { staged, cleanup };
}
