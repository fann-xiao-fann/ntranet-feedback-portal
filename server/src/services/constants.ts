export const FEEDBACK_CATEGORIES = [
  '交互流程',
  '局限性',
  '缺陷',
  '其他',
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

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

export type FeatureCategory = (typeof FEATURE_CATEGORIES)[number];

export const FEEDBACK_STATUSES = ['pending', 'in_progress', 'resolved', 'closed'] as const;

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  pending: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

export function isValidCategory(value: string): value is FeedbackCategory {
  return (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}

export function isValidFeatureCategory(value: string): value is FeatureCategory {
  return (FEATURE_CATEGORIES as readonly string[]).includes(value);
}

export function isValidStatus(value: string): value is FeedbackStatus {
  return (FEEDBACK_STATUSES as readonly string[]).includes(value);
}
