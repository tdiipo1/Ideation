mod audio;
mod commands;
mod healing;
mod history;
mod model_manager;
mod settings;
mod state;
mod structuring;
mod transcribe;

use audio::SharedAudioBuffer;
use state::AppState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .manage(SharedAudioBuffer::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_recording_state,
            commands::get_last_transcript,
            commands::start_recording,
            commands::stop_recording,
            commands::toggle_recording,
            commands::get_available_models,
            commands::is_model_downloaded,
            commands::download_model,
            commands::get_history,
            commands::delete_history_entry,
            commands::clear_history,
            commands::get_settings,
            commands::save_settings,
            commands::structure_as_prompt,
        ])
        .setup(|app| {
            // Build system tray menu
            let quit = MenuItem::with_id(app, "quit", "Quit Ideation", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Ideation - Voice to Prompt")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // Register global shortcut: Ctrl+Shift+Space
            let shortcut = Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::SHIFT),
                Code::Space,
            );

            let app_handle = app.handle().clone();
            app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let app_handle = app_handle.clone();
                    // Emit event to frontend which will call toggle_recording
                    let _ = app_handle.emit("shortcut-toggle", ());
                }
            })?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
