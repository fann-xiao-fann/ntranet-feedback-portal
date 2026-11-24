import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Building2,
  ClipboardList,
  ExternalLink,
  Loader2,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api/client';

interface AdminLayoutProps {
  children: ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [adminUser, setAdminUser] = useState<{ id: number; username: string } | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .adminMe()
      .then((res) => {
        if (!active) return;
        setAdminUser(res.admin);
      })
      .catch(() => {
        if (!active) return;
        navigate('/admin/login', { replace: true });
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  async function handleLogout() {
    try {
      await api.adminLogout();
    } finally {
      navigate('/admin/login', { replace: true });
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        正在校验管理员会话...
      </div>
    );
  }

  if (!adminUser) return null;

  const isFeedbacks = location.pathname.startsWith('/admin/feedbacks');
  const isDepartments = location.pathname.startsWith('/admin/departments');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Link to="/admin/feedbacks" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <span className="text-base font-semibold text-slate-900">意见箱管理后台</span>
            </Link>

            <nav className="flex items-center gap-1">
              <Link
                to="/admin/feedbacks"
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isFeedbacks
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <ClipboardList className="h-4 w-4" />
                <span>意见管理</span>
              </Link>
              <Link
                to="/admin/departments"
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isDepartments
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Building2 className="h-4 w-4" />
                <span>部门配置</span>
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="hidden items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 sm:inline-flex"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              员工门户
            </Link>
            <span className="hidden text-xs text-slate-500 sm:inline">
              管理员：<strong className="text-slate-800">{adminUser.username}</strong>
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              <LogOut className="h-3.5 w-3.5" />
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
