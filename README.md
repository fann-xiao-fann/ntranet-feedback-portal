# 公司内网意见箱（Intranet Feedback Portal）

面向公司内网的单机轻量级跨部门意见收集与管理网站。各部门员工无需登录即可通过电脑或手机浏览器提交文字意见与多张现场照片，并凭借回执码随时查询处理进度与官方回复；管理员可通过后台按部门筛选、查看/下载照片、更新状态并导出 CSV。

## 功能概览

- **员工意见提交（`/`）**：选择所属部门、意见分类，支持实名或匿名提交，支持一次上传最多 5 张照片（JPG/PNG/WebP，单张 ≤ 10 MB，移动端可直接拍照上传）。
- **回执进度查询（`/lookup`）**：凭唯一回执码 `FB-YYYYMMDD-XXXXXX` 免登录查询当前状态、处理时间线与管理员官方回复。
- **管理员后台（`/admin`）**：账号密码登录（`HttpOnly` 会话 + 登录防爆破限流），支持按部门/状态/分类/日期/关键词筛选、照片原图预览与下载、状态流转与回复、部门配置管理以及防公式注入的 UTF-8 BOM CSV 导出。
- **纯内网离线可用**：前端静态资源全部本地打包，不依赖外网 CDN 或外链字体；数据持久化于单一 `./data` 目录（SQLite + 本地照片目录）。

## 快速部署（推荐：Docker Compose）

1. 复制环境变量模板并修改管理员初始密码：

```bash
cp .env.example .env
# 编辑 .env，务必修改 ADMIN_PASSWORD 为强密码
```

2. 一键构建并启动：

```bash
docker compose up -d --build
```

3. 内网访问地址（假设内网服务器 IP 为 `192.168.1.100`）：
   - 员工意见提交页：`http://192.168.1.100:3000/`
   - 员工进度查询页：`http://192.168.1.100:3000/lookup`
   - 管理员登录后台：`http://192.168.1.100:3000/admin`
   - 健康检查接口：`http://192.168.1.100:3000/api/health`

## 本地 Node.js 直接运行（Node 24+）

```bash
cp .env.example .env
npm install
npm run build
npm start
```

开发调试模式（分别启动后端与前端热更新）：

```bash
npm run dev:server
npm run dev:web
```

运行自动化测试：

```bash
npm run typecheck
npm test
```

## 运维与安全建议

- **数据备份**：所有持久化数据均在 `./data/` 目录中（`feedback.db` 及 `uploads/` 照片目录）。建议每日定时备份该目录（SQLite 开启了 WAL 模式，备份数据库时建议同时备份 `feedback.db`、`feedback.db-wal`、`feedback.db-shm` 或通过 `sqlite3 .backup` 归档）。
- **HTTPS 反向代理**：如通过公司内部 Nginx / Caddy 挂接 HTTPS 域名访问，请在 `.env` 中将 `COOKIE_SECURE=true` 并重启容器，以启用安全 Cookie 标志。
- **默认管理员初始化**：`ADMIN_USERNAME` 与 `ADMIN_PASSWORD` 仅在数据库首次启动且 `admin_users` 表为空时生效。
