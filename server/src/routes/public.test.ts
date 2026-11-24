import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../app.js';
import { TINY_JPEG, TINY_PNG } from '../test-helpers.js';
import { RECEIPT_CODE_REGEX } from '../services/receiptCode.js';

function countNonTempFiles(uploadsDir: string): number {
  let count = 0;
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        count++;
      }
    }
  }
  walk(uploadsDir);
  return count;
}

describe('Public feedback submission, progress lookup, and photo access APIs', () => {
  it('supports department loading, named & anonymous submissions, receipt lookup privacy, photo auth, and orphan cleanup', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-public-test-'));
    const instance = createApp({
      dataDir: tmpDir,
      adminUsername: 'admin',
      adminPassword: 'AdminPassword123!',
    });
    const server = instance.app.listen(0);

    try {
      const { port } = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${port}`;

      // Disable one department directly to verify public /api/departments omits disabled items
      instance.db.prepare("UPDATE departments SET is_enabled = 0 WHERE name = '其他'").run();

      const deptRes = await fetch(`${baseUrl}/api/departments`);
      assert.equal(deptRes.status, 200);
      const deptBody = (await deptRes.json()) as { departments: Array<{ id: number; name: string }> };
      assert.equal(deptBody.departments.some((d) => d.name === '其他'), false);
      const enabledDeptId = deptBody.departments[0].id;

      // 1. Named submission with 2 photos
      const namedForm = new FormData();
      namedForm.append('departmentId', String(enabledDeptId));
      namedForm.append('category', '缺陷');
      namedForm.append('featureCategory', '智能编题');
      namedForm.append('title', '三楼会议室投影仪模糊');
      namedForm.append('content', '三楼大屏接口松动：\n[[photo:0]]\n画面闪烁：\n[[photo:1]]');
      namedForm.append('isAnonymous', 'false');
      namedForm.append('submitterName', '张三');
      namedForm.append('employeeNo', 'E1001');
      namedForm.append('contactInfo', '13800138000');
      namedForm.append('photos', new Blob([TINY_JPEG], { type: 'image/jpeg' }), 'projector.jpg');
      namedForm.append('photos', new Blob([TINY_PNG], { type: 'image/png' }), '../../hack/screen.png');

      const submitRes = await fetch(`${baseUrl}/api/feedbacks`, {
        method: 'POST',
        body: namedForm,
      });
      assert.equal(submitRes.status, 201);
      const submitBody = (await submitRes.json()) as {
        feedback: { id: number; receiptCode: string; status: string; attachmentCount: number };
      };
      assert.match(submitBody.feedback.receiptCode, RECEIPT_CODE_REGEX);
      assert.equal(submitBody.feedback.status, 'pending');
      assert.equal(submitBody.feedback.attachmentCount, 2);

      // 2. Receipt lookup returns summary, photos, timeline, and omits contactInfo
      const lookupRes = await fetch(
        `${baseUrl}/api/feedbacks/lookup/${submitBody.feedback.receiptCode.toLowerCase()}`
      );
      assert.equal(lookupRes.status, 200);
      const lookupBody = (await lookupRes.json()) as {
        feedback: {
          receiptCode: string;
          featureCategory: string | null;
          content: string;
          isAnonymous: boolean;
          submitterName: string | null;
          contactInfo?: string;
          attachments: Array<{ id: string; url: string; originalName: string }>;
          logs: Array<{ toStatus: string }>;
        };
      };
      assert.equal(lookupBody.feedback.featureCategory, '智能编题');
      assert.equal(lookupBody.feedback.submitterName, '张三');
      assert.equal('contactInfo' in lookupBody.feedback, false);
      assert.equal(lookupBody.feedback.attachments.length, 2);
      assert.equal(
        lookupBody.feedback.content.includes(`[[attachment:${lookupBody.feedback.attachments[0].id}]]`),
        true
      );
      assert.equal(
        lookupBody.feedback.content.includes(`[[attachment:${lookupBody.feedback.attachments[1].id}]]`),
        true
      );
      assert.equal(lookupBody.feedback.attachments[1].originalName, 'screen.png');
      assert.equal(lookupBody.feedback.logs.length, 1);
      assert.equal(lookupBody.feedback.logs[0].toStatus, 'pending');

      // 3. Controlled photo access: matching receiptCode => 200, missing/wrong => 403
      const attId = lookupBody.feedback.attachments[0].id;
      const okPhoto = await fetch(`${baseUrl}${lookupBody.feedback.attachments[0].url}`);
      assert.equal(okPhoto.status, 200);
      assert.equal(okPhoto.headers.get('content-type'), 'image/jpeg');
      assert.equal(okPhoto.headers.get('x-content-type-options'), 'nosniff');

      const forbiddenNoCode = await fetch(`${baseUrl}/api/attachments/${attId}`);
      assert.equal(forbiddenNoCode.status, 403);

      const forbiddenWrongCode = await fetch(`${baseUrl}/api/attachments/${attId}?receiptCode=FB-20261124-ZZZZZZ`);
      assert.equal(forbiddenWrongCode.status, 403);

      // 4. Anonymous submission hides all identity fields
      const anonForm = new FormData();
      anonForm.append('departmentId', String(enabledDeptId));
      anonForm.append('category', '交互流程');
      anonForm.append('title', '优化报销审批流程');
      anonForm.append('content', '建议缩短小额差旅报销审批节点。');
      anonForm.append('isAnonymous', 'true');

      const anonRes = await fetch(`${baseUrl}/api/feedbacks`, { method: 'POST', body: anonForm });
      assert.equal(anonRes.status, 201);
      const anonBody = (await anonRes.json()) as { feedback: { receiptCode: string } };
      const anonLookup = await fetch(`${baseUrl}/api/feedbacks/lookup/${anonBody.feedback.receiptCode}`);
      assert.equal(anonLookup.status, 200);
      const anonLookupBody = (await anonLookup.json()) as {
        feedback: { isAnonymous: boolean; submitterName: string | null; employeeNo: string | null };
      };
      assert.equal(anonLookupBody.feedback.isAnonymous, true);
      assert.equal(anonLookupBody.feedback.submitterName, null);
      assert.equal(anonLookupBody.feedback.employeeNo, null);

      // 5. Named submission without name rejected
      const missingNameForm = new FormData();
      missingNameForm.append('departmentId', String(enabledDeptId));
      missingNameForm.append('category', '交互流程');
      missingNameForm.append('title', '测试标题');
      missingNameForm.append('content', '测试内容');
      missingNameForm.append('isAnonymous', 'false');
      const missingNameRes = await fetch(`${baseUrl}/api/feedbacks`, {
        method: 'POST',
        body: missingNameForm,
      });
      assert.equal(missingNameRes.status, 400);

      // 6. Spoofed image upload fails and leaves zero newly orphaned files on disk
      const beforeCount = countNonTempFiles(instance.config.uploadsDir);
      const spoofForm = new FormData();
      spoofForm.append('departmentId', String(enabledDeptId));
      spoofForm.append('category', '缺陷');
      spoofForm.append('title', '伪造图片测试');
      spoofForm.append('content', '包含一张正常图片和一张伪造图片');
      spoofForm.append('isAnonymous', 'true');
      spoofForm.append('photos', new Blob([TINY_JPEG], { type: 'image/jpeg' }), 'ok.jpg');
      spoofForm.append('photos', new Blob(['not real image'], { type: 'image/jpeg' }), 'fake.jpg');

      const spoofRes = await fetch(`${baseUrl}/api/feedbacks`, { method: 'POST', body: spoofForm });
      assert.equal(spoofRes.status, 400);
      assert.equal(countNonTempFiles(instance.config.uploadsDir), beforeCount);

      // 7. Unknown receipt code returns 404
      const notFoundRes = await fetch(`${baseUrl}/api/feedbacks/lookup/FB-20261124-XXXXXX`);
      assert.equal(notFoundRes.status, 404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      instance.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
