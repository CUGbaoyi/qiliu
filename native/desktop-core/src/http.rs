//! read / write / http 三个桥接动作：与 macOS/Android 壳的返回结构保持一致。
//!
//! 安全边界：
//! - 拒绝 URL 中的用户名、密码与 fragment；
//! - mteam/tjupt/rss/torrent 仅允许 https，qb 允许 http/https；
//! - 除 qb 外解析全部 A/AAAA，命中私有/保留/回环/链路本地/多播地址即拒绝（SSRF）；
//! - 只透传 Content-Type、x-api-key、Cookie、Origin、Referer；
//! - 不跟随重定向、15 秒超时、请求/响应体上限 4MB。

use std::io::Read;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::Serialize;
use serde_json::{json, Value};
use url::Url;

use crate::allowlist::{self, Kind};
use crate::ssrf;
use crate::vault::Vault;

/// 请求体与响应体大小上限：4MB。
pub const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;
/// 网络超时：15 秒。
pub const TIMEOUT: Duration = Duration::from_secs(15);
/// 固定 User-Agent，与契约一致。
pub const USER_AGENT: &str = "Qiliu/0.5";
/// 允许透传的请求头（名称大小写与现有原生壳一致）。
pub const FORWARDED_HEADERS: &[&str] =
    &["Content-Type", "x-api-key", "Cookie", "Origin", "Referer"];
/// 允许的 HTTP 方法。
pub const ALLOWED_METHODS: &[&str] = &["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

/// 已通过安全校验、可发送的 HTTP 请求。
#[derive(Debug)]
pub struct Prepared {
    /// 请求类型。
    pub kind: Kind,
    /// 已解析并校验的 URL。
    pub url: Url,
    /// 大写 HTTP 方法。
    pub method: String,
    /// 透传的请求头。
    pub headers: Vec<(String, String)>,
    /// 请求体字节。
    pub body: Vec<u8>,
}

/// http 动作的返回负载（camelCase 对齐前端契约）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResult {
    status: u16,
    body: String,
    body_base64: String,
    location: String,
    cookie: String,
}

/// 处理前端桥接请求：read / write / http。
pub fn handle(request: &Value, vault: &Vault) -> Result<Value, String> {
    let action = request
        .get("action")
        .and_then(Value::as_str)
        .ok_or_else(|| "不支持的操作".to_string())?;
    match action {
        "read" => Ok(json!({ "value": vault.read()? })),
        "write" => {
            let value = request
                .get("value")
                .and_then(Value::as_str)
                .ok_or_else(|| "无效数据".to_string())?;
            vault.write(value)?;
            Ok(json!({ "value": true }))
        }
        "http" => {
            let prepared = prepare(request)?;
            send(&prepared)
        }
        _ => Err("不支持的操作".to_string()),
    }
}

/// 解析并校验 http 请求；所有拒绝都在发起网络连接之前完成。
pub fn prepare(request: &Value) -> Result<Prepared, String> {
    let kind_text = request
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| "无效地址".to_string())?;
    let raw_url = request
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| "无效地址".to_string())?;
    let kind = Kind::parse(kind_text)?;
    let url = Url::parse(raw_url).map_err(|_| "无效地址".to_string())?;

    validate_url(kind, &url)?;
    allowlist::check(kind, &url)?;
    if kind.requires_public_host() {
        ssrf::ensure_public_host(url.host_str().unwrap_or_default())?;
    }

    let method = request
        .get("method")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("GET")
        .to_ascii_uppercase();
    if !ALLOWED_METHODS.contains(&method.as_str()) {
        return Err("无效请求方法。".to_string());
    }

    Ok(Prepared {
        kind,
        url,
        method,
        headers: forward_headers(request)?,
        body: request_body(request)?,
    })
}

/// 发送请求并返回与原生壳一致的 JSON 结构；3xx 原样返回 location，不跟随。
pub fn send(prepared: &Prepared) -> Result<Value, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout(TIMEOUT)
        .redirects(0)
        .user_agent(USER_AGENT)
        .build();
    let mut request = agent.request(&prepared.method, prepared.url.as_str());
    for (name, value) in &prepared.headers {
        request = request.set(name, value);
    }
    let response = if prepared.body.is_empty() {
        request.call()
    } else {
        request.send_bytes(&prepared.body)
    };
    let response = match response {
        Ok(response) => response,
        // 4xx/5xx 在 ureq 中表现为 Status 错误，但仍需把状态码与响应体原样返回给前端。
        Err(ureq::Error::Status(_, response)) => response,
        Err(error) => return Err(transport_error(&error)),
    };

    let status = response.status();
    let location = response.header("location").unwrap_or_default().to_string();
    let cookie = response.all("set-cookie").join(", ");
    let mut reader = response.into_reader().take((MAX_BODY_BYTES + 1) as u64);
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .map_err(|_| "读取响应失败。".to_string())?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err("响应超过大小限制。".to_string());
    }
    build_result(
        status,
        &bytes,
        location,
        cookie,
        prepared.kind == Kind::Torrent,
    )
}

/// 组装返回结构：torrent 返回二进制 bodyBase64，其余按 UTF-8（非法字节 lossy）。
fn build_result(
    status: u16,
    bytes: &[u8],
    location: String,
    cookie: String,
    binary: bool,
) -> Result<Value, String> {
    let (body, body_base64) = if binary {
        (String::new(), BASE64.encode(bytes))
    } else {
        (String::from_utf8_lossy(bytes).into_owned(), String::new())
    };
    let payload = HttpResult {
        status,
        body,
        body_base64,
        location,
        cookie,
    };
    let value = serde_json::to_value(payload).map_err(|_| "响应序列化失败。".to_string())?;
    Ok(json!({ "value": value }))
}

/// URL 基础校验：拒绝 userinfo/fragment，并限制 scheme。
fn validate_url(kind: Kind, url: &Url) -> Result<(), String> {
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("无效地址".to_string());
    }
    let allowed_scheme = match kind {
        Kind::Qb => matches!(url.scheme(), "http" | "https"),
        _ => url.scheme() == "https",
    };
    if !allowed_scheme {
        return Err("站点与 RSS 需要 HTTPS；下载器支持 HTTP 和 HTTPS。".to_string());
    }
    Ok(())
}

/// 只保留白名单请求头，并拒绝带换行的头值（防注入）。
fn forward_headers(request: &Value) -> Result<Vec<(String, String)>, String> {
    let mut headers = Vec::new();
    if let Some(object) = request.get("headers").and_then(Value::as_object) {
        for name in FORWARDED_HEADERS {
            if let Some(value) = object.get(*name).and_then(Value::as_str) {
                if value.contains('\r') || value.contains('\n') {
                    return Err("请求头无效。".to_string());
                }
                headers.push(((*name).to_string(), value.to_string()));
            }
        }
    }
    Ok(headers)
}

/// 组装请求体：bodyBase64 优先（种子二进制），否则 UTF-8 body；上限 4MB。
fn request_body(request: &Value) -> Result<Vec<u8>, String> {
    let encoded = request
        .get("bodyBase64")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !encoded.is_empty() {
        if encoded.len() > MAX_BODY_BYTES / 3 * 4 + 8 {
            return Err("请求数据过大。".to_string());
        }
        let body = BASE64
            .decode(encoded)
            .map_err(|_| "种子数据无效".to_string())?;
        if body.len() > MAX_BODY_BYTES {
            return Err("请求数据过大。".to_string());
        }
        return Ok(body);
    }
    let body = request
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if body.len() > MAX_BODY_BYTES {
        return Err("请求数据过大。".to_string());
    }
    Ok(body.as_bytes().to_vec())
}

/// 把底层传输错误转换为中文提示，不泄露内部细节。
fn transport_error(error: &ureq::Error) -> String {
    let text = error.to_string().to_lowercase();
    if text.contains("timed out") || text.contains("timeout") || text.contains("deadline") {
        "连接超时，请检查站点或网络。".to_string()
    } else if text.contains("dns")
        || text.contains("resolve")
        || text.contains("name or service not known")
    {
        "域名无法解析。".to_string()
    } else {
        "连接失败，请检查站点地址、网络或证书。".to_string()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn build_result_uses_camel_case_and_torrent_is_binary() {
        // 普通响应：非法 UTF-8 用 lossy 替换，不 panic。
        let text = build_result(200, b"ok\xff", String::new(), String::new(), false)
            .expect("组装文本响应");
        let value = &text["value"];
        assert_eq!(value["status"], json!(200));
        assert_eq!(value["body"], json!("ok\u{fffd}"));
        assert_eq!(value["bodyBase64"], json!(""));
        assert_eq!(value["location"], json!(""));
        assert_eq!(value["cookie"], json!(""));

        // 种子响应：body 为空，bodyBase64 为原始字节。
        let torrent = build_result(200, &[0x64, 0x38, 0xff], String::new(), String::new(), true)
            .expect("组装种子响应");
        assert_eq!(torrent["value"]["body"], json!(""));
        assert_eq!(torrent["value"]["bodyBase64"], json!("ZDj/"));
    }

    #[test]
    fn build_result_keeps_redirect_location_and_merged_cookies() {
        let value = build_result(
            302,
            b"",
            "/login.php".to_string(),
            "a=1; path=/, b=2".to_string(),
            false,
        )
        .expect("组装跳转响应");
        assert_eq!(value["value"]["status"], json!(302));
        assert_eq!(value["value"]["location"], json!("/login.php"));
        assert_eq!(value["value"]["cookie"], json!("a=1; path=/, b=2"));
    }

    #[test]
    fn prepare_rejects_missing_or_unknown_fields() {
        assert!(prepare(&json!({})).is_err());
        assert!(prepare(&json!({ "kind": "mteam" })).is_err());
        assert!(prepare(&json!({ "url": "https://api.m-team.cc/api/member/profile" })).is_err());
        assert!(prepare(&json!({ "kind": "ftp", "url": "https://example.invalid/" })).is_err());
        assert!(prepare(&json!({ "kind": "mteam", "url": "不是网址" })).is_err());
    }

    #[test]
    fn prepare_rejects_userinfo_and_fragment() {
        assert!(
            prepare(&json!({ "kind": "rss", "url": "https://user:pass@8.8.8.8/feed" })).is_err()
        );
        assert!(prepare(&json!({ "kind": "rss", "url": "https://user@8.8.8.8/feed" })).is_err());
        assert!(prepare(&json!({ "kind": "rss", "url": "https://8.8.8.8/feed#frag" })).is_err());
    }

    #[test]
    fn prepare_enforces_scheme_per_kind() {
        // 站点与 RSS 仅 https。
        assert!(prepare(
            &json!({ "kind": "mteam", "url": "http://api.m-team.cc/api/member/profile" })
        )
        .is_err());
        assert!(prepare(&json!({ "kind": "rss", "url": "http://8.8.8.8/feed" })).is_err());
        assert!(prepare(&json!({ "kind": "torrent", "url": "http://8.8.8.8/a.torrent" })).is_err());
        // qb 允许 http（本机服务不需要 SSRF 校验，也不会触发 DNS 解析）。
        assert!(prepare(
            &json!({ "kind": "qb", "url": "http://127.0.0.1:8080/api/v2/auth/login" })
        )
        .is_ok());
        assert!(prepare(
            &json!({ "kind": "qb", "url": "https://127.0.0.1:8080/api/v2/transfer/info" })
        )
        .is_ok());
    }

    #[test]
    fn prepare_rejects_private_hosts_for_non_qb() {
        assert!(prepare(&json!({ "kind": "rss", "url": "https://127.0.0.1/feed" })).is_err());
        assert!(prepare(&json!({ "kind": "rss", "url": "https://10.0.0.1/feed" })).is_err());
        assert!(
            prepare(&json!({ "kind": "torrent", "url": "https://192.168.1.2/a.torrent" })).is_err()
        );
        assert!(prepare(&json!({ "kind": "rss", "url": "https://[::1]/feed" })).is_err());
        // 公网 IP 字面量不做 DNS，直接通过。
        assert!(prepare(&json!({ "kind": "rss", "url": "https://8.8.8.8/feed" })).is_ok());
    }

    #[test]
    fn prepare_rejects_allowlist_violations() {
        assert!(prepare(
            &json!({ "kind": "mteam", "url": "https://evil.example/api/member/profile" })
        )
        .is_err());
        assert!(
            prepare(&json!({ "kind": "mteam", "url": "https://api.m-team.cc/api/evil" })).is_err()
        );
        assert!(
            prepare(&json!({ "kind": "tjupt", "url": "https://evil.example/torrents.php" }))
                .is_err()
        );
        assert!(
            prepare(&json!({ "kind": "tjupt", "url": "https://tjupt.org/admin.php" })).is_err()
        );
        assert!(prepare(
            &json!({ "kind": "qb", "url": "http://127.0.0.1:8080/api/v2/torrents/delete" })
        )
        .is_err());
    }

    #[test]
    fn prepare_forwards_only_allowlisted_headers() {
        let prepared = prepare(&json!({
            "kind": "qb",
            "url": "http://127.0.0.1:8080/api/v2/torrents/add",
            "method": "post",
            "headers": {
                "Content-Type": "application/x-www-form-urlencoded",
                "x-api-key": "key-1",
                "Cookie": "SID=abc",
                "Authorization": "Bearer secret",
                "X-Forwarded-For": "1.2.3.4"
            }
        }))
        .expect("qb 请求应通过校验");
        assert_eq!(prepared.method, "POST");
        assert_eq!(prepared.headers.len(), 3);
        let names: Vec<&str> = prepared
            .headers
            .iter()
            .map(|(name, _)| name.as_str())
            .collect();
        assert!(names.contains(&"Content-Type"));
        assert!(names.contains(&"x-api-key"));
        assert!(names.contains(&"Cookie"));
        assert!(!names.contains(&"Authorization"));
        assert!(!names.contains(&"X-Forwarded-For"));
    }

    #[test]
    fn prepare_rejects_header_injection() {
        assert!(prepare(&json!({
            "kind": "qb",
            "url": "http://127.0.0.1:8080/api/v2/torrents/info",
            "headers": { "Cookie": "a=1\r\nX-Evil: 1" }
        }))
        .is_err());
    }

    #[test]
    fn prepare_rejects_invalid_method() {
        assert!(prepare(&json!({
            "kind": "qb",
            "url": "http://127.0.0.1:8080/api/v2/torrents/info",
            "method": "TRACE"
        }))
        .is_err());
        let prepared = prepare(&json!({
            "kind": "qb",
            "url": "http://127.0.0.1:8080/api/v2/torrents/info"
        }))
        .expect("默认 GET");
        assert_eq!(prepared.method, "GET");
    }

    #[test]
    fn prepare_decodes_base64_body_and_rejects_bad_or_oversized_body() {
        let prepared = prepare(&json!({
            "kind": "qb",
            "url": "http://127.0.0.1:8080/api/v2/torrents/add",
            "bodyBase64": "ZDg6YW5ub3VuY2U="
        }))
        .expect("合法 base64 请求体");
        assert_eq!(prepared.body, b"d8:announce");
        assert!(prepare(&json!({
            "kind": "qb",
            "url": "http://127.0.0.1:8080/api/v2/torrents/add",
            "bodyBase64": "***"
        }))
        .is_err());
        let oversized = "a".repeat(MAX_BODY_BYTES + 1);
        assert!(prepare(&json!({
            "kind": "qb",
            "url": "http://127.0.0.1:8080/api/v2/torrents/add",
            "body": oversized
        }))
        .is_err());
    }

    #[test]
    fn handle_reads_and_writes_vault() {
        let root = tempfile::tempdir().expect("临时目录");
        let vault = Vault::open(root.path()).expect("打开 Vault");
        let empty = handle(&json!({ "action": "read" }), &vault).expect("读取空 Vault");
        assert_eq!(empty["value"], json!(""));
        let written = handle(
            &json!({ "action": "write", "value": "{\"qb\":null}" }),
            &vault,
        )
        .expect("写入");
        assert_eq!(written["value"], json!(true));
        let read = handle(&json!({ "action": "read" }), &vault).expect("读取");
        assert_eq!(read["value"], json!("{\"qb\":null}"));
    }

    #[test]
    fn handle_rejects_bad_actions_and_parameters() {
        let root = tempfile::tempdir().expect("临时目录");
        let vault = Vault::open(root.path()).expect("打开 Vault");
        assert_eq!(
            handle(&json!({ "action": "remove" }), &vault).expect_err("未知动作"),
            "不支持的操作"
        );
        assert!(handle(&json!({}), &vault).is_err());
        assert!(handle(&json!({ "action": "write" }), &vault).is_err());
        assert!(handle(&json!({ "action": "write", "value": 1 }), &vault).is_err());
        assert!(handle(&json!({ "action": "http" }), &vault).is_err());
        assert!(handle(&json!({ "action": "http", "kind": "mteam" }), &vault).is_err());
        assert!(handle(
            &json!({ "action": "http", "kind": "ftp", "url": "https://8.8.8.8/" }),
            &vault
        )
        .is_err());
        assert!(handle(
            &json!({ "action": "http", "kind": "mteam", "url": "http://api.m-team.cc/api/member/profile" }),
            &vault
        )
        .is_err());
        assert!(handle(
            &json!({ "action": "http", "kind": "rss", "url": "https://127.0.0.1/feed" }),
            &vault
        )
        .is_err());
    }
}
