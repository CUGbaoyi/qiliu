//! 站点白名单：与 `server/sites.mjs`、macOS/Android 原生壳保持同步。
//!
//! 白名单常量必须写成带双引号的字符串字面量，`tests/sites-allowlist.test.mjs`
//! 会用 `text.includes("\"path\"")` 校验本文件与共享清单一致。

use url::Url;

/// M-Team API 允许的主机。
pub const MTEAM_HOSTS: &[&str] = &["api.m-team.cc", "api.m-team.io"];

/// M-Team API 允许的路径（精确匹配）。
pub const MTEAM_PATHS: &[&str] = &[
    "/api/member/profile",
    "/api/tracker/myPeerStatistics",
    "/api/tracker/myPeerStatus",
    "/api/tracker/mybonus",
    "/api/torrent/search",
    "/api/torrent/genDlToken",
];

/// TJUPT 允许的主机。
pub const TJUPT_HOSTS: &[&str] = &["tjupt.org", "www.tjupt.org"];

/// TJUPT 允许的路径（精确匹配）。
pub const TJUPT_PATHS: &[&str] = &[
    "/login.php",
    "/takelogin.php",
    "/usercp.php",
    "/index.php",
    "/userdetails.php",
    "/mybonus.php",
    "/getusertorrentlistajax.php",
    "/torrents.php",
    "/details.php",
    "/download.php",
    "/torrentrss.php",
];

/// qBittorrent Web API 允许的路径后缀（下载器地址由用户自行配置）。
pub const QB_PATHS: &[&str] = &[
    "/api/v2/auth/login",
    "/api/v2/transfer/info",
    "/api/v2/torrents/info",
    "/api/v2/torrents/add",
    "/api/v2/torrents/categories",
    "/api/v2/app/defaultSavePath",
];

/// 请求类型：与前端 `nativeCall('http', { kind, ... })` 中的 kind 一一对应。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// M-Team 开放 API。
    MTeam,
    /// TJUPT（NexusPHP 页面）。
    Tjupt,
    /// RSS 订阅。
    Rss,
    /// 种子文件下载。
    Torrent,
    /// qBittorrent Web API（用户显式配置的下载器）。
    Qb,
}

impl Kind {
    /// 解析前端传入的 kind 字符串；未知类型直接拒绝。
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "mteam" => Ok(Self::MTeam),
            "tjupt" => Ok(Self::Tjupt),
            "rss" => Ok(Self::Rss),
            "torrent" => Ok(Self::Torrent),
            "qb" => Ok(Self::Qb),
            _ => Err("无效地址".to_string()),
        }
    }

    /// 是否需要解析域名并做 SSRF 校验（qBittorrent 是用户本机/内网服务，不做限制）。
    pub fn requires_public_host(self) -> bool {
        !matches!(self, Self::Qb)
    }
}

/// 取出 URL 的主机名并统一小写（IPv6 去掉方括号）。
pub fn host_of(url: &Url) -> Option<String> {
    url.host_str()
        .map(|host| strip_brackets(host).to_ascii_lowercase())
}

/// 去掉 IPv6 字面量的方括号，例如 `[::1]` → `::1`。
pub fn strip_brackets(host: &str) -> &str {
    let trimmed = host.strip_prefix('[').unwrap_or(host);
    trimmed.strip_suffix(']').unwrap_or(trimmed)
}

/// 按 kind 校验主机与路径；域名解析与 SSRF 校验由 `ssrf` 模块负责。
pub fn check(kind: Kind, url: &Url) -> Result<(), String> {
    match kind {
        Kind::MTeam => {
            let host = host_of(url).ok_or_else(|| "无效地址".to_string())?;
            if !MTEAM_HOSTS.contains(&host.as_str()) || !MTEAM_PATHS.contains(&url.path()) {
                return Err("无效 M-Team 操作".to_string());
            }
        }
        Kind::Tjupt => {
            let host = host_of(url).ok_or_else(|| "无效地址".to_string())?;
            if !TJUPT_HOSTS.contains(&host.as_str()) || !TJUPT_PATHS.contains(&url.path()) {
                return Err("无效 TJUPT 操作".to_string());
            }
        }
        Kind::Qb => {
            let path = url.path();
            if !QB_PATHS.iter().any(|suffix| path.ends_with(suffix)) {
                return Err("不支持的下载器操作".to_string());
            }
        }
        // RSS 与种子下载允许任意 https 公网主机，由 SSRF 校验兜底。
        Kind::Rss | Kind::Torrent => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).expect("测试用 URL 应当合法")
    }

    #[test]
    fn mteam_accepts_only_allowlisted_host_and_path() {
        for host in MTEAM_HOSTS {
            for path in MTEAM_PATHS {
                let target = url(&format!("https://{host}{path}"));
                assert!(check(Kind::MTeam, &target).is_ok(), "{host}{path} 应被允许");
            }
        }
        assert!(check(Kind::MTeam, &url("https://evil.example/api/member/profile")).is_err());
        assert!(check(
            Kind::MTeam,
            &url("https://api.m-team.cc/api/torrent/delete")
        )
        .is_err());
        assert!(check(
            Kind::MTeam,
            &url("https://api.m-team.cc/api/member/profile/extra")
        )
        .is_err());
    }

    #[test]
    fn tjupt_accepts_only_allowlisted_host_and_path() {
        for host in TJUPT_HOSTS {
            for path in TJUPT_PATHS {
                let target = url(&format!("https://{host}{path}"));
                assert!(check(Kind::Tjupt, &target).is_ok(), "{host}{path} 应被允许");
            }
        }
        assert!(check(Kind::Tjupt, &url("https://evil.example/torrents.php")).is_err());
        assert!(check(Kind::Tjupt, &url("https://tjupt.org/admin.php")).is_err());
    }

    #[test]
    fn qb_accepts_known_suffixes_with_query() {
        for path in QB_PATHS {
            let target = url(&format!("http://127.0.0.1:8080{path}"));
            assert!(check(Kind::Qb, &target).is_ok(), "{path} 应被允许");
        }
        let with_query = url("http://192.168.1.2:8080/api/v2/torrents/info?filter=active&limit=20");
        assert!(check(Kind::Qb, &with_query).is_ok());
        assert!(check(
            Kind::Qb,
            &url("http://127.0.0.1:8080/api/v2/torrents/delete")
        )
        .is_err());
        assert!(check(
            Kind::Qb,
            &url("http://127.0.0.1:8080/api/v2/transfer/info/extra")
        )
        .is_err());
    }

    #[test]
    fn rss_and_torrent_allow_any_https_host() {
        assert!(check(Kind::Rss, &url("https://feed.example.invalid/rss")).is_ok());
        assert!(check(
            Kind::Torrent,
            &url("https://tracker.example.invalid/download?id=1")
        )
        .is_ok());
    }

    #[test]
    fn kind_parser_rejects_unknown_values() {
        assert_eq!(Kind::parse("mteam").ok(), Some(Kind::MTeam));
        assert_eq!(Kind::parse("qb").ok(), Some(Kind::Qb));
        assert!(Kind::parse("ftp").is_err());
        assert!(Kind::parse("").is_err());
    }

    #[test]
    fn host_of_strips_ipv6_brackets_and_lowercases() {
        assert_eq!(host_of(&url("https://[::1]/x")).as_deref(), Some("::1"));
        assert_eq!(
            host_of(&url("https://API.M-Team.CC/x")).as_deref(),
            Some("api.m-team.cc")
        );
        assert_eq!(strip_brackets("[2001:db8::1]"), "2001:db8::1");
        assert_eq!(strip_brackets("example.com"), "example.com");
    }
}
