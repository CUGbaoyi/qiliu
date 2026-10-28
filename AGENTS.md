# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Confirmed product decisions

- Updated request: white main surfaces with orange accents. Preserve desktop sidebar and account-first mobile layout.
- Account uploaded/downloaded/share ratio are primary, with bonus and seeding statistics. Do not replace the account view with a poster-only library.
- M-Team credentials and the latest RSS were supplied and authorized for connection. They are stored only in `.data/`; never echo, commit, package or publish this directory.
- Use real responses as the default; retain a clearly marked demo mode for design QA. Never infer a healthy account or passed assessment from share ratio.
- Updated request: standalone Android APK and standalone macOS app; each device connects directly without a Mac server. Keep optional web preview. No public deployment.
- Read live qBittorrent speed separately from tracker accounting. Show official hourly bonus via /tracker/mybonus formulaParams.finalBs. Never label sampled account deltas as real-time network throughput.

- Version 0.3 request: allow explicitly configured qBittorrent HTTP on public IPv4/IPv6 in Android, Mac and NAS; retain a short non-blocking cleartext note. Preserve HTTPS checks for M-Team/RSS and certificate verification.
- Support user-triggered torrent submission from resource details, destination path/category/pause options, hash duplicate detection and task progress. Download completion follows qBittorrent's existing seeding rules. Never skip file checking or automatically alter share limits.
- 2026-10-28 request: 总览只保留账号概览与「上传与魔力收益」两块，不再显示「最新资源」列表，也不在总览发起资源请求；资源列表只出现在发现、订阅、收藏。
- 2026-10-28 decision: 「做种汇总」优先取 /tracker/myPeerStatus 的 seeder（与站点“做种中”一致），/tracker/myPeerStatistics 的 seederCount 只作兜底；做种体积接口不可用时显示「—」，不得显示 0 B 冒充真实值。
- 2026-10-28 request: 新增「刷流助手」，上传量与魔力值两种模式一起做；按新鲜度/供需/优惠/热度/体积打分，展示评分构成与推荐理由，只排序不自动加种，发送复用现有下载弹窗。默认仅免费，忽略列表仅存本机。
- 2026-10-28 decision: 站点请求限流改为按 endpoint 分桶（profile/browse/connect/download），避免浏览挤占账号刷新；账号与资源错误状态分开，请求被主动取消时不得显示“服务未运行”。
- 2026-10-28 decision: Web/NAS 响应增加 CSP（default-src 'self'，img 允许 https），保留原生壳既有 CSP；新增资源排序、相对时间展示、下载页只读说明。
- 2026-10-28 request: 多站点支持并接入 TJUPT。TJUPT 无开放 API，需 NexusPHP cookie 登录 + HTML 解析；RSS/passkey 走订阅，种子下载走 download.php。凭据只存加密 vault，Cookie 不暴露给前端。
- 2026-10-28 实现: 多站点用顶部站点切换（M-Team / TJUPT）驱动总览、发现与刷流；TJUPT 需 username/password 登录（cookie 仅内存，不落盘、不回传前端），可选 32 位 passkey 用于 RSS 与种子下载；登录失败不自动重试，10 分钟内最多 3 次尝试；账号缓存 10 分钟，搜索缓存 2 分钟，解析失败显示「—」而不是 0。原生壳需放行 tjupt.org 的固定路径并支持多 Set-Cookie。
- 2026-10-28 实现: 版本升至 0.4.0（package.json / AndroidManifest versionCode 5 / compose / 原生打包脚本读取版本号）。新增「设置 → 备份与迁移」：口令 ≥8 位，scrypt + AES-256-GCM（@noble/ciphers）加密导出导入，导入为覆盖且仅本机可用；备份 UI 用文本框，不依赖 WebView 下载文件。
- 2026-10-28 实现: 下载页增加完成提醒（浏览器通知，需用户手势授权；原生 WebView 不支持时仅保留应用内提示），完成判定按任务 progress 跨过 1 只触发一次。
- 2026-10-28 实现: P2 第一步——把 Icon/Amount/Modal/Art 抽到 `src/ui.jsx`、账号卡抽到 `src/Account.jsx`；新增无依赖 UI 冒烟 `npm run test:ui`（无头 Chrome + CDP，桌面 5 页、移动端 390px、侧栏导航、脚本错误）。Mac 0.4.0 应用已构建并通过 Ad-hoc 签名校验；Android（无 SDK）与 Docker（daemon 未运行）未打包。
- 2026-10-28 实现: P2 第二步——全量 JS/JSX 用 Prettier 统一格式（printWidth 120），新增 `.prettierrc.json`、`.prettierignore`、`format`/`format:check`；`tsconfig.json` + `types/qiliu.d.ts` 对刷流/备份/TJUPT 与新组件运行 `tsc --checkJs`；`npm run check` 汇总 lint/类型/格式/语法/构建；App 继续拆出 `SitesPage.jsx` / `SettingsPage.jsx`。
- 2026-10-28 实现: 资源列表请求失败时保留上次结果并标注「显示上次结果」，不再清空列表；批量收藏与字节单位统一仍待做（P1 可选项）。
- 2026-10-28 实现: 站点白名单（M-Team base/paths、TJUPT host/paths）收敛到 `server/sites.mjs`，服务端与原生 JS 共用；新增 `tests/sites-allowlist.test.mjs` 校验 Swift/Java 壳清单与源清单一致。批量收藏因与「清爽列表」冲突暂不做；字节单位保持 PT 习惯的 GB/TB（按 1024 计算）不改为 GiB。
- 2026-10-28 实现: TJUPT 支持浏览器登录 Cookie 连接（两步验证账号）；密码登录遇到 6 位验证码页时明确报错且不重试；Cookie 加密存 vault、可进入备份；`/api/sites/tjupt/connect` 与原生端同构。Android 0.4.0 APK 用原签名（证书 SHA-256 与 0.3.1 一致）构建，可覆盖安装。
- 2026-10-28 验证: TJUPT 真实账号（Cookie 登录）联调通过：解析账号面板/做种列表/每小时魔力、搜索 100 条/页、刷流候选、passkey 下载（10.7KB 种子 v1 哈希）与 RSS；TJUPT HTML 结构确认为 torrentname 嵌套表 + 顶部用户面板，解析器已按真实结构重写并用合成夹具回归。站点不展示累计下载/分享率，保持「—」。
- 2026-10-28 request: 手机底部导航只保留 5 项，顺序为总览/刷流/发现/下载/我的；桌面侧栏顺序同步为总览/刷流/发现/订阅/下载/收藏/站点。把「订阅」移到「我的 → RSS 订阅」入口。
- 2026-10-28 修复: qBittorrent 不同版本 /api/v2/torrents/add 响应不一致（Ok. / Ok / 空 / JSON），不再按 body 严格判断；只有明确 Fails./error 才报拒绝，其余以任务哈希是否出现为准，并短暂重试任务列表，避免“已接受却提示未接受”。
