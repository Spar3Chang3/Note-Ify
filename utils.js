/**
 * Represents a queued audio processing task containing metadata and raw audio data.
 *
 * @typedef {Object} TranscriptionJob
 * @property {string} userId - The unique Discord user ID of the speaker.
 * @property {string} sessionId - The identifier for the target session chat log.
 * @property {number} startedAt - JavaScript Unix timestamp (milliseconds) when the audio stream started.
 * @property {number} endedAt - JavaScript Unix timestamp (milliseconds) when the audio stream ended.
 * @property {Buffer} wavBuffer - The raw audio stream data stored in a WAV buffer.
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
export const SUMMARY_MODEL = "lstep/neuraldaredevil-8b-abliterated:q8_0";

/**
 * The foundational system prompt that defines the AI's persona and constraints.
 * Used to initialize the summarization context.
 * @constant {string}
 */
export const INITIAL_PROMPT =
  "You are a tabletop role-playing game summarizer. Please summarize the conversation and plot between the following <player> and </player> delimiters. In your response, return a markdown formatted list of current session events, player conversations, notable/funny quotes, and role-play interactions. Your list should retell the session as though it is a story. Be direct, brief, and most of all clear in your summary.";

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
 * A FIFO (First-In-First-Out) queue holding pending transcription jobs.
 * @type {Array<TranscriptionJob>}
 */
export const TranscriptionQueue = [];

/**
 * Global flag tracking if the transcription worker is currently processing a job.
 * @type {boolean}
 */
export let TranscriptionWorking = false;

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
 * Adds a new transcription job to the end of the processing queue.
 *
 * @param {TranscriptionJob} job - The transcription job to queue.
 * @returns {void}
 */
export async function EnqueueTranscription(job) {
  TranscriptionQueue.push(job);
}

/**
 * Removes the next transcription job from the front of the queue and processes it.
 * This function handles the "working" lock state and recursively processes the queue
 * until it is empty.
 *
 * @param {function(TranscriptionJob): Promise<void>} callback - Async function to execute with the dequeued job.
 * @returns {Promise<void>}
 */
export async function DequeueTranscription(callback) {
  // 1. Check if we are already busy
  if (TranscriptionWorking) return;

  // 2. Get the job
  const job = TranscriptionQueue.shift();
  if (!job) return;

  // 3. Lock the worker
  TranscriptionWorking = true;

  try {
    // 4. Wait for the actual work to finish
    await callback(job);
  } catch (error) {
    console.error("Error processing transcription job:", error);
  } finally {
    // 5. Always release the lock, even if the callback failed
    TranscriptionWorking = false;

    // 6. Check if there are more jobs and keep going
    if (TranscriptionQueue.length > 0) {
      // call recursively to process the next item
      DequeueTranscription(callback);
    }
  }
}

/**
 * Updates the global state indicating whether the transcription worker is busy.
 * Used to lock the worker so it doesn't pull multiple jobs simultaneously.
 *
 * @param {boolean} isWorking - The new state (true = busy, false = idle).
 * @returns {void}
 */
export function SetTranscriptionWorking(isWorking) {
  TranscriptionWorking = isWorking;
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
