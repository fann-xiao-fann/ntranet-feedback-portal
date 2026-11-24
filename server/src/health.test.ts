import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from './app.js';

describe('GET /api/health', () => {
  it('returns 200 with healthy database status', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-health-test-'));
    const instance = createApp({ dataDir: tmpDir });
    const server = instance.app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { status: string; timestamp: string };
      assert.equal(body.status, 'ok');
      assert.ok(body.timestamp);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      instance.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
