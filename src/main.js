const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const logWrap = document.getElementById("logWrap");
const logOutput = document.getElementById("logOutput");

const settingsBtn = document.getElementById("settingsBtn");
const settingsClose = document.getElementById("settingsClose");
const settingsModal = document.getElementById("settingsModal");

let isRunning = false;
let stickToBottom = true;
let settingsOpen = false;

function toggleSettings(e) {
  e.preventDefault();

  if (settingsOpen) {
    settingsModal.classList.remove("open");
    settingsModal.classList.add("closed");
    settingsOpen = false;
  } else {
    settingsModal.classList.remove("closed");
    settingsModal.classList.add("open");
    settingsOpen = true;
  }
}

function setStatus(running) {
  isRunning = running;
  statusEl.textContent = running ? "Running" : "Stopped";
  statusEl.classList.toggle("running", running);
  statusEl.classList.toggle("stopped", !running);

  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

function appendLog(text) {
  logOutput.textContent += text;

  if (stickToBottom) {
    logWrap.scrollTop = logWrap.scrollHeight;
  }
}

function appendLine(text) {
  appendLog(`${text}\n`);
}

function updateStickiness() {
  const threshold = 24;
  const distanceFromBottom =
    logWrap.scrollHeight - logWrap.scrollTop - logWrap.clientHeight;

  stickToBottom = distanceFromBottom <= threshold;
}

logWrap.addEventListener("scroll", updateStickiness);

clearBtn.addEventListener("click", () => {
  logOutput.textContent = "";
});

startBtn.addEventListener("click", async () => {
  try {
    appendLine("[ui] starting bot...");
    await invoke("start_bot");
    setStatus(true);
  } catch (err) {
    appendLine(`[ui] failed to start bot: ${String(err)}`);
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    appendLine("[ui] stopping bot...");
    await invoke("stop_bot");
  } catch (err) {
    appendLine(`[ui] failed to stop bot: ${String(err)}`);
  }
});

await listen("bot-log", (event) => {
  appendLine(String(event.payload));
});

await listen("bot-status", (event) => {
  const payload = String(event.payload);

  if (payload === "started") {
    setStatus(true);
  } else if (payload === "stopped") {
    setStatus(false);
  }
});

try {
  const running = await invoke("bot_is_running");
  setStatus(Boolean(running));
} catch {
  setStatus(false);
}

settingsBtn.addEventListener("click", toggleSettings);
settingsClose.addEventListener("click", toggleSettings);
