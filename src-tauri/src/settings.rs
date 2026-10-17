use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// User preferences, stored as settings.json in the app's config folder.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub color_a: String,
    pub color_b: String,
    pub sound: bool,
    pub opacity: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            color_a: "#2bb3a3".into(),
            color_b: "#e5484d".into(),
            sound: true,
            opacity: 1.0,
        }
    }
}

fn settings_path(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().app_config_dir()?.join("settings.json"))
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    settings_path(&app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Saves and broadcasts, so the timer window restyles while the user is still choosing.
#[tauri::command]
pub fn save_settings(app: AppHandle, mut settings: Settings) -> Result<Settings, String> {
    settings.opacity = settings.opacity.clamp(0.3, 1.0);
    let path = settings_path(&app).map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    let _ = app.emit("settings-changed", &settings);
    Ok(settings)
}

#[tauri::command]
pub fn reset_settings(app: AppHandle) -> Result<Settings, String> {
    save_settings(app, Settings::default())
}

pub fn open_settings_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Timer Settings")
        .inner_size(340.0, 290.0)
        .resizable(false)
        .minimizable(false)
        .center()
        .build();
    if let Ok(window) = built {
        // The timer floats at status level; the settings window must sit above it.
        #[cfg(target_os = "macos")]
        crate::set_window_level(&window);
        let _ = window.set_focus();
    }
}
