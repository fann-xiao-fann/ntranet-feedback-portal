import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Plus, Save } from 'lucide-react';
import { api, ApiError, type AdminDepartment } from '../api/client';
import { AdminLayout } from '../components/AdminLayout';

interface DraftDept {
  name: string;
  sortOrder: string;
}

export function AdminDepartmentsPage() {
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [drafts, setDrafts] = useState<Record<number, DraftDept>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newSortOrder, setNewSortOrder] = useState('90');
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);

  async function loadDepartments() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.adminListDepartments();
      setDepartments(res.departments);
      const nextDrafts: Record<number, DraftDept> = {};
      for (const d of res.departments) {
        nextDrafts[d.id] = { name: d.name, sortOrder: String(d.sortOrder) };
      }
      setDrafts(nextDrafts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载部门列表失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDepartments();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!newName.trim()) {
      setError('请输入新部门名称');
      return;
    }

    setCreating(true);
    try {
      await api.adminCreateDepartment({
        name: newName.trim(),
        sortOrder: Number(newSortOrder) || 0,
        isEnabled: true,
      });
      setNewName('');
      setNotice('已新增部门');
      await loadDepartments();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '新增部门失败');
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveRow(dept: AdminDepartment) {
    const draft = drafts[dept.id];
    if (!draft) return;
    setError(null);
    setNotice(null);
    setSavingId(dept.id);
    try {
      await api.adminUpdateDepartment(dept.id, {
        name: draft.name.trim(),
        sortOrder: Number(draft.sortOrder) || 0,
      });
      setNotice(`已保存「${draft.name.trim()}」`);
      await loadDepartments();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存部门失败');
    } finally {
      setSavingId(null);
    }
  }

  async function handleToggleEnabled(dept: AdminDepartment) {
    setError(null);
    setNotice(null);
    setSavingId(dept.id);
    try {
      await api.adminUpdateDepartment(dept.id, { isEnabled: !dept.isEnabled });
      setNotice(
        !dept.isEnabled
          ? `已启用「${dept.name}」`
          : `已停用「${dept.name}」（历史意见记录仍保留该部门归属）`
      );
      await loadDepartments();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '更新状态失败');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AdminLayout>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">部门选项配置</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          管理员工提交页面显示的部门列表；停用部门不会影响历史已提交的意见记录。
        </p>
      </div>

      {/* Create form */}
      <form
        onSubmit={handleCreate}
        className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <label htmlFor="new-dept-name" className="block text-xs font-medium text-slate-700">
            新增部门名称
          </label>
          <input
            id="new-dept-name"
            type="text"
            maxLength={50}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="例如：质检部、供应链部"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div className="w-full sm:w-32">
          <label htmlFor="new-dept-sort" className="block text-xs font-medium text-slate-700">
            排序值（越小越靠前）
          </label>
          <input
            id="new-dept-sort"
            type="number"
            value={newSortOrder}
            onChange={(e) => setNewSortOrder(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={creating}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          新增部门
        </button>
      </form>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {notice && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {notice}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        {loading ? (
          <div className="flex items-center justify-center py-14 text-sm text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            正在加载...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">部门名称</th>
                  <th className="px-4 py-3">排序值</th>
                  <th className="px-4 py-3">关联意见数</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {departments.map((dept) => {
                  const draft = drafts[dept.id] ?? {
                    name: dept.name,
                    sortOrder: String(dept.sortOrder),
                  };
                  const busy = savingId === dept.id;
                  return (
                    <tr key={dept.id}>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={draft.name}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [dept.id]: { ...draft, name: e.target.value },
                            }))
                          }
                          className="w-full max-w-xs rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          value={draft.sortOrder}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [dept.id]: { ...draft, sortOrder: e.target.value },
                            }))
                          }
                          className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{dept.feedbackCount} 条</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            dept.isEnabled
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {dept.isEnabled ? '已启用' : '已停用'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleSaveRow(dept)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <Save className="h-3.5 w-3.5" />
                            保存
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleToggleEnabled(dept)}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${
                              dept.isEnabled
                                ? 'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                                : 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            {dept.isEnabled ? '停用' : '启用'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
