# 参与贡献

感谢你愿意参与栖流（QILIU）。本文说明开发环境、检查命令、代码结构和提交约定，帮助你的改动顺利合并。

## 行为准则

- 尊重其他贡献者，讨论对事不对人。
- 不提交他人的账号、Cookie、passkey、Token、内网地址或任何真实站点数据的截图。
- 本项目仅用于管理你有权使用的账号与资源，请遵守站点规则与当地法律法规。

## 环境要求

| 工具 | 版本 / 说明 |
| --- | --- |
| Node.js | **>= 22**（项目使用内置 `node --test`、`fetch` 与 Express 5） |
| npm | 随 Node.js 安装 |
| Chrome | 可选，仅 `npm run test:ui` 需要 |
| Xcode 命令行工具 | 可选，构建 macOS 客户端需要 |
| JDK + Android SDK 35 | 可选，构建 Android 客户端需要（platform 35 / build-tools 35.0.0） |

## 安装与开发

```sh
npm ci
npm run dev
# 打开 http://localhost:4173
```

`npm run dev` 使用 Vite 中间件提供前端热更新；`npm run build` 产出 `dist/client`，再由 `npm start` 提供生产服务。默认只监听 `127.0.0.1`，局域网调试使用 `npm run start:lan`。

首次运行会创建 `.data/` 保存加密凭据，该目录已被 `.gitignore` 排除；原生构建缓存位于 `native/.build/`，同样不要提交。

## 检查与测试

| 命令 | 说明 |
| --- | --- |
| `npm run lint` | ESLint 检查 `src`、`server`、`tests` |
| `npm run typecheck` | `tsc --checkJs`，覆盖刷流、备份、TJUPT 模块与新 UI 组件 |
| `npm run format` / `npm run format:check` | 使用 Prettier 写入 / 检查格式 |
| `npm test` | `node --test` 自动化测试 |
| `npm run test:ui` | 无头 Chrome（CDP）UI 冒烟：桌面五页 + 390px 移动布局 + 侧栏导航 + 脚本错误 |
| `npm run build` | 生产构建 |
| `npm run check` | lint + 类型 + 格式 + 语法检查 + 构建，提交前建议执行 |
| `npm run test:sites` | 静态资源 Worker 测试（涉及 `worker/` 时运行） |

改动前端交互时，请至少在桌面宽度与 390px 宽度下自查；有条件的话运行 `npm run test:ui`。新增逻辑请补充对应的 `tests/*.test.mjs`，测试优先使用合成夹具，不要依赖真实站点。

## 代码结构

```text
src/                  React 界面与原生桥接
  App.jsx             页面框架、状态与视图切换
  Account.jsx         账号概览卡片
  Downloads.jsx       下载页、发送弹窗与完成提醒
  Farming.jsx         刷流助手
  SettingsPage.jsx    设置、备份与迁移
  SitesPage.jsx       站点与连接
  ui.jsx              共享 UI 原子组件
  data.js             API 客户端、演示数据与格式化
  native.js           macOS / Android 共用的原生 Bridge
server/               Web/NAS 服务与共享业务逻辑
  app.mjs             Express 路由、鉴权、限流与缓存
  model.mjs           站点数据归一化与 RSS 解析
  farming.mjs         刷流评分（纯函数，原生端共用）
  tjupt.mjs           TJUPT 登录、HTML 解析与下载链接
  downloads.mjs       种子哈希、重复检测与提交确认
  qb-client.mjs       qBittorrent WebUI 客户端
  backup.mjs          口令加密的配置备份
  network.mjs         出站请求、白名单与 HTTPS 校验
  vault.mjs           本机加密存储
native/macos/         Swift + WKWebView 壳
native/android/       Java + WebView 壳
scripts/              原生打包与 UI 冒烟
tests/                node --test 测试与 fixtures
public/               图标、PWA 清单与演示图片
docs/                 截图与补充文档
worker/               可选静态资源回退 Worker
```

原生端复用 `server/` 与 `src/` 中的纯 JavaScript 模块，因此新增依赖时请确认它能在 WKWebView / Android WebView 中运行，并注意保持原生壳逻辑与共享模块一致。

### 站点白名单

M-Team 与 TJUPT 允许访问的主机和路径收敛在 `server/sites.mjs`。如果站点新增入口：

1. 修改 `server/sites.mjs`。
2. 同步 `native/macos/Qiliu.swift`、`native/android/src/cc/qiliu/app/MainActivity.java` 中的清单。
3. 运行 `npm test`，`tests/sites-allowlist.test.mjs` 会校验三处是否一致。

### 界面与样式

- 主题固定为白色主表面 + 橙色强调，桌面保留侧栏，移动端保持账号优先的层级与底部导航。
- 复用 `src/ui.jsx` 的 `Icon`、`Amount`、`Modal` 等组件，不要在页面里重复实现。
- 界面文案使用中文，保持简洁；演示数据必须明确标注「演示」，不要与真实数据混淆。
- 格式化统一由 Prettier 处理（printWidth 120、单引号），提交前运行 `npm run format:check`。

## 提交与 Pull Request

- 建议一个提交只做一件事，提交信息使用 `类型: 简述`，类型可取 `feat`、`fix`、`docs`、`refactor`、`test`、`chore`，例如 `fix: 兼容 qBittorrent 空响应`。
- 提交前至少运行 `npm run check` 与 `npm test`；如果改动涉及 UI，再运行 `npm run test:ui`。
- PR 请填写仓库的 [PR 模板](.github/pull_request_template.md)，说明变更动机、验证方式和潜在影响。
- 行为变更请同步更新 [README.md](README.md)、[CHANGELOG.md](CHANGELOG.md) 或相关文档。
- 较大的功能或接口变更，建议先开 issue 讨论方案，避免重复实现。

### 禁止提交的内容

以下内容一旦提交就视为凭据泄露，请务必检查：

- `.data/`、`.env`、`.env.local` 及任何环境变量文件（`.env.example` 除外）
- `secrets/`、Cookie、passkey、API Token、账号密码、签名证书（`*.jks`、`*.keystore`）
- `installers/`、`dist/`、`native/.build/`、`coverage/` 等构建产物
- 由真实实例截取的界面图（已在 `.gitignore` 中排除，也不要手动添加）
- 真实站点数据、真实内网地址、个人姓名或其他隐私信息

如果误提交了凭据，请立即在对应站点吊销或更换，并联系维护者处理历史记录。

## 安全漏洞

不要通过公开 issue 报告安全漏洞。请阅读 [SECURITY.md](SECURITY.md)，使用 GitHub 的私密安全公告通道。

## 许可证

提交贡献即表示你同意以 [MIT 许可证](LICENSE) 授权你的贡献。
