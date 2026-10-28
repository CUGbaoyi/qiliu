# Windows / Linux 桌面客户端

栖流 0.5.0 新增 Windows 与 Linux 独立桌面客户端。它使用 **Tauri 2**（Rust 壳 + 系统 WebView）加载同一份前端，设备直接连接站点与 qBittorrent，不需要额外常开一台服务端 Mac 或 NAS。

本文说明安装包获取、系统要求、从源码构建、数据位置、安全边界与常见问题。macOS、Android 与 Web/NAS 的说明见 [README](../README.md)。

## 获取安装包

安装包不进入 Git 仓库，随版本通过 **GitHub Releases** 发布。0.5.0 的桌面产物为：

| 系统 | 产物 |
| --- | --- |
| Windows 10 / 11（x64） | NSIS 安装包 `.exe` |
| Linux（x86_64） | `.deb` 安装包与 `.AppImage` |

下载时请注意：

- 只从本仓库的 GitHub Releases 获取，不要使用第三方转载的安装包。
- 安装包**未做代码签名**：Windows 可能弹出 SmartScreen 提示，Linux 包也没有发行版签名；这是当前版本的已知限制。
- 同一版本的 Android APK 与 macOS 通用包也可在 Releases 中找到。

## 系统要求

### Windows

- Windows 10 或 Windows 11（x64）。
- **WebView2 运行时**：Windows 11 与多数已更新的 Windows 10 已预装；若系统精简或长期未更新，可能缺失，需要安装 Microsoft Edge WebView2 Runtime（Evergreen）。
- 按 NSIS 向导安装即可。安装包未签名，首次运行可能被 SmartScreen 拦截。

### Linux

- x86_64，glibc 发行版（Debian / Ubuntu、Fedora、Arch 等）。
- **WebKitGTK 4.1** 与 GTK 3：Tauri 使用系统 WebView，必须由发行版提供。
  - Debian / Ubuntu：`libwebkit2gtk-4.1-0`（`.deb` 会声明该依赖）
  - Fedora：`webkit2gtk4.1`
  - Arch：`webkit2gtk-4.1`
- `.deb` 适合 Debian / Ubuntu 系；`.AppImage` 更通用，但同样依赖系统中已存在的 WebKitGTK 4.1、GTK 3 与基础图形库，AppImage 不会自带这些库。

## 从源码构建

### 依赖

- Node.js **>= 22** 与 npm。
- **Rust stable**（推荐用 `rustup` 安装）。
- Tauri 2 的系统依赖：
  - Windows：Microsoft C++ 生成工具（MSVC）与 WebView2 运行时。
  - Linux（Ubuntu 22.04 示例）：

    ```sh
    sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev \
      libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
    ```

### 构建命令

```sh
npm ci
npm run desktop:test    # cargo test --manifest-path native/desktop-core/Cargo.toml
npm run desktop:build   # 先 npm run build 构建前端，再 tauri build 当前系统
```

- `npm run desktop:build` 只构建**当前系统**的产物：在 Windows 上得到 NSIS `.exe`，在 Linux 上得到 `.deb` 与 `.AppImage`。跨系统构建请使用 CI。
- 也可以单独运行 `cargo test --manifest-path native/desktop-core/Cargo.toml` 验证 Rust 核心；前端与共享业务逻辑的检查仍然使用 `npm run check` 与 `npm test`。

### 产物路径

构建完成后，安装包位于 `src-tauri/target/release/bundle/` 下：

```text
src-tauri/target/release/bundle/
├── nsis/       Windows NSIS 安装包（.exe）
├── deb/        Linux .deb
└── appimage/   Linux .AppImage
```

`src-tauri/target/` 是编译缓存，不要提交到 Git。

## 数据与凭据

- 桌面端使用 Tauri 的 `app_data_dir` 保存本机数据：Windows 位于用户 AppData 目录，Linux 位于用户数据目录（`XDG_DATA_HOME`，默认 `~/.local/share` 下的应用目录）。
- 凭据保存为 `local.key`（Unix 上权限 0600）与 AES-256-GCM 加密的 `vault.enc`；Windows 依赖用户目录 ACL 隔离。
- 凭据不进入仓库、安装包或日志，也不回传渲染层；设置界面只回显已保存的地址与用户名等非敏感信息。
- 换机或重装前，可在应用内「设置 → 备份与迁移」导出加密 JSON，在新设备覆盖导入；备份文件等同于凭据，请妥善保管。
- 卸载应用不保证清理上述数据目录；如需保留配置请先导出备份，如需彻底清除请手动删除对应目录。

## 安全边界

Windows / Linux 桌面端的安全检查在 `native/desktop-core` 中实现，与 macOS 的 Swift 壳、Android 的 Java 壳保持一致：

- 站点请求只允许白名单内的官方主机与固定路径；RSS 与种子地址仅接受 HTTPS。
- 拒绝解析到回环、内网、链路本地、保留或组播地址（防 SSRF）。
- 强制 HTTPS 证书校验，不提供跳过校验的选项；qBittorrent 允许你显式配置 HTTP，此时凭据与种子数据以明文传输，请只在可信网络使用。
- 请求与响应体上限 4 MB、超时 15 秒，并禁止跟随重定向。
- 桥接只透传必要的请求头，前端通过检测 `window.__TAURI__` 后调用 Tauri command `qiliu` 的 read/write/http，不直接接触本机文件与网络。
- 桌面壳只加载应用内打包资源并复用既有 CSP，外部链接交给系统浏览器打开；无遥测、无中转服务器。

## 常见问题

| 现象 | 排查方向 |
| --- | --- |
| Windows 启动提示缺少 WebView2 | 安装 Microsoft Edge WebView2 Runtime；Windows 11 与多数 Windows 10 已预装 |
| Linux 启动报 WebKitGTK 相关错误 | 安装发行版提供的 WebKitGTK 4.1 与 GTK 3；`.AppImage` 也需要系统库 |
| 安装或运行时 SmartScreen 提示 | 安装包未签名；确认来自本仓库 GitHub Releases 后再选择继续 |
| `.deb` 安装提示依赖未满足 | 执行 `sudo apt install -f` 修复依赖，或改用 `.AppImage` |
| AppImage 双击无反应 | 确认已安装 FUSE，或使用 `--appimage-extract-and-run` 运行；同时检查 WebKitGTK |
| 找不到本机凭据或数据目录 | 数据在 `app_data_dir` 下；Windows 查看用户 AppData，Linux 查看 `~/.local/share` 对应目录 |
| 从源码构建失败 | 检查 Rust stable、Tauri 系统依赖与 Node 版本；先运行 `npm run desktop:test` 排除 Rust 核心问题 |

## 验证边界

- 当前开发机为 **macOS**，Windows / Linux 客户端的源码与 Rust 单元测试、安装包构建由 CI 覆盖，**尚未在实体 Windows / Linux 设备上走查**。
- Windows / Linux 安装包需要在对应系统上实际安装、启动并完成一次连接站点与 qBittorrent 的验收；本机 macOS 只能验证共享前端、Rust 单元测试与 macOS 客户端。
- 桌面 CI 工作流见 [`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml)，在 `windows-latest` 与 `ubuntu-22.04` 上运行 Rust 单元测试、构建并上传 artifacts。
- 遇到平台相关问题时，请附上系统版本、WebView 版本（WebView2 / WebKitGTK）与复现步骤；不要附真实账号、Cookie 或内网地址。

## 相关文档

- [README](../README.md)：功能、其他运行形态与快速开始
- [CONTRIBUTING.md](../CONTRIBUTING.md)：开发环境、检查命令与代码结构
- [SECURITY.md](../SECURITY.md)：凭据存储、威胁模型与漏洞报告
- [CHANGELOG.md](../CHANGELOG.md)：版本变更记录
