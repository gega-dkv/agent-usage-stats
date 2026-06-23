use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{Emitter, Manager};

/// Default dashboard port (overridable via AGENT_USAGE_DASHBOARD_PORT).
pub const DEFAULT_DASHBOARD_PORT: &str = "3847";

/// Bounded ring buffer of recent log lines from the sidecar stderr.
const MAX_LOG_LINES: usize = 200;

/// Current lifecycle status of the Node sidecar.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// Still spawning / not yet confirmed healthy.
    Starting,
    /// Health probe succeeded; ready to serve the SPA.
    Ready,
    /// Spawn failed or health probe timed out.
    Failed,
}

/// Snapshot returned to the SPA via `get_server_status`.
#[derive(Clone, Debug, Serialize)]
pub struct ServerStatus {
    pub status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub logs: Vec<String>,
}

/// Managed state: the spawned child plus a bounded log ring buffer.
pub struct SidecarState {
    pub child: Mutex<Option<Child>>,
    pub url: Mutex<Option<String>>,
    pub status: Mutex<Status>,
    pub message: Mutex<Option<String>>,
    pub logs: Mutex<Vec<String>>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            url: Mutex::new(None),
            status: Mutex::new(Status::Starting),
            message: Mutex::new(None),
            logs: Mutex::new(Vec::new()),
        }
    }

    pub fn push_log(&self, line: impl Into<String>) {
        let mut logs = self.logs.lock().unwrap();
        if logs.len() >= MAX_LOG_LINES {
            logs.remove(0);
        }
        logs.push(line.into());
    }

    pub fn snapshot(&self) -> ServerStatus {
        ServerStatus {
            status: self.status.lock().unwrap().clone(),
            url: self.url.lock().unwrap().clone(),
            message: self.message.lock().unwrap().clone(),
            logs: self.logs.lock().unwrap().clone(),
        }
    }
}

/// Read the configured port, falling back to the default.
pub fn dashboard_port() -> String {
    std::env::var("AGENT_USAGE_DASHBOARD_PORT").unwrap_or_else(|_| DEFAULT_DASHBOARD_PORT.to_string())
}

/// Resolve the CLI entry script.
///
/// Honours `AGENT_USAGE_CLI` when set (handy for dev). Otherwise derives it
/// from the crate manifest dir: `<repo>/apps/cli/dist/index.js`.
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

/// Resolve the `node` binary to launch the sidecar with.
///
/// When the app is launched from a terminal (`pnpm desktop:dev`), `node` is on
/// PATH. But a bundled app launched from Finder/Dock inherits a minimal PATH
/// (`/usr/bin:/bin:/usr/sbin:/sbin`) that usually excludes Homebrew/nvm/fnm, so
/// a bare `Command::new("node")` would fail to spawn. We therefore search PATH
/// explicitly and fall back to the common install locations.
fn resolve_node() -> String {
    if let Ok(custom) = std::env::var("AGENT_USAGE_NODE") {
        if !custom.is_empty() {
            return custom;
        }
    }

    // Honor an explicit PATH search first (covers terminal launches and any
    // custom install dir the user has on PATH).
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(NODE_EXE);
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }

    // Fall back to well-known absolute locations a GUI launch can't see on PATH.
    // User-local managers first (they hold the user's chosen `node`), then system.
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(&home);
        // Manual installs / mise / asdf shims commonly live here.
        candidates.push(home.join(".local/bin").join(NODE_EXE));
        // nvm: pick the newest installed version.
        let nvm = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm) {
            let mut versions: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path().join("bin").join(NODE_EXE))
                .filter(|p| p.is_file())
                .collect();
            versions.sort();
            if let Some(latest) = versions.pop() {
                candidates.push(latest);
            }
        }
        // fnm default alias.
        candidates.push(home.join(".fnm/aliases/default/bin").join(NODE_EXE));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin").join(NODE_EXE)); // Apple Silicon Homebrew
    candidates.push(PathBuf::from("/usr/local/bin").join(NODE_EXE)); // Intel Homebrew / nodejs.org
    candidates.push(PathBuf::from("/usr/bin").join(NODE_EXE));

    for candidate in candidates {
        if candidate.is_file() {
            return candidate.to_string_lossy().into_owned();
        }
    }

    // Last resort: let the OS try to resolve it (may still fail, surfaced to UI).
    NODE_EXE.to_string()
}

#[cfg(windows)]
const NODE_EXE: &str = "node.exe";
#[cfg(not(windows))]
const NODE_EXE: &str = "node";

/// Best-effort: terminate whatever process is currently listening on our
/// dashboard port. Used to clear a stale orphan from a previous run before we
/// spawn a fresh sidecar (only relevant on Unix; localhost-only).
#[cfg(unix)]
fn free_port(port: &str) {
    // `lsof` lives in /usr/sbin on macOS and /usr/bin on most Linux distros; a
    // Finder launch may not have either on PATH, so try absolute paths too.
    let lsof_bins = ["lsof", "/usr/sbin/lsof", "/usr/bin/lsof"];
    for bin in lsof_bins {
        // `output()` errors only when the binary can't be spawned — try the next
        // path in that case. Otherwise lsof ran: kill any PIDs it reported.
        let Ok(out) = Command::new(bin)
            .args(["-ti", &format!("tcp:{port}"), "-sTCP:LISTEN"])
            .output()
        else {
            continue;
        };
        for pid in String::from_utf8_lossy(&out.stdout).split_whitespace() {
            let _ = Command::new("kill").arg("-KILL").arg(pid).status();
        }
        return;
    }
}

#[cfg(not(unix))]
fn free_port(_port: &str) {}

/// Metadata the CLI prints on a single line when launched with `--json`.
/// `pid` is reported but we re-derive `url`/`port` from our own inputs to be safe.
#[derive(serde::Deserialize)]
struct CliJsonMeta {
    #[allow(dead_code)]
    pid: Option<i32>,
    #[allow(dead_code)]
    port: Option<u16>,
    #[allow(dead_code)]
    url: Option<String>,
    #[serde(default)]
    ok: Option<bool>,
    #[serde(default)]
    error: Option<String>,
}

/// Spawn the Node dashboard sidecar and (best-effort) confirm it is healthy.
///
/// Unlike the old shell, stdout/stderr are *captured*: stdout is scanned for the
/// CLI's JSON metadata line, and stderr is drained into the log ring buffer so
/// startup failures are surfaced to the boot overlay instead of swallowed.
pub fn start(app: &tauri::AppHandle, db_path: &PathBuf, port: &str) -> Result<(), String> {
    let cli_script = resolve_cli_script();
    if !cli_script.exists() {
        let msg = format!(
            "CLI not found at {}. Run `pnpm build` from the repository root.",
            cli_script.display()
        );
        let state: tauri::State<'_, SidecarState> = app.state();
        *state.message.lock().unwrap() = Some(msg.clone());
        *state.status.lock().unwrap() = Status::Failed;
        return Err(msg);
    }

    // Reap any leftover sidecar still holding our port (e.g. an orphan from a
    // previous run that predated process-group reaping). Best-effort, localhost.
    free_port(port);

    let node = resolve_node();
    let mut cmd = Command::new(&node);
    cmd.arg(&cli_script)
        .args(["dashboard", "--port", port, "--host", "127.0.0.1", "--no-open", "--json"])
        .env("AGENT_USAGE_DB_PATH", db_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Put the sidecar (and the Next.js server it spawns) in its own process
    // group so we can reap the whole tree on exit. Otherwise killing just the
    // Node parent orphans the `next-server` grandchild, which keeps holding the
    // port and serving a stale build on the next launch.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn dashboard with `{node}`: {e}"))?;

    // Take the pipes so we can read them without holding the child borrow.
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Drain stderr → log buffer in the background.
    if let Some(stderr) = stderr {
        let app = app.clone();
        std::thread::spawn(move || {
            drain_lines(stderr, move |line| {
                app.state::<SidecarState>().push_log(line);
            });
        });
    }

    // The CLI prints a single JSON object on stdout once it has spawned the
    // dashboard child. Scan for it and capture non-JSON lines into the log too.
    // When stdout hits EOF the child process has exited — mark the sidecar
    // Failed (unless it already became Ready) so the boot overlay reacts.
    if let Some(stdout) = stdout {
        let app_for_lines = app.clone();
        let app_for_eof = app.clone();
        std::thread::spawn(move || {
            drain_lines_with(
                stdout,
                move |line| {
                    if let Some(meta) = parse_cli_meta(&line) {
                        // The CLI may report a structured startup error.
                        if !meta.ok.unwrap_or(true) {
                            if let Some(err) = meta.error {
                                let s: tauri::State<'_, SidecarState> = app_for_lines.state();
                                *s.message.lock().unwrap() = Some(err);
                            }
                        }
                    } else {
                        // Non-JSON stdout is also useful context in the boot overlay.
                        app_for_lines.state::<SidecarState>().push_log(line);
                    }
                },
                move || {
                    let s: tauri::State<'_, SidecarState> = app_for_eof.state();
                    let mut guard = s.status.lock().unwrap();
                    if !matches!(*guard, Status::Ready) {
                        *guard = Status::Failed;
                        drop(guard);
                        *s.message.lock().unwrap() =
                            Some("The local data server exited unexpectedly.".to_string());
                    }
                },
            );
        });
    }

    let url = format!("http://127.0.0.1:{port}");
    *app.state::<SidecarState>().url.lock().unwrap() = Some(url.clone());
    *app.state::<SidecarState>().child.lock().unwrap() = Some(child);

    // Health-probe the sidecar in the background, flipping status to Ready/Failed.
    let app = app.clone();
    let probe_url = url.clone();
    std::thread::spawn(move || {
        health_check(&app, &probe_url);
    });

    Ok(())
}

/// Probe `GET /api/scan` until it responds (or the deadline passes), then flip
/// the managed status to Ready and emit `app-ready` so the SPA can auto-scan.
///
/// The deadline is generous: in dev (without a `pnpm build`) the CLI falls back
/// to `next dev`, whose first compile of a multi-page app can take a while.
/// On timeout we intentionally leave status as `Starting` rather than `Failed` —
/// the SPA's own fetch is the authoritative readiness gate and keeps retrying,
/// surfacing a Retry button if it ultimately can't connect. We only mark `Failed`
/// when the child process is *gone* (a real crash), handled in `watch_child`.
fn health_check(app: &tauri::AppHandle, base_url: &str) {
    let probe = format!("{base_url}/api/scan");
    let deadline = Instant::now() + Duration::from_secs(170);
    while Instant::now() < deadline {
        if try_probe(&probe) {
            let state: tauri::State<'_, SidecarState> = app.state();
            *state.status.lock().unwrap() = Status::Ready;
            let _ = app.emit("app-ready", ());
            return;
        }
        // If the sidecar child has already exited, stop probing — it crashed.
        {
            let state: tauri::State<'_, SidecarState> = app.state();
            let already_failed = matches!(*state.status.lock().unwrap(), Status::Failed);
            if already_failed {
                return;
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    // Timeout: leave as Starting; the SPA's fetch loop will keep trying.
}

/// Single HTTP GET that returns true on any HTTP response (server is up).
/// Uses a raw TCP write to avoid pulling in an HTTP client dependency.
fn try_probe(url: &str) -> bool {
    let parsed = match parse_host_port_path(url) {
        Some(v) => v,
        None => return false,
    };
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    let port: u16 = parsed.1.parse().unwrap_or(80);
    let ip: std::net::IpAddr = match parsed.0.as_str() {
        "localhost" | "127.0.0.1" => "127.0.0.1".parse().unwrap(),
        host => match host.parse() {
            Ok(ip) => ip,
            Err(_) => "127.0.0.1".parse().unwrap(),
        },
    };
    let addr: SocketAddr = (ip, port).into();
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(800)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let req = format!(
        "GET {} HTTP/1.0\r\nHost: {}:{}\r\nConnection: close\r\n\r\n",
        parsed.2, parsed.0, parsed.1
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 32];
    stream.read(&mut buf).is_ok()
}

/// Parse `http://host:port/path` into `(host, port, path)`.
fn parse_host_port_path(url: &str) -> Option<(String, String, String)> {
    let rest = url.strip_prefix("http://").or_else(|| url.strip_prefix("https://"))?;
    let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
    let (host, port) = authority.split_once(':').unwrap_or((authority, "80"));
    Some((host.to_string(), port.to_string(), format!("/{}", path)))
}

/// Read a pipe line-by-line, invoking `on_line` for each trimmed line.
fn drain_lines<R: std::io::Read + Send + 'static, F: Fn(String) + Send + 'static>(
    stream: R,
    on_line: F,
) {
    drain_lines_with(stream, on_line, || {});
}

/// Like `drain_lines`, but `on_eof` fires when the pipe closes — i.e. the child
/// process exited. Used to mark the sidecar `Failed` on a real crash.
fn drain_lines_with<
    R: std::io::Read + Send + 'static,
    F: Fn(String) + Send + 'static,
    E: FnOnce() + Send + 'static,
>(
    mut stream: R,
    on_line: F,
    on_eof: E,
) {
    use std::io::BufRead;
    let reader = std::io::BufReader::new(&mut stream);
    for line in reader.lines().map_while(|l| l.ok()) {
        let trimmed = line.trim_end().to_string();
        if !trimmed.is_empty() {
            on_line(trimmed);
        }
    }
    on_eof();
}

/// Best-effort parse of a stdout line into the CLI's JSON metadata object.
fn parse_cli_meta(line: &str) -> Option<CliJsonMeta> {
    let s = line.trim();
    if !s.starts_with('{') || !s.ends_with('}') {
        return None;
    }
    serde_json::from_str::<CliJsonMeta>(s).ok()
}

/// Kill + reap the sidecar on app exit.
///
/// The sidecar was spawned as its own process-group leader, so on Unix we kill
/// the entire group (`kill -<pgid>`) to take down the `next-server` grandchild
/// too — otherwise it orphans and keeps holding the dashboard port.
pub fn shutdown(state: &SidecarState) {
    if let Some(mut child) = state.child.lock().unwrap().take() {
        #[cfg(unix)]
        {
            // The sidecar is its own process-group leader (pgid == its pid), so
            // signal the whole group to also take down the `next-server` child.
            // TERM first for a graceful Next.js shutdown, then KILL to be sure.
            let pgid = child.id() as i32;
            unsafe {
                libc::killpg(pgid, libc::SIGTERM);
            }
            std::thread::sleep(Duration::from_millis(300));
            unsafe {
                libc::killpg(pgid, libc::SIGKILL);
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// A minimal shared handle kept for clarity when threading state through menu/tray.
#[allow(dead_code)]
pub type SharedState = Arc<Mutex<()>>;
