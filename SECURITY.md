# 安全策略

栖流（QILIU）会保存站点 Token、TJUPT 账号/Cookie、passkey 与下载器凭据，因此安全是项目的核心设计目标之一。本文说明支持版本、如何私密报告漏洞、当前的安全模型与已知边界。

## 支持版本

| 版本 | 安全更新 |
| --- | --- |
| 0.5.x | 接收安全修复 |
| < 0.5 | 建议升级到最新版本；旧版本不再单独修复 |

当前最新版本为 **0.5.0**。

## 报告漏洞

请通过本仓库的 **GitHub Security Advisory** 私密报告，而不要开公开 issue：

1. 打开仓库的 **Security** 标签页。
2. 选择 **Report a vulnerability**（Advisories）。
3. 附上受影响版本、运行形态（Web / NAS / Windows / Linux / Android / macOS）、复现步骤与影响范围；如有 PoC 或日志，请先脱敏。

报告中请不要包含真实账号、Cookie、passkey、Token、内网地址或完整备份文件。收到报告后，维护者会先确认问题、评估影响，并在修复发布后与你协调公开披露；如果你愿意，会在公告中致谢。

## 安全模型

### 凭据存储

| 运行形态 | 存储位置 | 保护方式 |
| --- | --- | --- |
| Web / NAS | `.data/vault.enc` + `.data/local.key` | AES-256-GCM；密钥文件权限 0600，目录权限 0700 |
| Windows / Linux | Tauri `app_data_dir` 下的 `vault.enc` + `local.key`（Windows 位于用户 AppData，Linux 位于用户数据目录） | AES-256-GCM；Unix 上 `local.key` 权限 0600，Windows 依赖用户目录 ACL 隔离 |
| macOS | `~/Library/Application Support/Qiliu/vault.enc` | 主密钥保存在系统钥匙串（仅本机、首次解锁后可用）；配置使用 AES-GCM |
| Android | 应用私有目录 `vault.bin` | 主密钥保存在 Android Keystore；配置使用 AES/GCM |

- 仓库、安装包和 Docker 镜像不包含任何账号、Token、passkey 或密码。
- 凭据只在需要发起请求的服务端或原生桥接内部使用，不回传渲染层；设置界面只回显已保存地址与用户名等非敏感信息（TJUPT 用户名、下载器地址），不展示密码与 Cookie。
- TJUPT 密码登录产生的会话 Cookie 只保存在内存中，不落盘、不回传前端；应用重启后需重新登录。两步验证账号使用的浏览器登录 Cookie 属于连接凭据，会与账号密码一样加密存入 vault（Web/NAS 的 `.data/vault.enc`、Windows / Linux 的 `app_data_dir`、macOS 系统钥匙串、Android Keystore），并随加密备份迁移，同样不回传渲染层。
- 备份文件使用口令派生密钥（scrypt，N=16384、r=8、p=1）与 AES-256-GCM 加密，可包含站点 Token、TJUPT 账号/Cookie、订阅链接与下载器凭据；口令不保存，备份文件本身等同于凭据。

### 网络访问

- M-Team 与 TJUPT 请求只允许白名单内的官方主机与固定路径；你添加的 RSS 与种子地址可以是任意 HTTPS 主机，但同样拒绝解析到回环、内网、链路本地、保留或组播地址（防 SSRF），并限制响应体积。
- 站点请求强制 HTTPS 并校验证书，不提供跳过证书校验的选项。
- qBittorrent 连接允许显式配置 `http://`，因为大量 NAS 下载器部署在可信内网；此时密码与种子数据以明文传输，界面会给出提示。公网访问请使用 HTTPS 或反向代理。
- 服务端按访问地址（Host）与 Origin 校验请求来源；所有非 GET 请求还要求自定义请求头，降低 CSRF 风险。
- Windows / Linux 桌面端在 Rust 侧执行与 Swift / Java 壳相同的出站规则：站点白名单、HTTPS 校验、拒绝解析到内网与保留地址、请求/响应 4 MB 上限、15 秒超时，并禁止跟随重定向（3xx 原样返回，由调用方处理）。

### 身份认证与访问控制

- **NAS 模式**：管理密码至少 16 个字符，使用 scrypt 派生并以恒定时间比较；会话 Cookie 为 `HttpOnly` + `SameSite=Strict`，有效期 24 小时；同一来源连续 5 次失败后锁定 15 分钟。
- **局域网配对**：Mac 生成 6 位一次性配对码，5 次尝试失败后锁定 15 分钟；配对成功后发放有时效的会话 Cookie。
- 密钥管理接口（连接站点、导入备份等）仅本机可调用，配对设备只能读取与操作资源。
- NAS 容器以非 root 用户运行，根文件系统只读，丢弃全部 Linux capabilities，并启用 `no-new-privileges`。

### 浏览器与 WebView 侧

- Web/NAS 响应启用 CSP（`default-src 'self'`、图片允许 `https:`）、COOP、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer` 与最小化的 Permissions-Policy。
- 原生壳仅加载应用内打包资源（`qiliu://app/` 或本地 `https://qiliu.local`），禁用文件访问与混合内容；Android 还显式关闭 Cookie 与多窗口，外部链接交给系统浏览器打开。CSP 进一步收紧 `connect-src`、`frame-src` 与 `form-action`。
- Tauri 桌面壳同样只加载打包资源并配置了收紧的 CSP，外部链接交给系统浏览器。WebView 由操作系统提供：Windows 使用 WebView2，Linux 使用 WebKitGTK 4.1，其安全更新跟随系统或 WebView2 运行时；安装包本身未签名（Windows 可能出现 SmartScreen 提示），请只从本仓库的 GitHub Releases 获取。
- 下载页只读，不提供删除、限速或修改分享率的入口。

### 隐私

- 无遥测、无统计 SDK、无广告，也不包含任何第三方上报。
- 站点、RSS 与 qBittorrent 请求由你的设备直接发出，项目没有中转服务器，也不会收集使用数据。
- 日志只记录错误信息，不打印凭据、Cookie 或备份内容。

## 已知边界与非目标

以下情况不在安全保证范围内，请知悉：

- **设备已被攻破**：如果能以你的用户身份读取主密钥或 `.data/`，加密无法阻止凭据泄露。
- **备份文件**：加密备份可以用口令解开，口令强度决定其安全性；请与账号密码同等保管，不要提交到 Git 或公开网盘。
- **TJUPT Cookie**：登录 Cookie 等同于账号权限；复制、粘贴和保存时请确认设备与通道可信。
- **明文 qBittorrent**：显式使用 HTTP 时，凭据与种子数据可能被同一网络中的攻击者读取。
- **站点侧与网络侧**：站点自身的安全性、账号封禁策略、运营商或代理对流量的观察，不由本项目控制。
- **暴力破解**：登录与配对有限流和锁定，但不能完全消除弱密码或分布式尝试的风险，请使用高强度管理密码。
- **桌面端验证边界**：Windows / Linux 客户端的编译、单元测试与安装包构建由 CI 覆盖，但当前开发机为 macOS，未在实体 Windows / Linux 设备上走查；安装包需要在对应系统上验收。
- **未签名的安装包**：Windows NSIS 与 Linux 安装包没有代码签名，无法从系统层面验证发布者；请只从本仓库 GitHub Releases 下载，并注意系统可能给出 SmartScreen 等提示。
- **非官方项目**：栖流与 M-Team、TJUPT、qBittorrent 无隶属关系，站点接口或页面结构变化可能带来功能与安全上的新问题。

## 使用建议

- 为栖流设置独立的高强度管理密码，不要复用 M-Team、TJUPT 或 qBittorrent 的密码。
- NAS 部署放在反向代理的 HTTPS 之后，不要直接把管理端口暴露到公网。
- 定期更新到最新版本，并关注 [CHANGELOG.md](CHANGELOG.md) 中的安全相关修复。
- 定期备份 `qiliu-data` 数据卷与 `.data/local.key`；桌面端则备份对应应用数据目录的 `local.key` 与 `vault.enc`。备份文件与密码分开保管。
- 不要把 `.data/`、`.env`、`secrets/`、真实站点截图或备份 JSON 提交到任何仓库。
