// The window only hosts the web UI; everything else happens in the `revamp serve` sidecar it starts (spec §9).
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("Revamp's window failed to start");
}
