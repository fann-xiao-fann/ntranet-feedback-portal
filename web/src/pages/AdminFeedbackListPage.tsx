import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Search,
} from 'lucide-react';
import {
  api,
  ApiError,
  FEATURE_CATEGORIES,
  FEEDBACK_CATEGORIES,
  formatDateTime,
  STATUS_META,
  type AdminDepartment,
  type AdminFeedbackListItem,
  type FeedbackStatus,
} from '../api/client';
import { AdminLayout } from '../components/AdminLayout';
import { StatusBadge } from '../components/StatusBadge';

const STATUSES: FeedbackStatus[] = ['pending', 'in_progress', 'resolved', 'closed'];

export function AdminFeedbackListPage() {
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [items, setItems] = useState<AdminFeedbackListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [featureCategory, setFeatureCategory] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');

  useEffect(() => {
    api
      .adminListDepartments()
      .then((res) => setDepartments(res.departments))
      .catch(() => {
        // AdminLayout handles 401 redirect
      });
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.adminListFeedbacks({
        departmentId,
        status,
        category,
        featureCategory,
        dateFrom,
        dateTo,
        keyword: appliedKeyword,
        page,
        pageSize: 15,
      });
      setItems(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载意见列表失败');
    } finally {
      setLoading(false);
    }
  }, [departmentId, status, category, featureCategory, dateFrom, dateTo, appliedKeyword, page]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setAppliedKeyword(keyword.trim());
  }

  function handleReset() {
    setDepartmentId('');
    setStatus('');
    setCategory('');
    setFeatureCategory('');
    setDateFrom('');
    setDateTo('');
    setKeyword('');
    setAppliedKeyword('');
    setPage(1);
  }

  const exportUrl = api.adminExportUrl({
    departmentId,
    status,
    category,
    featureCategory,
    dateFrom,
    dateTo,
    keyword: appliedKeyword,
  });

  return (
    <AdminLayout>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">各部门意见列表</h1>
          <p className="mt-0.5 text-xs text-slate-500">共筛选出 {total} 条意见记录</p>
        </div>
        <a
          href={exportUrl}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
        >
          <Download className="h-4 w-4" />
          导出当前筛选 CSV
        </a>
      </div>

      {/* Filters */}
      <form
        onSubmit={handleSearchSubmit}
        className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <select
            value={departmentId}
            onChange={(e) => {
              setDepartmentId(e.target.value);
              setPage(1);
            }}
            aria-label="按部门筛选"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">全部部门</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {!d.isEnabled ? '（已停用）' : ''}
              </option>
            ))}
          </select>

          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="按状态筛选"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">全部状态</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>

          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            aria-label="按意见分类筛选"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">全部意见分类</option>
            {FEEDBACK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={featureCategory}
            onChange={(e) => {
              setFeatureCategory(e.target.value);
              setPage(1);
            }}
            aria-label="按功能分类筛选"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">全部功能分类</option>
            {FEATURE_CATEGORIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            aria-label="开始日期"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            aria-label="结束日期"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />

          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="标题/内容/回执码/姓名"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重置筛选
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
          >
            <Search className="h-3.5 w-3.5" />
            搜索
          </button>
        </div>
      </form>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            正在加载...
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">暂无符合条件的意见记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">回执码 / 标题</th>
                  <th className="px-4 py-3">部门 / 分类</th>
                  <th className="px-4 py-3">提交人</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">提交时间</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80">
                    <td className="max-w-md px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                          {item.receiptCode}
                        </code>
                        {item.attachmentCount > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                            <ImageIcon className="h-3 w-3" />
                            {item.attachmentCount}
                          </span>
                        )}
                      </div>
                      <Link
                        to={`/admin/feedbacks/${item.id}`}
                        className="mt-1 block truncate font-medium text-slate-900 hover:text-blue-600"
                      >
                        {item.title}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5">
                      <div className="font-medium text-slate-800">{item.departmentName}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                        <span>{item.category}</span>
                        {item.featureCategory && (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700">
                            {item.featureCategory}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-xs text-slate-600">
                      {item.isAnonymous ? (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-500">匿名</span>
                      ) : (
                        <div>
                          <div className="font-medium text-slate-800">{item.submitterName}</div>
                          {item.employeeNo && <div className="text-slate-400">{item.employeeNo}</div>}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-xs text-slate-500">
                      {formatDateTime(item.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right">
                      <Link
                        to={`/admin/feedbacks/${item.id}`}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                      >
                        查看与处理
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
            <span>
              第 {page} / {totalPages} 页 · 共 {total} 条
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                上一页
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-40"
              >
                下一页
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
