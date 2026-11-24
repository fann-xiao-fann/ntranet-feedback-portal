import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Clock,
  Image as ImageIcon,
  Loader2,
  MessageSquareText,
  Search,
} from 'lucide-react';
import {
  api,
  ApiError,
  formatDateTime,
  STATUS_META,
  type AttachmentItem,
  type FeedbackStatus,
  type PublicFeedbackDetail,
} from '../api/client';
import { PhotoLightbox } from '../components/PhotoLightbox';
import { PublicLayout } from '../components/PublicLayout';
import { getReferencedAttachmentIds, RichContentViewer } from '../components/RichContentViewer';
import { StatusBadge } from '../components/StatusBadge';

export function LookupFeedbackPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCode = searchParams.get('code') ?? '';

  const [codeInput, setCodeInput] = useState(initialCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicFeedbackDetail | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<AttachmentItem | null>(null);

  async function doLookup(code: string) {
    const trimmed = code.trim();
    if (!trimmed) {
      setError('请输入回执码');
      setResult(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await api.lookupFeedback(trimmed);
      setResult(res.feedback);
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : '查询失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialCode) {
      void doLookup(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = codeInput.trim().toUpperCase();
    setCodeInput(trimmed);
    if (trimmed) {
      setSearchParams({ code: trimmed });
    }
    void doLookup(trimmed);
  }

  return (
    <PublicLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">查询意见处理进度</h1>
        <p className="mt-1 text-sm text-slate-600">
          输入提交成功后获得的回执码（如 <code className="font-mono text-slate-800">FB-20261124-ABC234</code>），即可查看当前状态与管理员回复。
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:flex-row sm:p-5"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="请输入回执码，例如 FB-20261124-XXXXXX"
            className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-4 font-mono text-sm uppercase text-slate-900 placeholder:font-sans placeholder:normal-case placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          查询进度
        </button>
      </form>

      {error && (
        <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-5">
          {/* Summary Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">
                    {result.receiptCode}
                  </code>
                  <StatusBadge status={result.status} />
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {result.departmentName}
                  </span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {result.category}
                  </span>
                  {result.featureCategory && (
                    <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                      {result.featureCategory}
                    </span>
                  )}
                </div>
                <h2 className="mt-2.5 text-lg font-semibold text-slate-900">{result.title}</h2>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>提交时间：{formatDateTime(result.createdAt)}</div>
                <div className="mt-1">
                  提交人：
                  {result.isAnonymous
                    ? '匿名员工'
                    : `${result.submitterName || ''}${result.employeeNo ? ` (${result.employeeNo})` : ''}`}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <RichContentViewer
                content={result.content}
                attachments={result.attachments}
                onPreviewPhoto={setPreviewPhoto}
              />
            </div>

            {(() => {
              const referencedIds = getReferencedAttachmentIds(result.content);
              const extraAttachments = result.attachments.filter((att) => !referencedIds.has(att.id));
              if (extraAttachments.length === 0) return null;
              return (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <div className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <ImageIcon className="h-3.5 w-3.5" />
                    其他照片附件（{extraAttachments.length} 张，点击查看大图）
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    {extraAttachments.map((att) => (
                      <button
                        key={att.id}
                        type="button"
                        onClick={() => setPreviewPhoto(att)}
                        className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-left focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <img
                          src={att.url}
                          alt={att.originalName}
                          className="h-24 w-full object-cover transition-transform group-hover:scale-105"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Official Reply Highlight */}
          {result.adminReply && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                  <MessageSquareText className="h-4 w-4 text-emerald-600" />
                  管理员最新回复
                </div>
                <span className="text-xs text-emerald-700">
                  更新于 {formatDateTime(result.updatedAt)}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-emerald-950">
                {result.adminReply}
              </p>
            </div>
          )}

          {/* Chronological Timeline */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Clock className="h-4 w-4 text-slate-500" />
              处理进度记录
            </h3>
            <ol className="mt-4 space-y-4 border-l-2 border-slate-200 pl-5">
              {result.logs.map((log) => {
                const statusLabel =
                  STATUS_META[log.toStatus as FeedbackStatus]?.label ?? log.toStatus;
                return (
                  <li key={log.id} className="relative">
                    <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-blue-600 shadow-xs" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">
                        {log.fromStatus === null ? '已提交意见' : `状态更新为「${statusLabel}」`}
                      </span>
                      <span className="text-xs text-slate-400">{formatDateTime(log.createdAt)}</span>
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
      )}

      <PhotoLightbox photo={previewPhoto} onClose={() => setPreviewPhoto(null)} />
    </PublicLayout>
  );
}
