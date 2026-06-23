use tauri::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

/// Custom menu item ids.
const RESCAN: &str = "rescan";
const TOGGLE_THEME: &str = "toggle-theme";
const RELOAD: &str = "reload";
const PREFERENCES: &str = "preferences";

/// Build the native application menu bar.
///
/// Standard App/Edit/Window/Help menus plus a custom View menu with Rescan,
/// Toggle Theme, and Reload actions. Custom items dispatch `menu://` events
/// into the webview (see `on_menu_event`).
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    // ---- App menu ----
    let about = PredefinedMenuItem::about(app, Some("About Agent Usage Stats"), None)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let services = PredefinedMenuItem::services(app, None)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let hide = PredefinedMenuItem::hide(app, None)?;
    let hide_others = PredefinedMenuItem::hide_others(app, None)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, None)?;
    let app_menu = Submenu::with_items(
        app,
        "Agent Usage Stats",
        true,
        &[&about, &sep1, &services, &sep2, &hide, &hide_others, &sep3, &quit],
    )?;

    // ---- Edit menu ----
    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let esep = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[&undo, &redo, &esep, &cut, &copy, &paste, &select_all],
    )?;

    // ---- View menu (custom actions) ----
    let rescan = MenuItem::with_id(app, RESCAN, "Rescan Sessions", true, Some("CmdOrCtrl+R"))?;
    let toggle_theme =
        MenuItem::with_id(app, TOGGLE_THEME, "Toggle Theme", true, Some("CmdOrCtrl+Shift+L"))?;
    let vsep = PredefinedMenuItem::separator(app)?;
    let reload = MenuItem::with_id(app, RELOAD, "Reload", true, Some("CmdOrCtrl+Shift+R"))?;
    let vsep2 = PredefinedMenuItem::separator(app)?;
    let fullscreen = PredefinedMenuItem::fullscreen(app, None)?;
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&rescan, &toggle_theme, &vsep, &reload, &vsep2, &fullscreen],
    )?;

    // ---- Window menu ----
    let minimize = PredefinedMenuItem::minimize(app, None)?;
    #[cfg(not(target_os = "macos"))]
    let maximize = PredefinedMenuItem::maximize(app, None)?;
    let close_window = PredefinedMenuItem::close_window(app, None)?;
    #[cfg(target_os = "macos")]
    let window_items: Vec<&dyn tauri::menu::IsMenuItem<R>> = vec![&minimize, &close_window];
    #[cfg(not(target_os = "macos"))]
    let window_items: Vec<&dyn tauri::menu::IsMenuItem<R>> = vec![&minimize, &maximize, &close_window];
    let window_menu = Submenu::with_items(app, "Window", true, &window_items)?;

    // ---- Help / Preferences ----
    let preferences = MenuItem::with_id(app, PREFERENCES, "Preferences…", true, Some("CmdOrCtrl+,"))?;
    let help_menu = Submenu::with_items(app, "Help", true, &[&preferences])?;

    Menu::with_items(app, &[&app_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
}

/// Handle a custom menu item click: emit a `menu://` event to the webview,
/// or trigger a webview reload directly for the reload action.
pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id().as_ref() {
        RESCAN => {
            let _ = app.emit("native-menu", "menu://rescan");
        }
        TOGGLE_THEME => {
            let _ = app.emit("native-menu", "menu://toggle-theme");
        }
        PREFERENCES => {
            let _ = app.emit("native-menu", "menu://preferences");
        }
        RELOAD => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.location.reload()");
            }
        }
        _ => {}
    }
}

/// Build the system tray icon + menu (Show / Rescan now / Quit).
pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "tray-show", "Show Agent Usage Stats", true, None::<&str>)?;
    let rescan = MenuItem::with_id(app, "tray-rescan", "Rescan now", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &rescan, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().cloned().expect("window icon"))
        .tooltip("Agent Usage Stats")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            // Left-click toggles window visibility.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "tray-rescan" => {
                let _ = app.emit("native-menu", "menu://rescan");
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
            }
            "tray-quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// Update the tray tooltip with the latest sync summary (called after scans).
#[allow(dead_code)]
pub fn update_tray_tooltip<R: Runtime>(app: &AppHandle<R>, sessions_found: Option<u64>) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let tip = match sessions_found {
            Some(n) => format!("Agent Usage Stats · {n} sessions synced"),
            None => "Agent Usage Stats".to_string(),
        };
        let _ = tray.set_tooltip(Some(tip));
    }
}
