import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../app.js';
import { TINY_PNG } from '../test-helpers.js';

function extractCookie(setCookieHeader: string | null): string {
  assert.ok(setCookieHeader, 'Expected Set-Cookie header');
  return setCookieHeader.split(';')[0];
}

describe('Admin authentication, feedback management, department management, and CSV export APIs', () => {
  it('covers login/logout/401/429, filtering, status reply timeline, admin photo download, department lifecycle, and CSV export', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-admin-test-'));
    const instance = createApp({
      dataDir: tmpDir,
      adminUsername: 'admin',
      adminPassword: 'StrongPassword!2026',
      loginRateLimitMax: 3,
      loginRateLimitWindowMs: 60_000,
    });
    const server = instance.app.listen(0);

    try {
      const { port } = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${port}`;

      // 1. Unauthenticated requests rejected with 401
      const unauthMe = await fetch(`${baseUrl}/api/admin/me`);
      assert.equal(unauthMe.status, 401);
      const unauthList = await fetch(`${baseUrl}/api/admin/feedbacks`);
      assert.equal(unauthList.status, 401);

      // 2. Rate limiting after 3 failed login attempts => 4th returns 429
      for (let i = 0; i < 3; i++) {
        const badRes = await fetch(`${baseUrl}/api/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'wrong' }),
        });
        assert.equal(badRes.status, 401);
      }
      const throttledRes = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'StrongPassword!2026' }),
      });
      assert.equal(throttledRes.status, 429);

      // Start a fresh app with normal rate limit for authenticated workflow tests
      await new Promise<void>((resolve) => server.close(() => resolve()));
      instance.close();

      const instance2 = createApp({
        dataDir: tmpDir,
        adminUsername: 'admin',
        adminPassword: 'StrongPassword!2026',
      });
      const server2 = instance2.app.listen(0);

      try {
        const { port: port2 } = server2.address() as AddressInfo;
        const url2 = `http://127.0.0.1:${port2}`;

        // Seed two feedback records via public endpoint
        const deptRes = await fetch(`${url2}/api/departments`);
        const { departments } = (await deptRes.json()) as { departments: Array<{ id: number; name: string }> };
        const deptA = departments[0];
        const deptB = departments[1];

        const f1 = new FormData();
        f1.append('departmentId', String(deptA.id));
        f1.append('category', '缺陷');
        f1.append('title', '=消防通道堆物');
        f1.append('content', '二楼东侧消防门前有纸箱堆积');
        f1.append('isAnonymous', 'false');
        f1.append('submitterName', '李四');
        f1.append('contactInfo', 'lisi@company.local');
        f1.append('photos', new Blob([TINY_PNG], { type: 'image/png' }), 'fire-exit.png');

        const s1 = await fetch(`${url2}/api/feedbacks`, { method: 'POST', body: f1 });
        assert.equal(s1.status, 201);
        const s1Body = (await s1.json()) as { feedback: { id: number; receiptCode: string } };

        const f2 = new FormData();
        f2.append('departmentId', String(deptB.id));
        f2.append('category', '交互流程');
        f2.append('title', '内网OA移动端适配');
        f2.append('content', '审批按钮在窄屏手机上容易误触');
        f2.append('isAnonymous', 'true');
        const s2 = await fetch(`${url2}/api/feedbacks`, { method: 'POST', body: f2 });
        assert.equal(s2.status, 201);

        // Login as admin
        const loginRes = await fetch(`${url2}/api/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'StrongPassword!2026' }),
        });
        assert.equal(loginRes.status, 200);
        const setCookie = loginRes.headers.get('set-cookie');
        assert.ok(setCookie?.toLowerCase().includes('httponly'));
        assert.ok(setCookie?.toLowerCase().includes('samesite=lax'));
        const cookie = extractCookie(setCookie);

        // /me works
        const meRes = await fetch(`${url2}/api/admin/me`, { headers: { Cookie: cookie } });
        assert.equal(meRes.status, 200);
        const meBody = (await meRes.json()) as { admin: { username: string } };
        assert.equal(meBody.admin.username, 'admin');

        // Filter by department & keyword
        const listRes = await fetch(
          `${url2}/api/admin/feedbacks?departmentId=${deptA.id}&status=pending&keyword=${encodeURIComponent('消防')}`,
          { headers: { Cookie: cookie } }
        );
        assert.equal(listRes.status, 200);
        const listBody = (await listRes.json()) as { total: number; items: Array<{ id: number; title: string }> };
        assert.equal(listBody.total, 1);
        assert.equal(listBody.items[0].id, s1Body.feedback.id);

        // Inspect detail & download photo as admin
        const detailRes = await fetch(`${url2}/api/admin/feedbacks/${s1Body.feedback.id}`, {
          headers: { Cookie: cookie },
        });
        assert.equal(detailRes.status, 200);
        const detailBody = (await detailRes.json()) as {
          feedback: {
            contactInfo: string;
            attachments: Array<{ downloadUrl: string }>;
          };
        };
        assert.equal(detailBody.feedback.contactInfo, 'lisi@company.local');
        assert.equal(detailBody.feedback.attachments.length, 1);

        const dlRes = await fetch(`${url2}${detailBody.feedback.attachments[0].downloadUrl}`, {
          headers: { Cookie: cookie },
        });
        assert.equal(dlRes.status, 200);
        assert.equal(dlRes.headers.get('content-type'), 'image/png');
        assert.ok(dlRes.headers.get('content-disposition')?.includes('attachment'));

        // Reject invalid status
        const badPatch = await fetch(`${url2}/api/admin/feedbacks/${s1Body.feedback.id}`, {
          method: 'PATCH',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'unknown_status' }),
        });
        assert.equal(badPatch.status, 400);

        // Transition pending -> in_progress -> resolved with replies
        const patch1 = await fetch(`${url2}/api/admin/feedbacks/${s1Body.feedback.id}`, {
          method: 'PATCH',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'in_progress', adminReply: '已通知行政部现场核查' }),
        });
        assert.equal(patch1.status, 200);

        const patch2 = await fetch(`${url2}/api/admin/feedbacks/${s1Body.feedback.id}`, {
          method: 'PATCH',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'resolved', adminReply: '纸箱已清理完毕，消防通道畅通' }),
        });
        assert.equal(patch2.status, 200);

        // Verify employee lookup sees chronological timeline
        const lookupAfter = await fetch(`${url2}/api/feedbacks/lookup/${s1Body.feedback.receiptCode}`);
        assert.equal(lookupAfter.status, 200);
        const lookupAfterBody = (await lookupAfter.json()) as {
          feedback: { status: string; adminReply: string; logs: Array<{ toStatus: string }> };
        };
        assert.equal(lookupAfterBody.feedback.status, 'resolved');
        assert.equal(lookupAfterBody.feedback.adminReply, '纸箱已清理完毕，消防通道畅通');
        assert.deepEqual(
          lookupAfterBody.feedback.logs.map((l) => l.toStatus),
          ['pending', 'in_progress', 'resolved']
        );

        // CSV export filtered to resolved records with BOM & formula neutralization
        const csvRes = await fetch(`${url2}/api/admin/feedbacks/export?status=resolved`, {
          headers: { Cookie: cookie },
        });
        assert.equal(csvRes.status, 200);
        const csvBuf = Buffer.from(await csvRes.arrayBuffer());
        assert.deepEqual(Array.from(csvBuf.subarray(0, 3)), [0xef, 0xbb, 0xbf]);
        const csvText = csvBuf.subarray(3).toString('utf8');
        assert.equal(csvText.includes("'=消防通道堆物"), true);
        assert.equal(csvText.includes('内网OA移动端适配'), false);

        // Department management: create, duplicate 409, disable while preserving historical feedback
        const createDept = await fetch(`${url2}/api/admin/departments`, {
          method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '法务部', sortOrder: 80 }),
        });
        assert.equal(createDept.status, 201);

        const dupDept = await fetch(`${url2}/api/admin/departments`, {
          method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '法务部' }),
        });
        assert.equal(dupDept.status, 409);

        const disableDept = await fetch(`${url2}/api/admin/departments/${deptA.id}`, {
          method: 'PATCH',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ isEnabled: false }),
        });
        assert.equal(disableDept.status, 200);

        // Disabled department hidden on public /api/departments, but historical feedback retains its name
        const pubDeptsAfter = await fetch(`${url2}/api/departments`);
        const pubDeptsAfterBody = (await pubDeptsAfter.json()) as {
          departments: Array<{ id: number }>;
        };
        assert.equal(pubDeptsAfterBody.departments.some((d) => d.id === deptA.id), false);

        const histDetail = await fetch(`${url2}/api/admin/feedbacks/${s1Body.feedback.id}`, {
          headers: { Cookie: cookie },
        });
        const histDetailBody = (await histDetail.json()) as { feedback: { departmentName: string } };
        assert.equal(histDetailBody.feedback.departmentName, deptA.name);

        // Logout invalidates session
        const logoutRes = await fetch(`${url2}/api/admin/logout`, {
          method: 'POST',
          headers: { Cookie: cookie },
        });
        assert.equal(logoutRes.status, 200);
        const afterLogoutMe = await fetch(`${url2}/api/admin/me`, { headers: { Cookie: cookie } });
        assert.equal(afterLogoutMe.status, 401);
      } finally {
        await new Promise<void>((resolve) => server2.close(() => resolve()));
        instance2.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
