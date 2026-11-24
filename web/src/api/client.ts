export type FeedbackStatus = 'pending' | 'in_progress' | 'resolved' | 'closed';

export const FEEDBACK_CATEGORIES = ['交互流程', '局限性', '缺陷', '其他'] as const;

export const FEATURE_CATEGORIES = [
  'RAG管理',
  '资料检索',
  '考试大纲',
  '题库管理',
  '智能编题',
  '智能改题',
  '智能审核',
  '人工审核',
  'Agent与模型',
] as const;

export const STATUS_META: Record<
  FeedbackStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  pending: {
    label: '待处理',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    dotClass: 'bg-amber-500',
  },
  in_progress: {
    label: '处理中',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    dotClass: 'bg-blue-500',
  },
  resolved: {
    label: '已解决',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotClass: 'bg-emerald-500',
  },
  closed: {
    label: '已关闭',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
    dotClass: 'bg-slate-400',
  },
};

export interface DepartmentOption {
  id: number;
  name: string;
  sortOrder: number;
}

export interface AdminDepartment extends DepartmentOption {
  isEnabled: boolean;
  feedbackCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AttachmentItem {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  url: string;
  downloadUrl?: string;
}

export interface FeedbackLogItem {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  replyContent: string | null;
  operatorUsername?: string | null;
  createdAt: string;
}

export interface PublicFeedbackDetail {
  receiptCode: string;
  departmentName: string;
  category: string;
  featureCategory: string | null;
  title: string;
  content: string;
  isAnonymous: boolean;
  submitterName: string | null;
  employeeNo: string | null;
  status: FeedbackStatus;
  adminReply: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: AttachmentItem[];
  logs: FeedbackLogItem[];
}

export interface AdminFeedbackListItem {
  id: number;
  receiptCode: string;
  departmentId: number;
  departmentName: string;
  category: string;
  featureCategory: string | null;
  title: string;
  content: string;
  isAnonymous: boolean;
  submitterName: string | null;
  employeeNo: string | null;
  contactInfo: string | null;
  status: FeedbackStatus;
  adminReply: string | null;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminFeedbackDetail extends Omit<AdminFeedbackListItem, 'attachmentCount'> {
  attachments: AttachmentItem[];
  logs: FeedbackLogItem[];
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, string>;

  constructor(status: number, code: string, message: string, details?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
  });

  const data = (await res.json().catch(() => null)) as
    | { error?: { code?: string; message?: string; details?: Record<string, string> } }
    | T
    | null;

  if (!res.ok) {
    const errObj = (data as { error?: { code?: string; message?: string; details?: Record<string, string> } })
      ?.error;
    throw new ApiError(
      res.status,
      errObj?.code || 'REQUEST_FAILED',
      errObj?.message || `请求失败 (${res.status})`,
      errObj?.details
    );
  }

  return data as T;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const api = {
  getPublicDepartments: () =>
    requestJson<{
      departments: DepartmentOption[];
      categories: string[];
      featureCategories: string[];
    }>('/api/departments'),

  submitFeedback: (formData: FormData) =>
    requestJson<{
      feedback: {
        id: number;
        receiptCode: string;
        departmentName: string;
        status: FeedbackStatus;
        attachmentCount: number;
        createdAt: string;
      };
    }>('/api/feedbacks', {
      method: 'POST',
      body: formData,
    }),

  lookupFeedback: (receiptCode: string) =>
    requestJson<{ feedback: PublicFeedbackDetail }>(
      `/api/feedbacks/lookup/${encodeURIComponent(receiptCode.trim())}`
    ),

  adminLogin: (username: string, password: string) =>
    requestJson<{ admin: { id: number; username: string } }>('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),

  adminLogout: () =>
    requestJson<{ ok: boolean }>('/api/admin/logout', {
      method: 'POST',
    }),

  adminMe: () => requestJson<{ admin: { id: number; username: string } }>('/api/admin/me'),

  adminListFeedbacks: (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') {
        search.set(k, String(v));
      }
    }
    const qs = search.toString();
    return requestJson<{
      items: AdminFeedbackListItem[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>(`/api/admin/feedbacks${qs ? `?${qs}` : ''}`);
  },

  adminExportUrl: (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') {
        search.set(k, String(v));
      }
    }
    const qs = search.toString();
    return `/api/admin/feedbacks/export${qs ? `?${qs}` : ''}`;
  },

  adminGetFeedback: (id: number) =>
    requestJson<{ feedback: AdminFeedbackDetail }>(`/api/admin/feedbacks/${id}`),

  adminUpdateFeedback: (id: number, payload: { status: FeedbackStatus; adminReply?: string }) =>
    requestJson<{ feedback: AdminFeedbackDetail }>(`/api/admin/feedbacks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  adminListDepartments: () =>
    requestJson<{ departments: AdminDepartment[] }>('/api/admin/departments'),

  adminCreateDepartment: (payload: { name: string; sortOrder: number; isEnabled: boolean }) =>
    requestJson<{ department: AdminDepartment }>('/api/admin/departments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  adminUpdateDepartment: (
    id: number,
    payload: { name?: string; sortOrder?: number; isEnabled?: boolean }
  ) =>
    requestJson<{ department: AdminDepartment }>(`/api/admin/departments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
};
