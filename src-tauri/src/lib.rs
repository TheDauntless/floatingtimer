mod settings;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

const WINDOW_STATE: StateFlags = StateFlags::POSITION.union(StateFlags::SIZE);

/// Each arm bumps the generation; a waiting alarm thread exits once its generation is stale.
#[derive(Default)]
struct Alarm {
    generation: Arc<AtomicU64>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
fn arm_alarm(app: AppHandle, alarm: State<Alarm>, end_ms: u64, label: String) {
    let generation = alarm.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let current = alarm.generation.clone();
    std::thread::spawn(move || loop {
        if current.load(Ordering::SeqCst) != generation {
            return;
        }
        let now = now_ms();
        if now >= end_ms {
            let _ = app.emit("alarm", ());
            let _ = app
                .notification()
                .builder()
                .title("Time's up")
                .body(label.as_str())
                .show();
            return;
        }
        // Short polls against the wall clock keep the alarm on time across system sleep.
        std::thread::sleep(Duration::from_millis((end_ms - now).min(250)));
    });
}

#[tauri::command]
fn disarm_alarm(alarm: State<Alarm>) {
    alarm.generation.fetch_add(1, Ordering::SeqCst);
}

/// The OS "24-hour time" setting; None means follow the locale.
#[tauri::command]
fn uses_24h() -> Option<bool> {
    os_uses_24h()
}

#[cfg(target_os = "macos")]
fn os_uses_24h() -> Option<bool> {
    let read = |key: &str| {
        std::process::Command::new("defaults")
            .args(["read", "-g", key])
            .output()
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim() == "1")
            .unwrap_or(false)
    };
    if read("AppleICUForce24HourTime") {
        Some(true)
    } else if read("AppleICUForce12HourTime") {
        Some(false)
    } else {
        None
    }
}

/// Region settings store the clock style as iTime: "1" = 24-hour, "0" = 12-hour.
#[cfg(windows)]
fn os_uses_24h() -> Option<bool> {
    use winreg::enums::HKEY_CURRENT_USER;
    let key = winreg::RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Control Panel\\International")
        .ok()?;
    let value: String = key.get_value("iTime").ok()?;
    Some(value == "1")
}

#[cfg(not(any(target_os = "macos", windows)))]
fn os_uses_24h() -> Option<bool> {
    None
}

/// Right-click menu on the timer window.
/// Cmd+W / Ctrl+W in the timer window. Exits the app, same as the Exit menu item.
#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn show_context_menu(window: tauri::Window) -> tauri::Result<()> {
    let settings = MenuItem::with_id(&window, "settings", "Settings…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(&window)?;
    let exit = MenuItem::with_id(&window, "quit", "Exit", true, None::<&str>)?;
    let menu = Menu::with_items(&window, &[&settings, &separator, &exit])?;
    window.popup_menu(&menu)
}

/// The window-state plugin only writes to disk on a clean exit, so also save
/// shortly after the user stops moving or resizing. Survives crashes and force-quits.
fn save_window_state_soon(app: &AppHandle, pending: &Arc<AtomicU64>) {
    let generation = pending.fetch_add(1, Ordering::SeqCst) + 1;
    let pending = pending.clone();
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(500));
        if pending.load(Ordering::SeqCst) == generation {
            let _ = app.save_window_state(WINDOW_STATE);
        }
    });
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("focus-input", ());
    }
}

/// kCGStatusWindowLevel: above normal and floating windows, below pop-up menus.
#[cfg(target_os = "macos")]
const STATUS_WINDOW_LEVEL: isize = 25;

#[cfg(target_os = "macos")]
fn ns_window(window: &tauri::WebviewWindow) -> Option<&objc2_app_kit::NSWindow> {
    let ptr = window.ns_window().ok()?;
    Some(unsafe { &*(ptr as *const objc2_app_kit::NSWindow) })
}

/// Raises a window to the timer's level so it is not hidden behind the timer.
#[cfg(target_os = "macos")]
pub(crate) fn set_window_level(window: &tauri::WebviewWindow) {
    if let Some(ns_window) = ns_window(window) {
        ns_window.setLevel(STATUS_WINDOW_LEVEL);
    }
}

/// Keeps the window above full-screen apps and on every Space.
#[cfg(target_os = "macos")]
fn float_everywhere(window: &tauri::WebviewWindow) {
    use objc2_app_kit::NSWindowCollectionBehavior;

    if let Some(ns_window) = ns_window(window) {
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary,
        );
    }
    set_window_level(window);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shortcuts = tauri_plugin_global_shortcut::Builder::new()
        .with_shortcuts(["CommandOrControl+Alt+T"])
        .expect("valid shortcut")
        .with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                show_main(app);
            }
        })
        .build();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(WINDOW_STATE)
                .with_denylist(&["settings"])
                .build(),
        )
        .plugin(shortcuts)
        .manage(Alarm::default())
        .invoke_handler(tauri::generate_handler![
            arm_alarm,
            disarm_alarm,
            uses_24h,
            show_context_menu,
            quit,
            settings::get_settings,
            settings::save_settings,
            settings::reset_settings
        ])
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "settings" => settings::open_settings_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                // No Dock icon; the menu-bar icon is the way back in.
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                if let Some(window) = app.get_webview_window("main") {
                    float_everywhere(&window);
                }
            }

            // Windows draws a rectangular shadow around undecorated windows,
            // which shows up as a box behind the rounded corners.
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_shadow(false);
            }

            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                let pending = Arc::new(AtomicU64::new(0));
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
                        save_window_state_soon(&handle, &pending);
                    }
                });
            }

            let show = MenuItem::with_id(app, "show", "Show Timer", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &settings, &separator, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Floating Timer")
                .menu(&menu)
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the timer");
}
