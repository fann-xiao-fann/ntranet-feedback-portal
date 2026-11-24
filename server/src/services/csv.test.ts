import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFeedbackCsv, sanitizeCsvCell } from './csv.js';

describe('CSV export serializer', () => {
  it('neutralizes spreadsheet formula triggers and escapes quotes/commas/newlines', () => {
    assert.equal(sanitizeCsvCell('=CMD|"/C calc"!A0'), '"\'=CMD|""/C calc""!A0"');
    assert.equal(sanitizeCsvCell('+1+2'), "'+1+2");
    assert.equal(sanitizeCsvCell('-SUM(A1:A2)'), "'-SUM(A1:A2)");
    assert.equal(sanitizeCsvCell('@HYPERLINK("http://evil")'), '"\'@HYPERLINK(""http://evil"")"');
    assert.equal(sanitizeCsvCell('line1,\n"line2"'), '"line1,\n""line2"""');
  });

  it('outputs UTF-8 BOM and maps anonymous and status fields properly', () => {
    const csv = buildFeedbackCsv([
      {
        receiptCode: 'FB-20261124-ABC234',
        createdAt: '2026-11-24T09:00:00.000Z',
        departmentName: '研发部',
        isAnonymous: true,
        submitterName: null,
        employeeNo: null,
        contactInfo: null,
        category: '局限性',
        featureCategory: '智能编题',
        title: '=危险标题',
        content: '空调漏水,需要维修\n[[attachment:123e4567-e89b-12d3-a456-426614174000]]',
        attachmentCount: 2,
        status: 'resolved',
        adminReply: '已安排物业修复',
        updatedAt: '2026-11-24T10:00:00.000Z',
      },
    ]);

    assert.equal(csv.startsWith('\uFEFF'), true);
    assert.equal(csv.includes('回执码,提交时间,所属部门'), true);
    assert.equal(csv.includes('匿名'), true);
    assert.equal(csv.includes("'=危险标题"), true);
    assert.equal(csv.includes('"空调漏水,需要维修\n[图片]"'), true);
    assert.equal(csv.includes('已解决'), true);
  });
});
