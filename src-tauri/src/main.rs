#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::Value;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

struct AppState {
    vault: qiliu_desktop_core::Vault,
}

/// 前端桥接：与 Android/macOS 壳相同的 read / write / http 三个动作。
#[tauri::command]
async fn qiliu(request: Value, state: State<'_, AppState>) -> Result<Value, String> {
    let vault = state.vault.clone();
    tauri::async_runtime::spawn_blocking(move || qiliu_desktop_core::handle(&request, &vault))
        .await
        .map_err(|error| format!("设备请求失败：{error}"))?
}

/// 外部链接交给系统默认浏览器，避免在应用内打开任意网页。
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "链接格式无效。".to_string())?;
    match parsed.scheme() {
        "http" | "https" => {
            open::that(parsed.as_str()).map_err(|_| "无法打开系统浏览器。".to_string())
        }
        _ => Err("仅支持打开 http/https 链接。".to_string()),
    }
}

const EXTERNAL_LINKS_SCRIPT: &str = r#"
(() => {
  const invoke = () => window.__TAURI__?.core?.invoke;
  const openExternal = (href) => {
    if (!/^https?:/i.test(href)) return;
    const fn = invoke();
    if (fn) fn('open_external', { url: href });
  };
  document.addEventListener('click', (event) => {
    const target = event.target;
    const link = target && target.closest ? target.closest('a[href]') : null;
    if (!link) return;
    if (/^https?:/i.test(link.href)) {
      event.preventDefault();
      openExternal(link.href);
    }
  }, true);
  window.open = (url) => {
    openExternal(String(url));
    return null;
  };
})();
"#;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![qiliu, open_external])
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("无法获取数据目录：{error}"))?;
            let vault = qiliu_desktop_core::Vault::open(&dir)?;
            app.manage(AppState { vault });

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("栖流")
                .inner_size(1320.0, 960.0)
                .min_inner_size(390.0, 620.0)
                .center()
                .initialization_script(EXTERNAL_LINKS_SCRIPT)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动栖流桌面端失败");
}
