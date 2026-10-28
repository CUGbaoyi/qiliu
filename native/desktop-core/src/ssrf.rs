//! SSRF 防护：判定地址是否属于公网可访问范围，规则对齐 `server/network.mjs` 的 `isPublicIP`。
//!
//! 除 qBittorrent（用户显式配置的下载器，允许本机/内网）外，所有请求都必须解析域名，
//! 任一 A/AAAA 记录落在私有、保留、回环、链路本地或多播地址段时直接拒绝。

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};

/// 解析 IP 字面量并判定是否公网；非 IP 字面量返回 `None`。
pub fn is_public_ip_str(text: &str) -> Option<bool> {
    text.parse::<IpAddr>().ok().map(is_public_ip)
}

/// 判定 IP 是否可公网访问。
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => is_public_ipv4(value),
        IpAddr::V6(value) => is_public_ipv6(value),
    }
}

/// IPv4 公网判定，规则与 `server/network.mjs` 一致。
pub fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    let (a, b) = (octets[0], octets[1]);
    !(a == 0
        || a == 10
        || a == 127
        || a >= 224
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && (b == 0 || b == 168))
        || (a == 198 && (b == 18 || b == 19 || b == 51))
        || (a == 203 && b == 0))
}

/// IPv6 公网判定：仅允许 2xxx/3xxx 开头的全局单播，排除 2001:0:/db8:/10: 与 2002: 转换段。
pub fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    // 对应正则 ^[23]i：首个十六进制字符为 2 或 3，即首个字节落在 0x20..=0x3f。
    let high_nibble = segments[0] >> 12;
    if high_nibble != 0x2 && high_nibble != 0x3 {
        return false;
    }
    let transition = match (segments[0], segments[1]) {
        (0x2001, 0x0000) => true, // 2001:0::/32（Teredo）
        (0x2001, 0x0db8) => true, // 2001:db8::/32（文档保留）
        (0x2001, 0x0010) => true, // 2001:10::/28（ORCHID）
        (0x2002, _) => true,      // 2002::/16（6to4）
        _ => false,
    };
    !transition
}

/// 校验主机不会解析到内网/保留地址。
///
/// - IP 字面量：直接判定，不触发 DNS；
/// - 域名：用系统解析器取全部 A/AAAA，任一记录非公网即拒绝。
pub fn ensure_public_host(host: &str) -> Result<(), String> {
    let host = crate::allowlist::strip_brackets(host);
    if let Ok(ip) = host.parse::<IpAddr>() {
        return if is_public_ip(ip) {
            Ok(())
        } else {
            Err("不能连接本地或内网地址。".to_string())
        };
    }
    let mut resolved = false;
    let addresses = (host, 0u16)
        .to_socket_addrs()
        .map_err(|_| "域名无法解析。".to_string())?;
    for address in addresses {
        resolved = true;
        if !is_public_ip(address.ip()) {
            return Err("站点地址不能解析到内网或保留地址。".to_string());
        }
    }
    if !resolved {
        return Err("域名无法解析。".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn public(text: &str) -> bool {
        is_public_ip_str(text).expect("应当是合法 IP")
    }

    #[test]
    fn public_ipv4_addresses_are_allowed() {
        for address in [
            "8.8.8.8",
            "1.1.1.1",
            "223.5.5.5",
            "100.128.0.1",
            "172.32.0.1",
            "203.1.1.1",
        ] {
            assert!(public(address), "{address} 应视为公网");
        }
    }

    #[test]
    fn private_and_reserved_ipv4_addresses_are_rejected() {
        for address in [
            "0.0.0.0",
            "10.0.0.1",
            "127.0.0.1",
            "100.64.0.1",
            "100.127.255.254",
            "169.254.1.1",
            "172.16.0.1",
            "172.31.255.255",
            "192.0.2.1",
            "192.168.1.1",
            "198.18.0.1",
            "198.19.1.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "255.255.255.255",
        ] {
            assert!(!public(address), "{address} 应视为内网或保留地址");
        }
    }

    #[test]
    fn public_ipv6_addresses_are_allowed() {
        for address in [
            "2606:4700:4700::1111",
            "2400:3200::1",
            "3fff::1",
            "2001:4860:4860::8888",
        ] {
            assert!(public(address), "{address} 应视为公网");
        }
    }

    #[test]
    fn private_and_reserved_ipv6_addresses_are_rejected() {
        for address in [
            "::1",
            "::",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "ff02::1",
            "2001:0:0:0:0:0:0:1",
            "2001:db8::1",
            "2001:10::1",
            "2002::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!public(address), "{address} 应视为内网或保留地址");
        }
    }

    #[test]
    fn ensure_public_host_handles_literals_without_dns() {
        assert!(ensure_public_host("8.8.8.8").is_ok());
        assert!(ensure_public_host("[8.8.8.8]").is_ok());
        assert!(ensure_public_host("2606:4700:4700::1111").is_ok());
        assert!(ensure_public_host("127.0.0.1").is_err());
        assert!(ensure_public_host("[::1]").is_err());
        assert!(ensure_public_host("192.168.1.10").is_err());
        assert!(ensure_public_host("169.254.169.254").is_err());
    }

    #[test]
    fn non_ip_text_is_not_an_ip_literal() {
        assert_eq!(is_public_ip_str("example.com"), None);
        assert_eq!(is_public_ip_str(""), None);
    }
}
