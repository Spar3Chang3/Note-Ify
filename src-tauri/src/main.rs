#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

struct BotState {
    bot_child: Mutex<Option<Child>>,
    whisper_child: Mutex<Option<Child>>,
}

#[derive(Debug, Deserialize)]
struct Conf {
    limits: LimitsConf,
    models: ModelsConf,
}

#[derive(Debug, Deserialize)]
struct LimitsConf {
    whisper_threads: usize,
}

#[derive(Debug, Deserialize)]
struct ModelsConf {
    whisper_model_path: String,
    whisper_server_path: String,
}

#[tauri::command]
fn bot_is_running(state: State<'_, BotState>) -> bool {
    let guard = state.bot_child.lock().unwrap();
    guard.is_some()
}

fn pipe_child_logs<R: std::io::Read + Send + 'static>(
    app: AppHandle,
    reader: R,
    source: &'static str,
    is_stderr: bool,
) {
    std::thread::spawn(move || {
        let reader = BufReader::new(reader);

        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let prefix = if is_stderr {
                        format!("[{source} stderr]")
                    } else {
                        format!("[{source}]")
                    };

                    let _ = app.emit("bot-log", format!("{prefix} {line}"));
                }
                Err(err) => {
                    let stream = if is_stderr { "stderr" } else { "stdout" };
                    let _ = app.emit("bot-log", format!("[{source} {stream} read error] {err}"));
                    break;
                }
            }
        }
    });
}

fn read_conf() -> Result<Conf, String> {
    let conf_path = "../conf/conf.toml";
    let raw = fs::read_to_string(conf_path)
        .map_err(|e| format!("Failed to read config at `{conf_path}`: {e}"))?;

    toml::from_str::<Conf>(&raw).map_err(|e| format!("Failed to parse `{conf_path}`: {e}"))
}

#[tauri::command]
fn start_bot(app: AppHandle, state: State<'_, BotState>) -> Result<(), String> {
    let mut bot_guard = state.bot_child.lock().unwrap();
    let mut whisper_guard = state.whisper_child.lock().unwrap();

    if bot_guard.is_some() || whisper_guard.is_some() {
        return Err("Bot stack is already running.".into());
    }

    let conf = read_conf()?;

    #[cfg(target_os = "windows")]
    let bot_path = "ext-bin/note-ify-windows.exe";
    #[cfg(not(target_os = "windows"))]
    let bot_path = "ext-bin/note-ify-linux";

    #[cfg(target_os = "windows")]
    let whisper_path = "ext-bin/whisper-windows/whisper-server.exe";

    #[cfg(not(target_os = "windows"))]
    let whisper_path = conf.models.whisper_server_path.as_str();

    let model_path = conf.models.whisper_model_path.clone();
    let threads = conf.limits.whisper_threads.to_string();

    // Only attempt whisper launch if a path exists
    if !whisper_path.is_empty() {
        let mut whisper_child = Command::new(whisper_path)
            .arg("--model")
            .arg(&model_path)
            .arg("--threads")
            .arg(&threads)
            .current_dir("../")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn whisper server at `{whisper_path}`: {e}"))?;

        if let Some(stdout) = whisper_child.stdout.take() {
            pipe_child_logs(app.clone(), stdout, "whisper", false);
        }

        if let Some(stderr) = whisper_child.stderr.take() {
            pipe_child_logs(app.clone(), stderr, "whisper", true);
        }

        let whisper_pid = whisper_child.id();
        *whisper_guard = Some(whisper_child);

        let _ = app.emit(
            "bot-log",
            format!("[ui] whisper process started (pid {whisper_pid})"),
        );
    } else {
        let _ = app.emit(
            "bot-log",
            "[ui] whisper_server_path not set — skipping whisper launch",
        );
    }

    let mut bot_child = match Command::new(bot_path)
        .current_dir("../")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            if let Some(child) = whisper_guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *whisper_guard = None;

            return Err(format!("Failed to spawn bot binary at `{bot_path}`: {e}"));
        }
    };

    if let Some(stdout) = bot_child.stdout.take() {
        pipe_child_logs(app.clone(), stdout, "bot", false);
    }

    if let Some(stderr) = bot_child.stderr.take() {
        pipe_child_logs(app.clone(), stderr, "bot", true);
    }

    let bot_pid = bot_child.id();
    *bot_guard = Some(bot_child);

    let _ = app.emit("bot-status", "started");
    let _ = app.emit(
        "bot-log",
        format!("[ui] bot process started (pid {bot_pid})"),
    );

    Ok(())
}

#[tauri::command]
fn stop_bot(app: AppHandle, state: State<'_, BotState>) -> Result<(), String> {
    let mut bot_guard = state.bot_child.lock().unwrap();
    let mut whisper_guard = state.whisper_child.lock().unwrap();

    let mut stopped_any = false;

    if let Some(child) = bot_guard.as_mut() {
        child
            .kill()
            .map_err(|e| format!("Failed to stop bot: {e}"))?;
        let _ = child.wait();
        stopped_any = true;
    }
    *bot_guard = None;

    if let Some(child) = whisper_guard.as_mut() {
        child
            .kill()
            .map_err(|e| format!("Failed to stop whisper server: {e}"))?;
        let _ = child.wait();
        stopped_any = true;
    }
    *whisper_guard = None;

    if !stopped_any {
        return Err("Bot stack is not running.".into());
    }

    let _ = app.emit("bot-log", "[ui] bot process stopped");
    let _ = app.emit("bot-log", "[ui] whisper process stopped");
    let _ = app.emit("bot-status", "stopped");

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(BotState {
            bot_child: Mutex::new(None),
            whisper_child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            start_bot,
            stop_bot,
            bot_is_running
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
