mod menu;
mod sidecar;

use std::sync::Mutex;

use sidecar::{SidecarState, ServerStatus};
use tauri::{Emitter, Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SidecarState::new())
        .setup(|app| {
            // ---- Resolve where the SQLite DB should live -------------------------------
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("failed to create app data dir");
            let db_path = app_data_dir.join("stats.db");

            // ---- Native menu bar -------------------------------------------------------
            let menu = menu::build_menu(app.handle())?;
            app.set_menu(menu)?;

            // ---- Window chrome ----------------------------------------------------------
            // macOS: keep decorations + overlay style so the native traffic lights sit
            // on top of the custom titlebar. Windows/Linux: hide decorations so the
            // custom titlebar's min/max/close buttons are the only chrome.
            #[cfg(not(target_os = "macos"))]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
            }

            // ---- System tray -----------------------------------------------------------
            menu::build_tray(app.handle())?;

            // ---- Start the Node sidecar ------------------------------------------------
            let port = sidecar::dashboard_port();
            if let Err(e) = sidecar::start(app.handle(), &db_path, &port) {
                eprintln!("[sidecar] failed to start: {e}");
                // The boot overlay will read status=failed and show guidance.
            }

            Ok(())
        })
        // ----- Tauri commands invoked from the SPA --------------------------------------
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            get_server_status,
            get_server_logs,
            trigger_rescan,
            get_platform,
        ])
        .on_menu_event(|app, event| menu::on_menu_event(app, event))
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Reap the sidecar on app exit.
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if let Some(state) = app.try_state::<SidecarState>() {
                    sidecar::shutdown(&state);
                }
            }
        });
}

/// Return the sidecar origin the SPA should fetch from.
#[tauri::command]
fn get_server_url(state: tauri::State<'_, SidecarState>) -> String {
    read_server_url(&state)
}

/// Clone the sidecar URL out of the mutex guard before use.
fn read_server_url(state: &SidecarState) -> String {
    let port = sidecar::dashboard_port();
    let url = state
        .url
        .lock()
        .map(|guard| guard.clone())
        .ok()
        .flatten();
    url.unwrap_or_else(|| format!("http://127.0.0.1:{port}"))
}

/// Full status snapshot for the boot overlay (status + url + message + logs).
#[tauri::command]
fn get_server_status(state: tauri::State<'_, SidecarState>) -> ServerStatus {
    state.snapshot()
}

/// Just the recent log lines (lighter-weight poll).
#[tauri::command]
fn get_server_logs(state: tauri::State<'_, SidecarState>) -> Vec<String> {
    state.logs.lock().map(|l| l.clone()).unwrap_or_default()
}

/// Report the host OS so the renderer can choose the right titlebar chrome
/// (macOS keeps the native traffic lights; Windows/Linux show custom buttons).
#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

/// Trigger a rescan from native surfaces (tray / menu) without a focused window.
///
/// Posts to the sidecar's `/api/scan` endpoint over a raw HTTP request (so it
/// works even when the webview is hidden), then notifies the SPA via event.
#[tauri::command]
fn trigger_rescan(app: tauri::AppHandle, state: tauri::State<'_, SidecarState>) -> Result<(), String> {
    let base_url = read_server_url(&state);
    let app_handle = app.clone();
    std::thread::spawn(move || {
        match http_post_json(&format!("{base_url}/api/scan"), r#"{"provider":"all","async":true}"#) {
            Ok(body) => {
                // Surface to the SPA so its ScanButton/toast can react.
                let _ = app_handle.emit("native-rescan", body);
            }
            Err(e) => {
                eprintln!("[sidecar] rescan POST failed: {e}");
            }
        }
    });
    Ok(())
}

/// Minimal blocking HTTP POST with a JSON body. Returns the raw response body.
/// Avoids pulling in an HTTP client dependency for a single localhost call.
fn http_post_json(url: &str, body: &str) -> Result<String, String> {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;

    let parsed = sidecar_parse_host_port_path(url).ok_or_else(|| format!("bad url: {url}"))?;
    let port: u16 = parsed.1.parse().map_err(|_| format!("bad port: {}", parsed.1))?;
    let ip: std::net::IpAddr = parsed
        .0
        .parse()
        .unwrap_or("127.0.0.1".parse().unwrap());
    let addr: SocketAddr = (ip, port).into();

    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2))
        .map_err(|e| format!("connect: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| format!("set_read_timeout: {e}"))?;
    let req = format!(
        "POST {} HTTP/1.0\r\nHost: {}:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        parsed.2,
        parsed.0,
        parsed.1,
        body.len(),
        body
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("write: {e}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|e| format!("read: {e}"))?;
    // Strip the HTTP status line + headers; return the body.
    Ok(response.split("\r\n\r\n").nth(1).unwrap_or("").to_string())
}

// Re-export the small URL helper from sidecar for the POST path above.
fn sidecar_parse_host_port_path(url: &str) -> Option<(String, String, String)> {
    let rest = url.strip_prefix("http://").or_else(|| url.strip_prefix("https://"))?;
    let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
    let (host, port) = authority.split_once(':').unwrap_or((authority, "80"));
    Some((host.to_string(), port.to_string(), format!("/{path}")))
}

// Keep a trivial guard so the Mutex import isn't flagged if unused after trimming.
#[allow(dead_code)]
type _UnusedMutex = Mutex<()>;
