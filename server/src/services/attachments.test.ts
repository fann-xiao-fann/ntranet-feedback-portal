import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  detectImageTypeFromBuffer,
  MAX_PHOTO_SIZE_BYTES,
  resolveSafeUploadPath,
  sanitizeOriginalFilename,
  validateAndStagePhotos,
} from './attachments.js';

import { TINY_JPEG, TINY_PNG, TINY_WEBP } from '../test-helpers.js';

function createMockMulterFile(tmpDir: string, originalname: string, content: Buffer, fakeSize?: number) {
  const filePath = path.join(tmpDir, `tmp-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(filePath, content);
  return {
    fieldname: 'photos',
    originalname,
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: fakeSize ?? content.length,
    destination: tmpDir,
    filename: path.basename(filePath),
    path: filePath,
    buffer: content,
    stream: null as unknown as NodeJS.ReadableStream,
  } as unknown as Express.Multer.File;
}

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

describe('Photo attachment validation, safe storage, and cleanup', () => {
  it('detects JPEG, PNG, and WebP magic bytes and rejects non-images', () => {
    assert.deepEqual(detectImageTypeFromBuffer(TINY_JPEG), { mimeType: 'image/jpeg', ext: '.jpg' });
    assert.deepEqual(detectImageTypeFromBuffer(TINY_PNG), { mimeType: 'image/png', ext: '.png' });
    assert.deepEqual(detectImageTypeFromBuffer(TINY_WEBP), { mimeType: 'image/webp', ext: '.webp' });
    assert.equal(detectImageTypeFromBuffer(Buffer.from('<html>not an image</html>')), null);
  });

  it('sanitizes path traversal filenames and enforces uploads-root path containment', () => {
    const sanitized = sanitizeOriginalFilename('../../etc/passwd.png', '.png');
    assert.equal(sanitized, 'passwd.png');
    assert.equal(sanitized.includes('..'), false);
    assert.equal(sanitized.includes('/'), false);

    const root = path.join(os.tmpdir(), 'uploads-root-test');
    assert.throws(() => resolveSafeUploadPath(root, '../../etc/passwd'), /非法的附件路径/);
  });

  it('stages valid photos under YYYY/MM/<uuid>.<ext> and rolls back cleanly when cleanup() is invoked', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-stage-'));
    const uploadsDir = path.join(tmpDir, 'uploads');
    const rawTmp = path.join(uploadsDir, '.tmp');
    fs.mkdirSync(rawTmp, { recursive: true });

    try {
      const f1 = createMockMulterFile(rawTmp, '../../etc/passwd.png', TINY_PNG);
      const f2 = createMockMulterFile(rawTmp, 'scene.webp', TINY_WEBP);
      const { staged, cleanup } = validateAndStagePhotos([f1, f2], uploadsDir, new Date('2026-11-24T00:00:00Z'));

      assert.equal(staged.length, 2);
      assert.match(staged[0].storedRelPath, /^2026\/11\/[0-9a-f-]+\.png$/);
      assert.equal(staged[0].originalName, 'passwd.png');
      assert.equal(fs.existsSync(staged[0].absolutePath), true);
      assert.equal(staged[1].mimeType, 'image/webp');

      cleanup();
      assert.equal(listFilesRecursive(uploadsDir).length, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects spoofed image files and removes already-staged files from the same request', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-spoof-'));
    const uploadsDir = path.join(tmpDir, 'uploads');
    const rawTmp = path.join(uploadsDir, '.tmp');
    fs.mkdirSync(rawTmp, { recursive: true });

    try {
      const validFirst = createMockMulterFile(rawTmp, 'valid.jpg', TINY_JPEG);
      const spoofedSecond = createMockMulterFile(rawTmp, 'evil.jpg', Buffer.from('plain text disguised as jpg'));

      assert.throws(
        () => validateAndStagePhotos([validFirst, spoofedSecond], uploadsDir),
        /仅支持上传 JPEG、PNG 或 WebP/
      );
      assert.equal(listFilesRecursive(uploadsDir).length, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects oversized files and counts above 5', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-limits-'));
    const uploadsDir = path.join(tmpDir, 'uploads');
    const rawTmp = path.join(uploadsDir, '.tmp');
    fs.mkdirSync(rawTmp, { recursive: true });

    try {
      const tooBig = createMockMulterFile(rawTmp, 'huge.jpg', TINY_JPEG, MAX_PHOTO_SIZE_BYTES + 1);
      assert.throws(() => validateAndStagePhotos([tooBig], uploadsDir), /不能超过 10 MB/);
      assert.equal(listFilesRecursive(uploadsDir).length, 0);

      const sixFiles = Array.from({ length: 6 }, (_, i) =>
        createMockMulterFile(rawTmp, `p${i}.jpg`, TINY_JPEG)
      );
      assert.throws(() => validateAndStagePhotos(sixFiles, uploadsDir), /最多上传 5 张/);
      assert.equal(listFilesRecursive(uploadsDir).length, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
