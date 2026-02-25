mod core;

use core::{normalize_input_path, render_markdown_file, RenderedMarkdown};
#[cfg(not(target_os = "android"))]
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
#[cfg(not(target_os = "android"))]
use tauri::Emitter;
use tauri::{Manager, State};

#[derive(Default)]
struct ViewerState {
    launch_path: Mutex<Option<PathBuf>>,
}

#[cfg(not(target_os = "android"))]
#[derive(Debug, Serialize, Clone)]
struct OpenFileRequested {
    path: String,
}

#[tauri::command]
fn get_launch_path(state: State<'_, ViewerState>) -> Option<String> {
    let mut lock = state.launch_path.lock().ok()?;
    lock.take().map(|path| path.to_string_lossy().to_string())
}

fn external_launch_marker_paths(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(cache_dir) = app.path().cache_dir() {
        paths.push(cache_dir.join("external_launch_path.txt"));
    }

    let temp_marker = std::env::temp_dir().join("external_launch_path.txt");
    if !paths.iter().any(|path| path == &temp_marker) {
        paths.push(temp_marker);
    }

    paths
}

fn consume_external_launch_path_impl(app: &tauri::AppHandle) -> Option<PathBuf> {
    for marker_path in external_launch_marker_paths(app) {
        let raw = match std::fs::read_to_string(&marker_path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let _ = std::fs::remove_file(&marker_path);

        let candidate = raw.trim();
        if candidate.is_empty() {
            continue;
        }

        let normalized = match normalize_input_path(candidate) {
            Ok(path) => path,
            Err(_) => continue,
        };

        if core::is_markdown_path(&normalized) && normalized.exists() {
            return Some(normalized);
        }
    }

    None
}

#[tauri::command]
fn consume_external_launch_path(app: tauri::AppHandle) -> Option<String> {
    consume_external_launch_path_impl(&app).map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_markdown(path: String) -> Result<RenderedMarkdown, String> {
    let normalized = match normalize_input_path(&path) {
        Ok(value) => value,
        Err(err) => {
            eprintln!("MD_VIEWER_OPEN_ERR {} :: {}", path, err);
            return Err(err);
        }
    };

    match render_markdown_file(&normalized) {
        Ok(doc) => {
            println!("MD_VIEWER_OPEN_OK {}", normalized.to_string_lossy());
            Ok(doc)
        }
        Err(err) => {
            eprintln!("MD_VIEWER_OPEN_ERR {} :: {}", normalized.to_string_lossy(), err);
            Err(err)
        }
    }
}

#[tauri::command]
fn render_markdown_text(file_name: String, raw_markdown: String) -> RenderedMarkdown {
    core::render_markdown_text(file_name, raw_markdown)
}

#[cfg(not(target_os = "android"))]
fn pick_markdown_from_urls(urls: &[url::Url]) -> Option<PathBuf> {
    urls.iter().find_map(|url| {
        let Ok(path) = url.to_file_path() else {
            return None;
        };

        if core::is_markdown_path(&path) && path.exists() {
            Some(path)
        } else {
            None
        }
    })
}

fn pick_markdown_from_args(args: &[String], cwd: Option<&str>) -> Option<PathBuf> {
    args.iter().skip(1).find_map(|arg| {
        if arg.starts_with('-') {
            return None;
        }

        let base_path = if arg.starts_with("file://") {
            match url::Url::parse(arg).ok()?.to_file_path() {
                Ok(path) => path,
                Err(()) => return None,
            }
        } else {
            PathBuf::from(arg)
        };

        let absolute = if base_path.is_absolute() {
            base_path
        } else if let Some(cwd) = cwd {
            Path::new(cwd).join(base_path)
        } else {
            std::env::current_dir().ok()?.join(base_path)
        };

        if core::is_markdown_path(&absolute) && absolute.exists() {
            Some(absolute)
        } else {
            None
        }
    })
}

fn set_launch_path(state: &ViewerState, path: PathBuf) {
    if let Ok(mut launch) = state.launch_path.lock() {
        *launch = Some(path);
    }
}

#[cfg(not(target_os = "android"))]
fn dispatch_open_path(app: &tauri::AppHandle, path: PathBuf) {
    let state = app.state::<ViewerState>();
    set_launch_path(&state, path.clone());

    let payload = OpenFileRequested {
        path: path.to_string_lossy().to_string(),
    };

    let _ = app.emit("open-file-requested", payload);
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(ViewerState::default())
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if let Some(path) = pick_markdown_from_args(&args, None) {
                let state = app.state::<ViewerState>();
                set_launch_path(&state, path);
            } else if let Some(path) = consume_external_launch_path_impl(&app.handle()) {
                let state = app.state::<ViewerState>();
                set_launch_path(&state, path);
            }

            Ok(())
        });

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        if let Some(path) = pick_markdown_from_args(&args, Some(&cwd)) {
            dispatch_open_path(app, path);
        }
    }));

    #[cfg(all(debug_assertions, feature = "webdriver"))]
    let builder = builder.plugin(tauri_plugin_webdriver::init());

    let app = builder
        .invoke_handler(tauri::generate_handler![
            get_launch_path,
            consume_external_launch_path,
            open_markdown,
            render_markdown_text
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app, event| match event {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        tauri::RunEvent::Opened { urls } => {
            if let Some(path) = pick_markdown_from_urls(&urls) {
                dispatch_open_path(_app, path);
            }
        }
        _ => {}
    });
}
