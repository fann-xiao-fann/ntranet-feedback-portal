# Proposal

## Why

公司各部门员工目前缺乏一个统一、便捷、可在内网直接访问的意见与问题反馈通道，导致跨部门建议、现场问题照片和改进诉求分散在聊天群或口头沟通中，难以归档、统计与跟踪闭环。建设一个轻量级的内网意见收集网站，能够让员工免登录快速上传图文意见，并帮助管理员集中查看、分类处理与反馈进度。

## What Changes

- 在独立应用目录 `feedback-portal/` 中新建一套面向公司内网的意见收集与管理 Web 系统（前后端一体化部署，避免影响同级无关目录 `ai_tiku/`）。
- 新增员工免登录意见提交门户：支持选择所属部门、填写姓名/工号（可选匿名）、填写意见标题/分类/详细内容，并支持一次上传多张现场或截图照片。
- 新增本地照片附件存储与安全校验能力：对上传图片进行类型、大小与数量限制，持久化到内网本地磁盘，提供预览与下载能力。
- 新增意见回执码进度查询能力：员工提交意见后获得唯一回执码，无需登录即可随时查询当前处理状态与管理员官方回复。
- 新增管理后台：通过管理员账号密码登录，支持按部门、状态、分类、时间与关键词筛选意见、查看与下载照片附件、更新处理状态并填写回复、维护部门列表，以及导出意见数据（CSV）。
- 提供轻量单机内网部署配置（SQLite 数据库 + 本地照片目录 + Docker Compose 一键启动）。

## Capabilities

### New Capabilities
- `feedback-submission`: 员工内网免登录提交意见表单（部门选择、实名/匿名选项、意见信息填写、关联照片上传与回执码生成）。
- `photo-attachment-storage`: 照片附件上传校验（格式/大小/张数）、安全本地磁盘存储、受控访问预览/下载及孤立文件清理。
- `feedback-progress-lookup`: 基于唯一回执码的自助进度查询（展示脱敏提交概要、当前处理状态、处理时间线与管理员回复）。
- `feedback-admin-management`: 管理员登录认证、意见列表多维度筛选与详情查看、照片预览下载、状态流转与回复、部门配置管理及 CSV 数据导出。

### Modified Capabilities
<!-- 无既有能力变更，本次为全新内网网站项目 -->

## Impact

- **新增目录与代码**：在工作区根目录下新增 `feedback-portal/`，包含前端 Web 应用、后端 API 服务、SQLite 数据迁移脚本与 Docker Compose 部署文件；不修改现有 `ai_tiku/` 目录。
- **新增接口**：
  - 公开接口：`GET /api/departments`、`POST /api/feedbacks`、`GET /api/feedbacks/lookup/:receiptCode`、`GET /api/attachments/:id`
  - 管理接口：`POST /api/admin/login`、`POST /api/admin/logout`、`GET /api/admin/me`、`GET /api/admin/feedbacks`、`GET /api/admin/feedbacks/:id`、`PATCH /api/admin/feedbacks/:id`、`GET /api/admin/feedbacks/export`、`GET/POST/PATCH/DELETE /api/admin/departments`
- **数据与运维依赖**：单机运行依赖 Node.js（或 Docker + Docker Compose），持久化数据存于挂载卷 `data/feedback.db`（SQLite）和 `data/uploads/`（照片附件目录），仅需公司内网局域网可达，无需外网访问。
