use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;

const DEFAULT_DASHBOARD_PORT: &str = "3847";

struct DashboardServer(Mutex<Option<Child>>);

fn dashboard_port() -> String {
    std::env::var("AGENT_USAGE_DASHBOARD_PORT").unwrap_or_else(|_| DEFAULT_DASHBOARD_PORT.to_string())
}

fn resolve_cli_script() -> PathBuf {
    if let Ok(custom) = std::env::var("AGENT_USAGE_CLI") {
        return PathBuf::from(custom);
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .join("..")
        .join("..")
        .join("cli")
        .join("dist")
        .join("index.js")
}

fn start_dashboard(db_path: &PathBuf, port: &str) -> Result<Child, String> {
    let cli_script = resolve_cli_script();
    if !cli_script.exists() {
        return Err(format!(
            "CLI not found at {}. Run `pnpm build` from the repository root.",
            cli_script.display()
        ));
    }

    let child = Command::new("node")
        .arg(&cli_script)
        .args(["dashboard", "--port", port, "--host", "127.0.0.1", "--no-open"])
        .env("AGENT_USAGE_DB_PATH", db_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn dashboard: {e}"))?;

    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DashboardServer(Mutex::new(None)))
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app data dir: {e}"))?;
            std::fs::create_dir_all(&app_data_dir).map_err(|e| format!("create app data: {e}"))?;

            let db_path = app_data_dir.join("stats.db");
            let port = dashboard_port();

            let child = start_dashboard(&db_path, &port)?;
            *app.state::<DashboardServer>().0.lock().unwrap() = Some(child);

            // Brief pause so the splash page can poll before redirect.
            std::thread::sleep(Duration::from_millis(300));

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(mut child) = app.state::<DashboardServer>().0.lock().unwrap().take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        });
}
