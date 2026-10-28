# 更新日志

本项目的所有重要变更都记录在此文件中。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。早期版本说明已合并整理，不再保留单独的发布文件。

## [0.5.0] - 2026-10-28

### 新增

- **Windows / Linux 桌面客户端（Tauri 2）**：新增基于 Tauri 2 的独立桌面客户端，Rust 壳 + 系统 WebView（Windows 使用 WebView2，Linux 使用 WebKitGTK 4.1），复用同一份前端与业务逻辑；设备直连站点与 qBittorrent，不需要常开服务端。前端检测 `window.__TAURI__`，通过 Tauri command `qiliu` 调用 read/write/http 完成桥接。Windows 产物为 NSIS 安装包（`.exe`），Linux 产物为 `.deb` 与 `.AppImage`，均通过 GitHub Releases 发布。
- **Rust 桌面核心**：新增 `native/desktop-core`，用纯 Rust 实现与 Swift / Java 壳一致的站点白名单、SSRF 防护、凭据 Vault（`local.key` + AES-256-GCM `vault.enc`）与 HTTP 桥接（HTTPS 校验、4 MB 体积上限、15 秒超时、禁止跟随重定向），并附带覆盖白名单、IP 判定、加解密与请求参数校验的 `cargo test` 单元测试。
- **桌面 CI 矩阵**：新增 `.github/workflows/desktop.yml`，在 `windows-latest` 与 `ubuntu-22.04` 上运行 Rust 单元测试、构建当前系统的安装包并上传 artifacts；源码构建入口为 `npm run desktop:build`，测试入口为 `npm run desktop:test`。
- **M-Team 登录提醒**：总览账号卡显示按最近访问时间计算的 40 天登录倒计时；剩余 ≤7 天时页头提醒胶囊与总览横幅同时出现，≤3 天转为紧急提示、逾期明确提示，点击可直接打开 M-Team 登录；接口未返回时间时显示「—」而不猜测。高等级/封存账号的豁免以站内规则为准。

### 变更

- 版本升至 **0.5.0**：`package.json`、Tauri 配置与 Rust core 的版本号同步更新；新增 `desktop:build` / `desktop:test` 脚本，`npm run build` 仍是桌面构建的前置步骤。
- 开源仓库整理：采用 MIT 许可证，补充 `LICENSE`、`CONTRIBUTING.md`、`SECURITY.md`、GitHub Actions CI、`.gitattributes`、`.editorconfig` 与 PR 模板；`package.json` 增加 `license`、`description` 与 `engines.node >= 22`。安装包不再进入 Git 仓库，改由 GitHub Releases 发布。
- 文档更新：README 增加 Windows / Linux 形态、Tauri 2 技术栈、桌面构建与测试入口及平台验证边界；新增 [Windows / Linux 桌面客户端](docs/desktop-clients.md) 说明；SECURITY、CONTRIBUTING 与 NAS 部署文档同步 0.5.0 的凭据位置、构建依赖与版本示例。

## [0.4.0] - 2026-10-28

### 新增

- **刷流助手**：提供「上传量」与「魔力值」两种模式，按新鲜度、供需、优惠、热度、体积加权评分，展示评分构成与推荐理由；支持按发布时间、最少下载人数、体积上限与「仅免费」筛选。忽略列表只保存在当前设备，候选只排序、不自动加种。
- **多站点**：顶部站点切换器驱动总览、发现与刷流；新增 TJUPT（北洋园 PT）接入，支持用户名密码或浏览器登录 Cookie 连接、账号统计解析、资源搜索、passkey 种子下载与 RSS。
- **配置备份与迁移**：设置页使用至少 8 位口令加密导出完整配置，在另一台设备覆盖导入；备份只在本机生成和解析，不经过服务器。
- **下载完成提醒**：下载页可开启浏览器或系统通知，任务进度跨过完成阈值时只提醒一次；原生 WebView 不支持通知时保留应用内提示。
- **原生客户端更新**：macOS 通用包与 Android APK 升级到 0.4.0（Android versionCode 5），沿用原签名与应用身份，覆盖安装保留本机配置。
- **站点与连接**：M-Team、TJUPT、RSS 与 qBittorrent 的连接管理集中到「站点」页；移动端底部导航调整为总览、刷流、发现、下载、我的。

### 变更

- Web/NAS 响应增加 CSP、COOP 与 Permissions-Policy；原生壳保留既有 CSP。
- 资源列表支持最新/最早/体积/做种排序，时间改为相对显示；下载页明确标注只读；考核状态不再显示「暂不可用」。
- 刷流候选每 60 秒最多刷新一次，服务端缓存 60 秒，避免额外消耗站点请求额度。
- 前端拆分出 `ui.jsx`、`Account.jsx`、`SitesPage.jsx`、`SettingsPage.jsx`；全量 JS/JSX 统一使用 Prettier；新增 `npm run typecheck`，并由 `npm run check` 汇总 lint、类型、格式、语法检查与构建。
- 站点白名单收敛到 `server/sites.mjs`，新增测试校验 Swift/Java 壳中的主机与路径清单不漂移。

### 修复

- 兼容 qBittorrent `/api/v2/torrents/add` 在不同版本下返回 `Ok.`、`Ok`、空响应或 JSON 的差异：不再按响应体判断成功，改为以任务哈希是否出现确认，并短暂重试任务列表，避免「已接受却提示未接受」。
- 修复 `package-lock.json` 中不存在的依赖条目，`npm ci` 可正常安装并保留 integrity。
- 账号错误与资源错误分开处理，不再互相覆盖；请求被主动取消时不再误报「连接服务未运行」。
- M-Team 请求限流按 endpoint 分桶（profile/browse/connect/download），浏览不再挤占账号刷新。
- 做种汇总优先取 `/tracker/myPeerStatus` 的 seeder；做种体积接口不可用时显示「—」，不再以 0 B 冒充真实值。
- 修复 390px 移动端横向溢出（刷流筛选、站点切换、底部导航）。
- 原生桥接支持多 `Set-Cookie`（TJUPT 登录需要），白名单加入 TJUPT 固定路径。
- 资源列表请求失败时保留上次结果，并标注「显示上次结果」，不再清空列表。

## [0.3.1] - 2026-10-28

### 修复

- 兼容 qBittorrent 登录成功返回 HTTP 204 的情况，同时保留旧版 200 / `Ok.` 支持，并保留服务端实际 Cookie 名称。
- Web/NAS 请求按实际 UTF-8 或二进制字节长度发送，修复分块请求体导致登录参数无法识别的问题。
- 会话过期后对 401/403 重新登录一次，并区分凭据被拒、访问受限与地址响应不兼容。
- 弹窗只在按下和释放均位于真正的外部区域时关闭；全选、复制、拖选到外部或点击内部留白不会误关闭。
- 兼容下载提交的 204 成功响应，继续通过任务哈希查询确认状态。

### 变更

- Android 版本代码提升至 4，沿用原签名，可直接覆盖安装。
- macOS 与 Android 安装包更新，应用身份与配置目录保持不变。
- 自动化回归测试、ESLint 与生产构建通过，覆盖 qBittorrent 兼容、原生传输与弹窗交互。

[0.5.0]: #050---2026-10-28
[0.4.0]: #040---2026-10-28
[0.3.1]: #031---2026-10-28
