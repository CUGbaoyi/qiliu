//! 栖流（QILIU）Windows/Linux 桌面客户端共享纯 Rust 核心库。
//!
//! 只包含站点白名单、SSRF 防护、本机加密存储与 HTTP 桥接，不依赖 Tauri/GUI，
//! 因此可在任意平台独立 `cargo test`。Tauri 壳（`src-tauri`）按以下方式调用：
//!
//! ```ignore
//! let vault = qiliu_desktop_core::Vault::open(dir)?;
//! let result = qiliu_desktop_core::handle(&request, &vault)?;
//! ```
//!
//! `handle` 支持 `read` / `write` / `http` 三个 action，返回结构与 macOS/Android 壳一致。

#![forbid(unsafe_code)]

pub mod allowlist;
pub mod http;
pub mod ssrf;
pub mod vault;

pub use http::handle;
pub use vault::Vault;
