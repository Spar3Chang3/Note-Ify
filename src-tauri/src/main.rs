#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use tauri::{AppHandle, Emitter, Manager, State};

struct BotState {
    child: Mutex<Option<Child>>,
}

#[tauri::command]
fn bot_is_running(state: State<'_, BotState>) -> bool {
    let guard = state.child.lock().unwrap();
    guard.is_some()
}

#[tauri::command]
fn start_bot(app: AppHandle, state: State<'_, BotState>) -> Result<(), String> {
    let mut guard = state.child.lock().unwrap();

    if guard.is_some() {
        return Err("Bot is already running.".into());
    }

    // Change this if you want node instead of bun:
    // let mut child = Command::new("node")
    let mut child = Command::new("bun")
        .arg("run")
        .arg("src/lib/bot.js")
        .current_dir("../")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn bot.js: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    if let Some(stdout) = stdout {
        let app_clone = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        let _ = app_clone.emit("bot-log", line);
                    }
                    Err(err) => {
                        let _ = app_clone.emit("bot-log", format!("[stdout read error] {err}"));
                        break;
                    }
                }
            }
        });
    }

    if let Some(stderr) = stderr {
        let app_clone = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        let _ = app_clone.emit("bot-log", format!("[stderr] {line}"));
                    }
                    Err(err) => {
                        let _ = app_clone.emit("bot-log", format!("[stderr read error] {err}"));
                        break;
                    }
                }
            }
        });
    }

    let app_clone = app.clone();
    let pid = child.id();

    *guard = Some(child);

    let _ = app_clone.emit("bot-status", "started");
    let _ = app_clone.emit("bot-log", format!("[ui] bot process started (pid {pid})"));

    Ok(())
}

#[tauri::command]
fn stop_bot(app: AppHandle, state: State<'_, BotState>) -> Result<(), String> {
    let mut guard = state.child.lock().unwrap();

    let Some(child) = guard.as_mut() else {
        return Err("Bot is not running.".into());
    };

    child
        .kill()
        .map_err(|e| format!("Failed to stop bot: {e}"))?;

    let _ = child.wait();

    *guard = None;

    let _ = app.emit("bot-log", "[ui] bot process stopped");
    let _ = app.emit("bot-status", "stopped");

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(BotState {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            start_bot,
            stop_bot,
            bot_is_running
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
