import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Download,
  Image as ImageIcon,
  Loader2,
  Save,
  User,
} from 'lucide-react';
import {
  api,
  ApiError,
  formatDateTime,
  STATUS_META,
  type AdminFeedbackDetail,
  type AttachmentItem,
  type FeedbackStatus,
} from '../api/client';
import { AdminLayout } from '../components/AdminLayout';
import { PhotoLightbox } from '../components/PhotoLightbox';
import { getReferencedAttachmentIds, RichContentViewer } from '../components/RichContentViewer';
import { StatusBadge } from '../components/StatusBadge';

const STATUSES: FeedbackStatus[] = ['pending', 'in_progress', 'resolved', 'closed'];

export function AdminFeedbackDetailPage() {
  const { id } = useParams<{ id: string }>();
  const feedbackId = Number(id);

  const [detail, setDetail] = useState<AdminFeedbackDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<FeedbackStatus>('pending');
  const [adminReply, setAdminReply] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<AttachmentItem | null>(null);

  useEffect(() => {
    if (!Number.isInteger(feedbackId) || feedbackId <= 0) {
      setError('无效的意见编号');
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    api
      .adminGetFeedback(feedbackId)
      .then((res) => {
        if (!active) return;
        setDetail(res.feedback);
        setStatus(res.feedback.status);
        setAdminReply(res.feedback.adminReply ?? '');
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof ApiError ? err.message : '加载意见详情失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [feedbackId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      const res = await api.adminUpdateFeedback(detail.id, {
        status,
        adminReply: adminReply.trim(),
      });
      setDetail(res.feedback);
      setStatus(res.feedback.status);
      setAdminReply(res.feedback.adminReply ?? '');
      setSaveMessage('已保存处理状态和回复，员工端回执查询已同步更新');
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminLayout>
      <div className="mb-4">
        <Link
          to="/admin/feedbacks"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          返回意见列表
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-slate-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          正在加载详情...
        </div>
      ) : error || !detail ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error || '意见记录不存在'}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-4">
          {/* Left: Content & Photos */}
          <div className="space-y-5 lg:col-span-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">
                  {detail.receiptCode}
                </code>
                <StatusBadge status={detail.status} />
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {detail.departmentName}
                </span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {detail.category}
                </span>
                {detail.featureCategory && (
                  <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                    {detail.featureCategory}
                  </span>
                )}
              </div>

              <h1 className="mt-3 text-xl font-bold text-slate-900">{detail.title}</h1>

              <div className="mt-3 flex flex-wrap items-center gap-4 border-b border-slate-100 pb-4 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />
                  {detail.isAnonymous
                    ? '匿名员工'
                    : `${detail.submitterName || ''}${detail.employeeNo ? ` · 工号 ${detail.employeeNo}` : ''}${detail.contactInfo ? ` · 联系 ${detail.contactInfo}` : ''}`}
                </span>
                <span>提交于 {formatDateTime(detail.createdAt)}</span>
                <span>更新于 {formatDateTime(detail.updatedAt)}</span>
              </div>

              <div className="mt-4">
                <RichContentViewer
                  content={detail.content}
                  attachments={detail.attachments}
                  onPreviewPhoto={setPreviewPhoto}
                  showDownloadButton
                />
              </div>

              {(() => {
                const referencedIds = getReferencedAttachmentIds(detail.content);
                const extraAttachments = detail.attachments.filter((att) => !referencedIds.has(att.id));
                if (extraAttachments.length === 0) return null;
                return (
                  <div className="mt-6 border-t border-slate-100 pt-5">
                    <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                      <ImageIcon className="h-4 w-4 text-blue-600" />
                      其他照片附件（{extraAttachments.length} 张）
                    </div>
                    <div className="space-y-4">
                      {extraAttachments.map((att) => (
                        <div
                          key={att.id}
                          className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white"
                        >
                          <button
                            type="button"
                            onClick={() => setPreviewPhoto(att)}
                            className="block w-full cursor-zoom-in bg-white"
                          >
                            <img src={att.url} alt="意见图片" className="block h-auto w-full" />
                          </button>
                          {att.downloadUrl && (
                            <a
                              href={att.downloadUrl}
                              className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-lg bg-slate-900/75 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-slate-900"
                              title="下载原图"
                            >
                              <Download className="h-3.5 w-3.5" />
                              下载
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Processing History */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Clock className="h-4 w-4 text-slate-500" />
                处理日志时间线
              </h2>
              <ol className="mt-4 space-y-4 border-l-2 border-slate-200 pl-5">
                {detail.logs.map((log) => {
                  const toLabel = STATUS_META[log.toStatus as FeedbackStatus]?.label ?? log.toStatus;
                  return (
                    <li key={log.id} className="relative">
                      <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-slate-900" />
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-slate-900">
                          {log.fromStatus === null ? '员工提交意见' : `状态变更 → ${toLabel}`}
                        </span>
                        {log.operatorUsername && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                            操作人：{log.operatorUsername}
                          </span>
                        )}
                        <span className="text-slate-400">{formatDateTime(log.createdAt)}</span>
                      </div>
                      {log.replyContent && (
                        <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                          {log.replyContent}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>

          {/* Right: Status & Reply Form */}
          <div>
            <form
              onSubmit={handleSave}
              className="sticky top-20 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
            >
              <h2 className="text-base font-semibold text-slate-900">处理与官方回复</h2>

              <div>
                <label htmlFor="admin-status" className="block text-xs font-medium text-slate-700">
                  处理状态
                </label>
                <select
                  id="admin-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as FeedbackStatus)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_META[s].label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="admin-reply" className="block text-xs font-medium text-slate-700">
                  官方回复（员工凭回执码可见）
                </label>
                <textarea
                  id="admin-reply"
                  rows={6}
                  maxLength={5000}
                  value={adminReply}
                  onChange={(e) => setAdminReply(e.target.value)}
                  placeholder="请输入跟进进度、处理结果或整改说明..."
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {saveError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}

              {saveMessage && (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{saveMessage}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存处理结果
              </button>
            </form>
          </div>
        </div>
      )}

      <PhotoLightbox photo={previewPhoto} onClose={() => setPreviewPhoto(null)} />
    </AdminLayout>
  );
}
