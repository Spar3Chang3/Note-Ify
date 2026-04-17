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

const configBtn = document.getElementById("configBtn");
const configClose = document.getElementById("configClose");
const configModal = document.getElementById("configModal");

let isRunning = false;
let stickToBottom = true;

let settingsOpen = false;
let configOpen = false;

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

function toggleConfig(e) {
  e.preventDefault();

  if (configOpen) {
    configModal.classList.remove("open");
    configModal.classList.add("closed");
    configOpen = false;
  } else {
    configModal.classList.remove("closed");
    configModal.classList.add("open");
    configOpen = true;
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

configBtn.addEventListener("click", async (e) => {
  toggleConfig(e);
  if (configOpen) {
    await loadConfig();
  }
});
configClose.addEventListener("click", toggleConfig);

const configForm = document.querySelector(".config-form");
const configResetBtn = configForm.querySelector(".btn.secondary");

async function loadConfig() {
  try {
    const rawToml = await invoke("get_config");
    
    // Parse using regex since we are preserving TOML comments
    const extract = (key, isString = true) => {
      const regex = new RegExp(`^\\s*${key}\\s*=\\s*(${isString ? '"[^"]*"' : '[^\\n#]*'})`, 'm');
      const match = rawToml.match(regex);
      if (match) {
        let val = match[1].trim();
        if (isString) val = val.replace(/^"|"$/g, '');
        return val;
      }
      return '';
    };

    document.getElementById("activityType").value = extract("activity_type", true) || "Listening";
    document.getElementById("activityName").value = extract("activity_name", true) || "your D&D Campaign";
    document.getElementById("whisperUrl").value = extract("whisper_url", true);
    document.getElementById("summaryModel").value = extract("summary_model", true);
    document.getElementById("whisperModelPath").value = extract("whisper_model", true); // Maps to whisper_model_path visually
    document.getElementById("whisperServerPath").value = extract("whisper_server_path", true);
    
    document.getElementById("tokenLimit").value = extract("token_limit", false);
    document.getElementById("tokenSplitRatio").value = extract("token_split_ratio", false) || "0.75";
    document.getElementById("messageChunkSize").value = extract("message_chunk_size", false) || "1800";
    document.getElementById("silenceDuration").value = extract("silence_duration", false) || "500";
    document.getElementById("whisperThreads").value = extract("whisper_threads", false);
    document.getElementById("feedbackTime").value = extract("feedback_time", false);
    document.getElementById("discordToken").value = extract("discord_token", true);
    
    // Store original so we can replace later
    window._rawToml = rawToml;
  } catch (err) {
    appendLine(`[ui] failed to load config: ${err}`);
  }
}

configForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    let rawToml = window._rawToml || await invoke("get_config");
    
    const replaceOrAdd = (key, val, isString = true, section = null) => {
      const formattedVal = isString ? `"${val}"` : val;
      const regex = new RegExp(`(^\\s*${key}\\s*=\\s*)(?:"[^"]*"|[^\\n#]*)`, 'm');
      if (regex.test(rawToml)) {
        rawToml = rawToml.replace(regex, `$1${formattedVal}`);
      } else {
        // Fallback append if field doesn't exist yet (simplified)
        rawToml += `\n${key} = ${formattedVal}`;
      }
    };

    replaceOrAdd("activity_type", document.getElementById("activityType").value, true);
    replaceOrAdd("activity_name", document.getElementById("activityName").value, true);
    replaceOrAdd("whisper_url", document.getElementById("whisperUrl").value, true);
    replaceOrAdd("summary_model", document.getElementById("summaryModel").value, true);
    replaceOrAdd("whisper_model", document.getElementById("whisperModelPath").value, true);
    replaceOrAdd("whisper_server_path", document.getElementById("whisperServerPath").value, true);
    
    replaceOrAdd("token_limit", document.getElementById("tokenLimit").value, false);
    replaceOrAdd("token_split_ratio", document.getElementById("tokenSplitRatio").value, false);
    replaceOrAdd("message_chunk_size", document.getElementById("messageChunkSize").value, false);
    replaceOrAdd("silence_duration", document.getElementById("silenceDuration").value, false);
    replaceOrAdd("whisper_threads", document.getElementById("whisperThreads").value, false);
    replaceOrAdd("feedback_time", document.getElementById("feedbackTime").value, false);
    replaceOrAdd("discord_token", document.getElementById("discordToken").value, true);

    await invoke("save_config", { newConfig: rawToml });
    window._rawToml = rawToml;
    
    appendLine("[ui] config saved successfully");
    toggleConfig(e);
  } catch (err) {
    appendLine(`[ui] failed to save config: ${err}`);
  }
});

configResetBtn.addEventListener("click", async () => {
  await loadConfig();
});
