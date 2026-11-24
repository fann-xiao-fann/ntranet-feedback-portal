import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MessageSquarePlus, Search, ShieldCheck } from 'lucide-react';

interface PublicLayoutProps {
  children: ReactNode;
}

export function PublicLayout({ children }: PublicLayoutProps) {
  const location = useLocation();
  const isSubmit = location.pathname === '/';
  const isLookup = location.pathname.startsWith('/lookup');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white shadow-xs">
              <MessageSquarePlus className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-semibold leading-tight text-slate-900">
                公司内网意见箱
              </div>
              <div className="text-xs text-slate-500">跨部门意见建议与现场问题收集平台</div>
            </div>
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              to="/"
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isSubmit
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <MessageSquarePlus className="h-4 w-4" />
              <span>提交意见</span>
            </Link>
            <Link
              to="/lookup"
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isLookup
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Search className="h-4 w-4" />
              <span>进度查询</span>
            </Link>
            <Link
              to="/admin"
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">管理后台</span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>

      <footer className="border-t border-slate-200/80 py-6 text-center text-xs text-slate-400">
        仅限公司内部局域网使用 · 支持 PC 端与移动端拍照上传
      </footer>
    </div>
  );
}
