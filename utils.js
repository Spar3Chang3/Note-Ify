import ollama from "ollama";

/**
 * Represents a single chat message in the LLM conversation.
 *
 * @typedef {Object} ChatMessage
 * @property {("system"|"user"|"assistant")} role - The role of the message author.
 * @property {string} content - The message content.
 */

/**
 * Represents a single Note Ify command definition.
 *
 * @typedef {Object} CommandDefinition
 * @property {string} cmd - The command string to invoke (e.g. "!start-session").
 * @property {string} desc - A human-readable description of what the command does.
 */

/**
 * Role identifier for system-level messages in the LLM context.
 * @constant {string}
 */
export const SYSTEM = "system";

/**
 * Role identifier for user-level messages in the LLM context.
 * @constant {string}
 */
export const USER = "user";

/**
 * Role identifier for assistant-level messages in the LLM context.
 * @constant {string}
 */
export const ASSISTANT = "assistant";

/**
 * The API endpoint URL for the Whisper inference server.
 * @constant {string}
 */
export const WHISPER_URL = "http://127.0.0.1:8080/inference";

/**
 * The specific model tag used for generating summaries.
 * currently using a quantized Neural Daredevil 8B model.
 * @constant {string}
 */
export const SUMMARY_MODEL = "huihui_ai/qwen3-abliterated:8b-v2";

/**
 * The foundational system prompt that defines the AI's persona and constraints.
 * Used to initialize the summarization context.
 * @constant {string}
 */
export const INITIAL_PROMPT =
  "You are a tabletop role-playing game summarizer. Please summarize the conversation and plot between the following <player> and </player> delimiters. In your response, return a markdown formatted list that tells a story of current session events, player conversations, notable/funny quotes, and role-play interactions. Your list should retell the session as though someone is sharing a tale. Be direct and clear in your retelling.";

/**
 * The editing system prompt that defines how the ai should edit its summary.
 * Used to ready the AI for user prompting.
 * @constant {string}
 */
export const REPLY_PROMPT =
  "You will now take feedback on your markdown summary and apply based on user's preference.";

/**
 * The duration of silence for the OPUS stream to end
 * Used to keep OPUS streams accurate and subtract from end time
 * @constant {number}
 */
export const SILENCE_DURATION = 500;

/**
 * The FFmpeg arguments for converting to 16khz mono WAV
 * @constant {Array<string>}
 */
export const FFMPEG_WAV_ARGS = [
  "-f",
  "s16le", // Input format: Signed 16-bit Little Endian
  "-ar",
  "48000", // Input rate: 48kHz
  "-ac",
  "2", // Input channels: 2 (Stereo)
  "-i",
  "-", // Input source: stdin (piped from decoder)
  "-f",
  "wav", // Output format: WAV
  "-ar",
  "16000", // Output rate: 16kHz
  "-ac",
  "1", // Output channels: 1 (Mono)
];

/**
 * The max token number for the current model
 * @constant {number}
 */
export const MAX_TOKEN_LIMIT = 40000;

/**
 * The list of commands for Note Ify
 * @constant {Object}
 */
export const COMMAND_LIST = {
  start: {
    cmd: "!start-session",
    desc: "Will tell me to join the current vc you're in and begin recording listed participants. Can be used by typing `!start-session @player @player @player...`. You should use me ONLY if you are the GM.",
  },
  stop: {
    cmd: "!stop-session",
    desc: "Will tell me to leave the current vc and begin summarizing. Can be used by typing `!stop-session` and I will ONLY listen to whoever used `!start-session`.",
  },
  pause: {
    cmd: "!pause-session",
    desc: "Will tell me to stay in the current vc, but stop recording and summarize the current game state. Can be used by typing `!pause-session`. This is helpful for taking breaks or resetting my token context. Again, I will ONLY listen to whoever used `!start-session`.",
  },
  unpause: {
    cmd: "!unpause-session",
    desc: "Will tell me to start recording the previously listed participants. Can be used by typing `!unpause-session`. Again, I will ONLY listen to whoever used `!start-session`.",
  },
  help: {
    cmd: "!help",
    desc: "Literally this message. Can be used by typing `!help`.",
  },
};

/**
 * Estimates the number of tokens in a text string using the standard heuristic
 * (1 token ≈ 4 characters).
 *
 * @param {string} text - The input text to measure.
 * @returns {number} The estimated token count (rounded up).
 */
export function EstimateTokens(text) {
  if (!text) return 0;
  // Round up to ensure we don't underestimate short strings
  return Math.ceil(text.length / 4);
}

/**
 * Sanitizes raw transcription text by removing known artifacts and empty strings.
 * Removes [BLANK_AUDIO] tokens and empty quote pairs.
 *
 * @param {string} text - The raw text output from the transcription model.
 * @returns {string} The cleaned text string.
 */
export function CleanTranscription(text) {
  return text.replace(/\s*\[BLANK_AUDIO\]\s*|""/g, "");
}

/**
 * Extracts the numeric Discord User ID from a mention string.
 * Handles standard mentions (<@ID>) and nickname mentions (<@!ID>).
 *
 * @param {string} mention - The mention string (e.g., "<@123456789>").
 * @returns {string|null} The user ID string, or null if invalid.
 */
export function ExtractUserId(mention) {
  if (!mention) return null;

  // Regex breakdown:
  // ^      -> Start of string
  // <@     -> Literal characters
  // !?     -> Optional exclamation mark (for nicknames)
  // (\d+)  -> Capture group for one or more digits
  // >      -> Literal closing bracket
  const match = mention.match(/^<@!?(\d+)>$/);

  // If match found, return the captured group (index 1), otherwise null
  return match ? match[1] : null;
}

/**
 * Sends a WAV audio buffer to the Whisper inference server for transcription.
 * Returns the cleaned transcription text, or an empty string if an error occurs.
 *
 * @param {Buffer} buffer - The raw WAV audio buffer to transcribe.
 * @returns {Promise<string>} A promise that resolves to the cleaned transcription text.
 */
export async function TranscribeWavBuffer(buffer) {
  const audioBlob = new Blob([buffer], {
    type: "audio/wav",
  });

  const formData = new FormData();
  formData.append("file", audioBlob, "voiceStream.wav");
  formData.append("temperature", "0.0");
  formData.append("temperature_inc", "0.2");
  formData.append("response_format", "json");

  try {
    const res = await fetch(WHISPER_URL, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const json = await res.json();
      const errorText = json.error;
      throw new Error(
        Red(`Whisper failed with code ${res.status}: ${errorText}`),
      );
    }

    const result = await res.json();
    return CleanTranscription(result.text);
  } catch (err) {
    console.error(
      Red(`Error connecting to whisper server or replying on discord: ${err}`),
    );
    return "";
  }
}

/**
 * Calls the configured summarization model with the given chat log
 * and returns the model's response content.
 *
 * @param {ChatMessage[]} chatLog - The conversation history to send to the model.
 * @returns {Promise<string>} The assistant's reply content from the summarization model.
 */
export async function PromptModel(chatLog) {
  const res = await ollama.chat({
    model: SUMMARY_MODEL,
    messages: chatLog,
    stream: false,
  });

  return res.message.content;
}

/**
 * Formats a duration in milliseconds into a human-readable timestamp string (HH:MM:SS:mmm).
 * Handles zero-padding for consistent width (e.g., converts 65000ms to "00:01:05:000").
 *
 * @param {number} ms - The duration in milliseconds to format.
 * @returns {string} The formatted timestamp string.
 */
export function FormatDuration(ms) {
  // Safety check for invalid inputs
  if (typeof ms !== "number" || ms < 0) return "00:00:00:000";

  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = ms % 1000;

  // Pad numbers with leading zeros (2 digits for H/M/S, 3 digits for MS)
  const h = hours.toString().padStart(2, "0");
  const m = minutes.toString().padStart(2, "0");
  const s = seconds.toString().padStart(2, "0");
  const msPad = milliseconds.toString().padStart(3, "0");

  return `${h}:${m}:${s}:${msPad}`;
}

/**
 * Wraps text in ANSI red color codes for terminal output.
 * Useful for error messages or critical alerts.
 *
 * @param {string} text - The text content to colorize.
 * @returns {string} The text wrapped in red escape codes.
 */
export function Red(text) {
  return `\x1b[31m${text}\x1b[0m`;
}

/**
 * Wraps text in ANSI yellow color codes for terminal output.
 * Useful for warnings or highlighting key variables.
 *
 * @param {string} text - The text content to colorize.
 * @returns {string} The text wrapped in yellow escape codes.
 */
export function Yellow(text) {
  return `\x1b[33m${text}\x1b[0m`;
}

/**
 * Wraps text in ANSI green color codes for terminal output.
 * Useful for success messages or valid states.
 *
 * @param {string} text - The text content to colorize.
 * @returns {string} The text wrapped in green escape codes.
 */
export function Green(text) {
  return `\x1b[32m${text}\x1b[0m`;
}

/**
 * Takes a sessionLog and returns a neatly formatted string
 * Meant for attaching transcripts
 *
 * @param {object[]} chatLog - the standard chatLog for ollama conversations
 * @returns {string} The text neatly formatted and readable
 */
export function BuildTranscript(chatLog) {
  const lines = [];

  for (let i = 0; i < chatLog.length; i++) {
    if (chatLog[i].role == USER) {
      lines.push(chatLog[i].content);
    }
  }

  return lines.join("\n\n");
}

/**
 * Generates a simple ID using Math.random() and Date.now().
 *
 * Format: "<random>-<timestamp>"
 * Example: "4829-1709245809123"
 *
 * @returns {string} A basic pseudo-unique ID string.
 */
function GenerateId() {
  const random = Math.floor(Math.random() * 10_000);
  const timestamp = Date.now();
  return `${random}-${timestamp}`;
}
