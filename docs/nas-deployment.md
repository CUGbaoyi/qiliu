# NAS Docker 部署

栖流可以以 Docker 容器的方式常驻 NAS 运行，手机和电脑浏览器都能访问，不需要 Mac 开机。镜像基于 `node:22-bookworm-slim` 构建，支持 Linux amd64（Intel/AMD）与 arm64 NAS。

Android APK 与 macOS 客户端各自直连站点和下载器，不依赖 NAS 容器；NAS 适合需要 7×24 常驻、多设备共享同一实例的场景。

## 前置条件

- 已安装 Docker Engine 与 Docker Compose v2。
- NAS 能拉取 `node:22-bookworm-slim` 基础镜像与 npm 依赖（构建在容器内完成，**不需要**在 NAS 上安装 Node.js）。
- 一个浏览器可访问的地址：局域网 IP、公网域名（建议 HTTPS 反向代理）或 IPv6。

仓库根目录提供了 [`Dockerfile`](../Dockerfile)、[`compose.yaml`](../compose.yaml) 与 [`.env.example`](../.env.example)。

## 部署步骤

以下命令均以项目根目录为工作目录，部署目录示例为 `/docker/qiliu`。

1. 获取源码（`git clone` 或解压源码包）到 NAS，例如 `/docker/qiliu`，并进入该目录。

2. 复制环境变量文件并填写访问地址：

   ```sh
   cp .env.example .env
   ```

   编辑 `.env` 中的 `QILIU_PUBLIC_ORIGIN`，填写浏览器实际访问的完整 origin（协议 + 主机 + 端口，**不要带路径**）：

   ```dotenv
   QILIU_PUBLIC_ORIGIN=http://192.168.1.100:4173
   # 反向代理 HTTPS 示例：https://qiliu.example.com
   # IPv6 示例：http://[fd00::1234]:4173
   ```

   Compose 会校验该变量，留空时会直接报错 `请在 .env 中填写访问地址`。

3. 创建管理密码文件。这是登录栖流的密码，至少 16 个字符，请勿填写 M-Team API Token：

   ```sh
   mkdir -p secrets
   printf '%s' '在这里填写至少16位的独立管理密码' > secrets/admin_password.txt
   chmod 700 secrets
   chmod 644 secrets/admin_password.txt
   ```

4. 构建并启动容器：

   ```sh
   docker compose up -d --build
   ```

5. 打开 `QILIU_PUBLIC_ORIGIN` 对应的地址，输入管理密码登录；进入「站点」页填写 M-Team、TJUPT、RSS 与 qBittorrent 连接。

## 离线镜像（可选）

如果已在本机构建并导出镜像（例如 `docker save -o qiliu-0.4.0.tar qiliu:0.4.0`），可以先在 NAS 上导入，避免现场构建：

```sh
docker load -i qiliu-0.4.0.tar
```

然后在 `.env` 中指定同一个镜像名：

```dotenv
QILIU_IMAGE=qiliu:0.4.0
```

之后跳过构建启动：

```sh
docker compose up -d --no-build
```

## 首次配置

登录后进入「站点」：

- **M-Team**：填写 API Access Token（M-Team 控制台 → 实验室 → 存取令牌）。
- **TJUPT**：填写用户名、密码，以及可选的 32 位 passkey；开启两步验证的账号改用浏览器登录 Cookie 连接。
- **RSS**：添加站点提供的订阅地址，多个订阅会汇总显示。
- **qBittorrent**：填写 Web UI 根地址、用户名与密码。若 qBittorrent 也以容器运行在同一 NAS，可让两个容器加入同一 Docker 网络，用服务名连接，例如 `http://qbittorrent:8080`，这样读取上传状态无需绕到公网 IPv6。

栖流不会内置或回填任何凭据，容器与镜像中也不包含个人密钥。

## IPv6 与 qBittorrent

IPv6 地址必须加方括号：

```text
http://[fd00::1234]:8080
https://[你的公网IPv6]:8443
```

- 填写 Web UI 根地址，不要填写磁力链接或 `/api/v2` 接口路径。
- 公网地址应使用 HTTPS；可信内网可以使用 HTTP，此时密码与种子数据以明文传输。
- 证书必须受信任，程序不提供跳过证书校验的选项。
- 要通过 IPv6 访问栖流，NAS 的端口映射、防火墙、IPv6 出站和 Docker 网络都需可用；`QILIU_PUBLIC_ORIGIN` 要填写完整入口（IPv6 同样需要方括号）。应用支持 IPv6 地址语法，但不能替 NAS 开启 IPv6 路由。
- 使用反向代理时请保留原始 `Host`，并让 `QILIU_PUBLIC_ORIGIN` 与浏览器地址完全一致（协议、主机、端口），否则请求会被来源校验拒绝。

## 数据与指标含义

- **实时上传/下载速度**：来自 qBittorrent Web API，前台每 5 秒刷新。
- **活跃任务**：下载器中的任务，展示上传速度最高的前 5 条。
- **在线做种/下载**：M-Team `/tracker/myPeerStatus`，前台每分钟刷新。
- **做种汇总/汇总体积**：M-Team `/tracker/myPeerStatistics`，可能与在线状态不同；体积接口不可用时显示「—」。
- **每小时魔力**：M-Team `/tracker/mybonus` 的 `formulaParams.finalBs`，是站点当前收益速率。
- **预计每日魔力**：当前每小时收益 × 24，仅为估算，不是实际到账或保证收益。
- **站点记账增量**：两次账号采样之间累计上传的差值，不是下载器实时速度。
- **TJUPT**：没有开放 API，账号统计与搜索来自登录后的页面解析；做种体积不可用或解析失败时显示「—」，该站点不展示累计下载与分享率。

## 数据持久化与备份

容器以非 root 用户运行，加密数据保存在 `qiliu-data` 命名卷的 `/data` 目录中，包含 `local.key` 与 `vault.enc`。普通重启与镜像更新不会丢失数据。

- **不要**执行 `docker compose down -v`，它会删除数据卷。
- 备份需要包含整个 `qiliu-data` 卷（`local.key` 与 `vault.enc` 缺一不可），管理密码文件请另行备份。
- 也可以在应用内使用「设置 → 备份与迁移」导出口令加密的配置 JSON，用于换机或恢复。
- 恢复时先停止容器，将卷数据恢复到原位置，再启动容器。

## 登录与维护

- 登录会话有效期 24 小时，容器重启后需要重新登录。
- 连续 5 次密码错误后锁定 15 分钟。
- 修改管理密码：编辑 `secrets/admin_password.txt` 后执行 `docker compose up -d --force-recreate`。
- 更新版本：更新源码后执行 `docker compose up -d --build`，数据卷保留；升级前建议阅读 [CHANGELOG.md](../CHANGELOG.md)。

常用命令：

```sh
docker compose logs --tail=50
docker compose ps
docker compose restart
```

## 常见问题

| 现象 | 排查方向 |
| --- | --- |
| Compose 报错 `请在 .env 中填写访问地址` | `.env` 中的 `QILIU_PUBLIC_ORIGIN` 为空或格式错误 |
| 页面提示「不允许的访问地址」或「请求来源不匹配」 | `QILIU_PUBLIC_ORIGIN` 与浏览器实际地址的协议/主机/端口不一致，或反向代理未保留 Host |
| 一直要求登录或登录后立即失效 | Cookie 需要与访问地址同源；检查是否通过不同域名/IP 混用访问 |
| 无法连接 qBittorrent | 检查地址、端口、容器网络与防火墙；同机容器优先用服务名连接 |
| TJUPT 账号数据全为「—」 | 站点改版导致页面解析失败，或登录态失效；重新登录并关注版本更新 |
| IPv6 访问失败 | 检查 NAS 的 IPv6 路由、端口映射、防火墙与 Docker 网络，`QILIU_PUBLIC_ORIGIN` 使用方括号 |
| 构建时拉取镜像或依赖失败 | 为 Docker 配置可用的镜像/代理源，或改用离线镜像 |

## 安全建议

- 在 NAS 上通过反向代理提供 HTTPS，不要把管理端口直接暴露到公网。
- 使用独立的高强度管理密码，不要复用站点或下载器密码。
- `secrets/` 目录仅允许当前用户访问；不要提交到 Git 或同步到公开网盘。
- 定期更新版本并备份数据卷；备份文件等同凭据，请妥善保管。

更多安全设计见 [SECURITY.md](../SECURITY.md)。本文是参考部署流程，不同 NAS 型号、Docker 与 Compose 版本、反向代理配置可能存在差异，请以实际环境为准。
