# Design

## Context

- 本项目位于工作区独立目录 `feedback-portal/` 下，与同级无关项目目录 `ai_tiku/` 完全隔离，不共享代码或依赖。
- 运行环境为公司内网单机部署，需在无外网连接的局域网环境中稳定运行，同时兼容员工 PC 浏览器（传截图）与公司 Wi-Fi 下的手机浏览器（直接拍照/选图上传）。
- 业务动机见 [proposal.md](proposal.md)，各模块外部行为契约见 `specs/*/spec.md`。

## Goals / Non-Goals

**Goals:**
- 单进程前后端一体化部署：一个 Node.js 服务同时承载前端静态页面、REST API 与受控照片文件访问，单端口对外（默认 `3000`），提供 `docker-compose.yml` 一键启动。
- 零外部中间件依赖：使用内嵌 SQLite 数据库与本地目录存储照片，所有持久化数据集中落在单一 `DATA_DIR`（默认 `./data`）目录下，便于备份和迁移。
- 全本地静态资源：前端构建产物不依赖任何外网 CDN、外链字体或外部图标库，确保纯内网环境离线可用。
- 默认安全：上传图片经二进制魔数（Magic Bytes）校验并落盘为不可预测的随机路径；照片通过鉴权接口受控分发；管理后台采用 `HttpOnly` 会话 Cookie、加盐 `scrypt` 密码哈希、登录限流及 CSV 公式注入防护。

**Non-Goals:**
- 首期不接入公司 SSO / LDAP / 企业微信 / 钉钉等外部认证体系（仅预留认证中间件边界）。
- 首期不实现多角色分部门权限隔离或跨部门工单转派（采用统一管理员角色管理全部部门）。
- 首期不引入对象存储（MinIO/S3）、分布式数据库或多实例水平扩展架构。

## Decisions

### 1. 应用架构与目录组织：单仓一体化 TypeScript Web 应用

在 `feedback-portal/` 下采用前后端分目录、单服务发布的轻量结构：

```text
feedback-portal/
├── server/                 # Node.js + Express + TypeScript 后端服务
│   └── src/
│       ├── config.ts       # 环境变量与路径配置
│       ├── db/             # SQLite 连接、建表初始化与种子数据
│       ├── middleware/     # 管理员鉴权、限流、上传与统一错误处理
│       ├── routes/         # public（部门/提交/查进度/附件）与 admin 路由
│       └── services/       # 回执码生成、图片魔数校验与清理、CSV 导出
├── web/                    # React + Vite + Tailwind CSS + TypeScript 前端
│   └── src/
│       ├── pages/          # 意见提交页、回执查进度页、管理员登录与后台页
│       ├── components/     # 多图上传预览、照片灯箱、状态标签、筛选栏
│       └── api/            # 前端接口封装
├── Dockerfile              # 多阶段构建（node:24-alpine）
├── docker-compose.yml      # 内网一键部署配置
└── .env.example            # 环境变量模板
```

- 生产模式下，Express 托管 `web/dist` 静态资源并对前端路由（`/`、`/lookup`、`/admin/*`）返回 `index.html`，彻底消除跨域与多容器反代配置复杂度。
- **备选方案对比**：
  - *Nginx + FastAPI 双容器*：增加容器编排与反代配置复杂度，对单机内网轻量工具收益不大。
  - *服务端模板渲染（EJS/Jinja）*：在多图拖拽预览、上传前校验、图片灯箱查看及后台无刷新筛选体验上不如轻量化 SPA。

### 2. 数据持久化：Node.js 内置 `node:sqlite`（`DatabaseSync`）+ WAL 模式

- 使用 Node.js 内置 `node:sqlite` 模块访问 `${DATA_DIR}/feedback.db`，启动时执行 `PRAGMA journal_mode = WAL;`、`PRAGMA foreign_keys = ON;`、`PRAGMA busy_timeout = 5000;`。
- **核心表结构**：
  - `departments (id INTEGER PK, name TEXT UNIQUE NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, is_enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT)`
  - `feedbacks (id INTEGER PK, receipt_code TEXT UNIQUE NOT NULL, department_id INTEGER NOT NULL REFERENCES departments(id), category TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, is_anonymous INTEGER NOT NULL DEFAULT 0, submitter_name TEXT, employee_no TEXT, contact_info TEXT, status TEXT NOT NULL DEFAULT 'pending', admin_reply TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
    - 索引：`idx_feedbacks_dept(department_id)`、`idx_feedbacks_status(status)`、`idx_feedbacks_created(created_at DESC)`、`idx_feedbacks_receipt(receipt_code)`
  - `attachments (id TEXT PK, feedback_id INTEGER NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE, original_name TEXT NOT NULL, stored_rel_path TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL)`
    - 索引：`idx_attachments_feedback(feedback_id)`
  - `feedback_logs (id INTEGER PK, feedback_id INTEGER NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE, from_status TEXT, to_status TEXT NOT NULL, reply_content TEXT, operator_username TEXT, created_at TEXT NOT NULL)`
    - 索引：`idx_feedback_logs_feedback(feedback_id, created_at)`
  - `admin_users (id INTEGER PK, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
  - `admin_sessions (token_hash TEXT PK, admin_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`
- 首次启动若 `departments` 为空，自动初始化默认部门（如：研发部、产品部、运营部、综合行政部、财务部、人事部、其他）；若 `admin_users` 为空，按 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 环境变量自动创建默认管理员。
- **备选方案对比**：
  - *`better-sqlite3`*：依赖本地 C++ 原生编译或与 Node ABI 强绑定的预编译二进制，在较新 Node 版本（如当前本地 Node v26）或 Alpine 镜像中容易触发构建失败；内置 `node:sqlite` 零编译依赖，同时兼容本地 Node v26 与 Docker `node:24-alpine`。
  - *MySQL / PostgreSQL*：需额外维护数据库容器和运维脚本，不符合轻量单机定位。

### 3. 照片上传校验、安全存储与受控分发

- `POST /api/feedbacks` 接收 `multipart/form-data`（表单文本字段 + 最多 5 个 `photos` 文件字段），先写入临时目录 `${DATA_DIR}/uploads/.tmp/`，避免大文件并发占用过高内存。
- 校验阶段读取每个上传文件头部魔数（Magic Bytes）：
  - JPEG：`FF D8 FF`
  - PNG：`89 50 4E 47 0D 0A 1A 0A`
  - WebP：`RIFF` + 4 bytes + `WEBP`
  仅以校验通过后的真实格式决定 `mime_type` 与落盘扩展名（`.jpg`/`.png`/`.webp`），忽略客户端声明的扩展名和 `Content-Type`。
- 校验通过后将文件重命名移动至 `${DATA_DIR}/uploads/YYYY/MM/<uuid>.<ext>`，数据库记录相对路径 `stored_rel_path` 与清洗后的展示文件名 `original_name`（去除路径分隔符和控制字符）。
- 反馈入库、附件记录及初始日志写入置于同一 SQLite 事务中；若任一校验或写入失败，`catch/finally` 立即清理本次请求产生的所有临时文件与已移动文件，防止孤立文件残留。
- 禁止通过静态目录直接暴露 `uploads/`；统一由 `GET /api/attachments/:id` 分发：
  - 校验管理员有效会话，或校验查询参数 `receiptCode` 与该附件所属反馈的 `receipt_code` 精确一致；否则返回 `403`。
  - 使用 `path.resolve` 校验最终路径严格位于 `uploadsRoot` 内部，响应头强制设置校验后的 `Content-Type`、`X-Content-Type-Options: nosniff`、`Cache-Control: private, max-age=3600`；当 `?download=1` 时附带安全编码的 `Content-Disposition: attachment`。
- **备选方案对比**：
  - *直接静态托管 `/uploads`*：会导致内网任意人遍历或猜测 URL 访问他人意见照片，不满足受控访问要求。
  - *引入 `sharp` 服务端二次转码*：增加原生 `libvips` 构建与镜像体积负担；魔数校验 + 禁止脚本执行 + `nosniff` 已满足内网图片安全需求。

### 4. 回执码生成与隐私隔离

- 回执码格式：`FB-YYYYMMDD-XXXXXX`，其中 `XXXXXX` 使用 `crypto.randomBytes` 从去歧义字符集 `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` 中均匀抽取（排除易混淆的 `0/O/1/I`），若罕见碰撞则重试最多 5 次。
- `GET /api/feedbacks/lookup/:receiptCode` 对输入执行去首尾空格与转大写归一化；匿名意见隐藏所有身份字段，实名意见在公开查进度接口中不返回 `contact_info` 原始联系方式。

### 5. 管理员认证、限流与 CSV 导出

- **密码与会话**：管理员密码使用 Node.js 内置 `crypto.scryptSync` + 16 字节随机盐存储（格式 `scrypt$<salt>$<hash>`），比对采用 `crypto.timingSafeEqual`。登录成功签发 32 字节随机令牌写入 `HttpOnly; SameSite=Lax; Path=/` Cookie（`Secure` 由 `COOKIE_SECURE` 环境变量控制，内网纯 HTTP 默认 `false`，挂接 HTTPS 反代时设为 `true`），数据库仅保存令牌的 SHA-256 哈希与过期时间（默认 24 小时）。
- **登录限流**：在 `POST /api/admin/login` 上基于客户端 IP 实现内存滑动窗口限流（15 分钟内连续失败达到 10 次返回 `429`），登录成功后重置该 IP 失败计数。
- **CSV 导出**：`GET /api/admin/feedbacks/export` 复用列表筛选查询条件（不分页，单次导出上限可设安全阈值如 10000 条），输出带 UTF-8 BOM（`\uFEFF`）的 RFC 4180 CSV；对以 `=`、`+`、`-`、`@`、`\t`、`\r` 开头的单元格内容前置单引号 `'` 防止电子表格公式注入。

### 6. 内网容器化部署

- 提供两阶段 `Dockerfile`（基于 `node:24-alpine`）：构建阶段编译 `web` 与 `server`，运行阶段仅保留生产依赖、编译产物与非 root 用户，暴露 `3000` 端口并配置 `/api/health` 健康检查。
- 提供 `docker-compose.yml`，通过宿主目录卷挂载 `./data:/app/data`，管理员账号与初始密码通过 `.env` 注入。

## Risks / Trade-offs

- **[公司内网常见纯 HTTP 部署，Cookie 未启用 Secure 标志]** → 通过环境变量 `COOKIE_SECURE` 可配置，默认 `false` 保证内网 IP 直接访问可用，并在文档中建议生产环境通过公司内部 HTTPS 反向代理暴露并开启 `COOKIE_SECURE=true`。
- **[单机本地磁盘照片持续增长导致空间占满]** → 限制单条意见最多 5 张、单张上限 10 MB，按 `YYYY/MM/` 分目录存储便于运维归档；并在部署文档中说明 `./data` 定期备份与磁盘监控建议。
- **[内存登录限流在容器重启后清空计数]** → 对单实例内网后台风险可控，配合强密码策略和 `scrypt` 慢哈希提供纵深防护。
- **[SQLite 单写者并发限制]** → 开启 WAL 模式与 5 秒 `busy_timeout`，对于公司内网意见提交与管理后台的典型并发量（十至百级 QPS）完全胜任。

## Migration Plan

1. 本次为全新系统部署，无历史数据迁移负担。
2. 运维人员在目标内网服务器配置 `feedback-portal/.env`（设置 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 及可选 `PORT`），执行 `docker compose up -d`（或本机 Node.js 环境执行 `npm install && npm run build && npm start`）。
3. 服务首次启动自动创建 SQLite 表结构并写入初始部门和管理员账号，访问 `GET /api/health` 确认服务就绪。
4. 如需回滚或下线，停止服务/容器即可；保留 `./data` 卷目录即可完整保留数据库与照片数据。
