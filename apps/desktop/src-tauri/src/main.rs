// リリースビルドで Windows のコンソールウィンドウを出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;

/// 起動時に GitHub Releases の latest.json を見て、新しい版があれば確かめてから入れて再起動する。
/// 確認や取得に失敗しても今の版のまま使えるので、ログに残すだけにする。
fn check_update(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let update = match app.updater() {
            Ok(updater) => updater.check().await,
            Err(error) => Err(error),
        };
        let update = match update {
            Ok(Some(update)) => update,
            Ok(None) => return,
            Err(error) => {
                eprintln!("update check failed: {error}");
                return;
            }
        };
        let handle = app.clone();
        app.dialog()
            .message(format!(
                "Manga Name {} があります。更新して再起動しますか？",
                update.version
            ))
            .title("アップデート")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "更新して再起動".into(),
                "あとで".into(),
            ))
            .show(move |accepted| {
                if !accepted {
                    return;
                }
                tauri::async_runtime::spawn(async move {
                    match update.download_and_install(|_, _| {}, || {}).await {
                        Ok(()) => handle.restart(),
                        Err(error) => eprintln!("update install failed: {error}"),
                    }
                });
            });
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        // ダイアログで選んだファイルの読み書きの許可は実行時に足されるだけなので、最近開いたファイルを再起動後も開けるよう残す
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // 開発中は version が 0.0.0 のままで、毎回最新リリースへの更新を勧めてしまう
            if !cfg!(debug_assertions) {
                check_update(app.handle().clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Tauri application");
}
