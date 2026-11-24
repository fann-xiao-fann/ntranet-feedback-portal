import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Send,
} from 'lucide-react';
import { api, ApiError, type DepartmentOption } from '../api/client';
import { PublicLayout } from '../components/PublicLayout';
import { RichFeedbackEditor, type RichEditorValue } from '../components/RichFeedbackEditor';

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to textarea copy for plain HTTP intranet origins
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

const EMPTY_EDITOR_VALUE: RichEditorValue = {
  content: '',
  plainTextLength: 0,
  files: [],
};

export function SubmitFeedbackPage() {
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [featureCategories, setFeatureCategories] = useState<string[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  const [departmentId, setDepartmentId] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [featureCategory, setFeatureCategory] = useState<string>('');
  const [title, setTitle] = useState('');
  const [editorValue, setEditorValue] = useState<RichEditorValue>(EMPTY_EDITOR_VALUE);
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [submitterName, setSubmitterName] = useState('');
  const [employeeNo, setEmployeeNo] = useState('');
  const [contactInfo, setContactInfo] = useState('');

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [receipt, setReceipt] = useState<{
    receiptCode: string;
    departmentName: string;
    attachmentCount: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleEditorChange = useCallback((value: RichEditorValue) => {
    setEditorValue(value);
  }, []);

  useEffect(() => {
    let active = true;
    api
      .getPublicDepartments()
      .then((res) => {
        if (!active) return;
        setDepartments(res.departments);
        setCategories(res.categories);
        setFeatureCategories(res.featureCategories ?? []);
        if (res.departments.length > 0) {
          setDepartmentId(String(res.departments[0].id));
        }
        if (res.categories.length > 0) {
          setCategory(res.categories[0]);
        }
      })
      .catch((err) => {
        if (!active) return;
        setInitError(err instanceof Error ? err.message : '加载部门列表失败');
      })
      .finally(() => {
        if (active) setLoadingInit(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function resetForm() {
    setFeatureCategory('');
    setTitle('');
    setEditorValue(EMPTY_EDITOR_VALUE);
    setEditorResetKey((k) => k + 1);
    setSubmitterName('');
    setEmployeeNo('');
    setContactInfo('');
    setIsAnonymous(false);
    setSubmitError(null);
    setReceipt(null);
    setCopied(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!departmentId) {
      setSubmitError('请选择所属部门');
      return;
    }
    if (!title.trim()) {
      setSubmitError('请填写意见标题');
      return;
    }
    if (!editorValue.content.trim()) {
      setSubmitError('请填写详细意见内容或插入相关图片');
      return;
    }
    if (editorValue.plainTextLength > 5000) {
      setSubmitError('意见文字内容不能超过 5000 个字符');
      return;
    }
    if (!isAnonymous && !submitterName.trim()) {
      setSubmitError('请填写您的姓名，或开启「匿名提交」');
      return;
    }

    const formData = new FormData();
    formData.append('departmentId', departmentId);
    formData.append('category', category);
    if (featureCategory) {
      formData.append('featureCategory', featureCategory);
    }
    formData.append('title', title.trim());
    formData.append('content', editorValue.content.trim());
    formData.append('isAnonymous', isAnonymous ? 'true' : 'false');
    if (!isAnonymous) {
      formData.append('submitterName', submitterName.trim());
      if (employeeNo.trim()) formData.append('employeeNo', employeeNo.trim());
      if (contactInfo.trim()) formData.append('contactInfo', contactInfo.trim());
    }
    for (const file of editorValue.files) {
      formData.append('photos', file);
    }

    setSubmitting(true);
    try {
      const res = await api.submitFeedback(formData);
      setReceipt({
        receiptCode: res.feedback.receiptCode,
        departmentName: res.feedback.departmentName,
        attachmentCount: res.feedback.attachmentCount,
      });
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : '提交失败，请检查网络后重试');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopyReceipt() {
    if (!receipt) return;
    const ok = await copyText(receipt.receiptCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  if (receipt) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h1 className="mt-4 text-xl font-semibold text-slate-900">意见已提交成功</h1>
            <p className="mt-1.5 text-sm text-slate-600">
              所属部门：{receipt.departmentName}
              {receipt.attachmentCount > 0 ? ` · 已附 ${receipt.attachmentCount} 张图片` : ''}
            </p>

            <div className="mt-6 w-full rounded-xl border border-blue-200 bg-blue-50/70 p-4">
              <div className="text-xs font-medium text-blue-700">您的专属查询回执码（请妥善保存）</div>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
                <code className="font-mono text-xl font-bold tracking-wider text-blue-950 sm:text-2xl">
                  {receipt.receiptCode}
                </code>
                <button
                  type="button"
                  onClick={handleCopyReceipt}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-blue-700"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? '已复制' : '一键复制'}
                </button>
              </div>
              <p className="mt-2 text-xs text-blue-700/80">
                免登录凭此回执码即可随时查询处理进度和管理员回复
              </p>
            </div>

            <div className="mt-6 flex w-full flex-col gap-3 sm:flex-row">
              <Link
                to={`/lookup?code=${encodeURIComponent(receipt.receiptCode)}`}
                className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-slate-800"
              >
                立即查看进度
              </Link>
              <button
                type="button"
                onClick={resetForm}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                继续提交新意见
              </button>
            </div>
          </div>
        </div>
      </PublicLayout>
    );
  }

  const noDepartmentsAvailable = !loadingInit && !initError && departments.length === 0;

  return (
    <PublicLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">提交意见与建议</h1>
        <p className="mt-1 text-sm text-slate-600">
          无需登录即可向公司提交跨部门工作建议或产品问题，支持图文混排与直接粘贴截图。
        </p>
      </div>

      {initError && (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{initError}</span>
        </div>
      )}

      {noDepartmentsAvailable && (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>当前暂无可用部门选项，意见提交暂不可用，请联系管理员在后台启用部门。</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-7"
      >
        {/* Department & Category */}
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="departmentId" className="block text-sm font-medium text-slate-800">
              所属部门 <span className="text-red-500">*</span>
            </label>
            <select
              id="departmentId"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              disabled={loadingInit || noDepartmentsAvailable}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100"
            >
              {loadingInit && <option value="">正在加载部门...</option>}
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="block text-sm font-medium text-slate-800">
              意见分类 <span className="text-red-500">*</span>
            </span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {categories.map((cat) => {
                const selected = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      selected
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Feature Category */}
        {featureCategories.length > 0 && (
          <div>
            <div className="flex items-center justify-between">
              <span className="block text-sm font-medium text-slate-800">功能分类</span>
              <span className="text-xs text-slate-400">
                {featureCategory ? `已选：${featureCategory}（再次点击可取消）` : '可选，涉及具体系统模块时选择'}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {featureCategories.map((feat) => {
                const selected = featureCategory === feat;
                return (
                  <button
                    key={feat}
                    type="button"
                    onClick={() => setFeatureCategory(selected ? '' : feat)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      selected
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {feat}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Title */}
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="title" className="block text-sm font-medium text-slate-800">
              意见标题 <span className="text-red-500">*</span>
            </label>
            <span className={`text-xs ${title.length > 100 ? 'text-red-600' : 'text-slate-400'}`}>
              {title.length} / 100
            </span>
          </div>
          <input
            id="title"
            type="text"
            maxLength={100}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="请简要概括您的意见或发现的问题（如：智能编题生成结果公式显示异常）"
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        {/* Rich Text + Inline Image Editor */}
        <RichFeedbackEditor resetKey={editorResetKey} onChange={handleEditorChange} />

        {/* Identity / Anonymous toggle */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-800">提交人信息</div>
              <div className="text-xs text-slate-500">
                {isAnonymous
                  ? '已开启匿名提交，系统不会记录您的姓名、工号或联系方式'
                  : '实名提交便于管理员进一步沟通核实，公开查进度页不会展示联系方式'}
              </div>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={isAnonymous}
                onChange={(e) => setIsAnonymous(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>匿名提交</span>
            </label>
          </div>

          {!isAnonymous && (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="submitterName" className="block text-xs font-medium text-slate-700">
                  姓名 <span className="text-red-500">*</span>
                </label>
                <input
                  id="submitterName"
                  type="text"
                  maxLength={50}
                  value={submitterName}
                  onChange={(e) => setSubmitterName(e.target.value)}
                  placeholder="请输入姓名"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label htmlFor="employeeNo" className="block text-xs font-medium text-slate-700">
                  工号（选填）
                </label>
                <input
                  id="employeeNo"
                  type="text"
                  maxLength={50}
                  value={employeeNo}
                  onChange={(e) => setEmployeeNo(e.target.value)}
                  placeholder="如 E1001"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label htmlFor="contactInfo" className="block text-xs font-medium text-slate-700">
                  联系方式（选填）
                </label>
                <input
                  id="contactInfo"
                  type="text"
                  maxLength={100}
                  value={contactInfo}
                  onChange={(e) => setContactInfo(e.target.value)}
                  placeholder="分机号 / 手机 / 邮箱"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
          )}
        </div>

        {submitError && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || loadingInit || noDepartmentsAvailable}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在提交...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                提交意见
              </>
            )}
          </button>
        </div>
      </form>
    </PublicLayout>
  );
}
