import { FEEDBACK_STATUS_LABELS, type FeedbackStatus } from './constants.js';

export interface FeedbackCsvRow {
  receiptCode: string;
  createdAt: string;
  departmentName: string;
  isAnonymous: boolean;
  submitterName: string | null;
  employeeNo: string | null;
  contactInfo: string | null;
  category: string;
  featureCategory: string | null;
  title: string;
  content: string;
  attachmentCount: number;
  status: string;
  adminReply: string | null;
  updatedAt: string;
}

const FORMULA_TRIGGER_REGEX = /^[=+\-@\t\r]/;

export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  let text = String(value);
  if (FORMULA_TRIGGER_REGEX.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildFeedbackCsv(rows: FeedbackCsvRow[]): string {
  const headers = [
    '回执码',
    '提交时间',
    '所属部门',
    '提交人',
    '工号',
    '联系方式',
    '意见分类',
    '功能分类',
    '意见标题',
    '意见内容',
    '照片数量',
    '处理状态',
    '管理员回复',
    '最后更新时间',
  ];

  const lines: string[] = [headers.map(sanitizeCsvCell).join(',')];

  for (const row of rows) {
    const submitterLabel = row.isAnonymous ? '匿名' : row.submitterName || '';
    const statusLabel = FEEDBACK_STATUS_LABELS[row.status as FeedbackStatus] ?? row.status;
    const readableContent = row.content.replace(/\[\[attachment:[0-9a-f-]+\]\]/gi, '[图片]');
    const cells = [
      row.receiptCode,
      row.createdAt,
      row.departmentName,
      submitterLabel,
      row.isAnonymous ? '' : row.employeeNo || '',
      row.isAnonymous ? '' : row.contactInfo || '',
      row.category,
      row.featureCategory || '',
      row.title,
      readableContent,
      row.attachmentCount,
      statusLabel,
      row.adminReply || '',
      row.updatedAt,
    ];
    lines.push(cells.map(sanitizeCsvCell).join(','));
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
