import { COMMAND_FLAGS } from "@/lib/static/Constants.js";

/**
 * Estimates the number of tokens in a text string using the standard heuristic
 * (1 token ≈ 4 characters).
 *
 * @param {string} text - The input text to measure.
 * @returns {number} The estimated token count (rounded up).
 */
export function EstimateTokens(text) {
  if (!text) return 0;
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

  const match = mention.match(/^<@!?(\d+)>$/);

  return match ? match[1] : null;
}

/**
 * Splits a message into chunks, counting \n and \r as "free" characters
 * for the character limit check, but keeping them intact in the output.
 *
 * @param {string} messageText
 * @returns {string[]}
 */
export function SplitMessage(messageText) {
  const CHARACTER_LIMIT = 1800;
  const parts = [];

  // Helper: count newline characters
  const countNewlines = (str) => (str.match(/[\n\r]/g) || []).length;

  while (true) {
    const newlineCount = countNewlines(messageText);
    const effectiveLength = messageText.length - newlineCount;

    // If the visible length is within the limit, we're done
    if (effectiveLength <= CHARACTER_LIMIT) {
      break;
    }

    // We need to split: look at the window up to the visible limit
    let visibleCount = 0;
    let splitIndex = 0;

    // Walk characters until effective count hits the limit
    for (let i = 0; i < messageText.length; i++) {
      const ch = messageText[i];
      if (ch !== "\n" && ch !== "\r") {
        visibleCount++;
      }
      if (visibleCount > CHARACTER_LIMIT) break;
      splitIndex = i + 1;
    }

    // Now look for nearest *before* newline in that window
    const window = messageText.slice(0, splitIndex);
    const lastNL = Math.max(window.lastIndexOf("\n"), window.lastIndexOf("\r"));

    if (lastNL > 0) {
      splitIndex = lastNL + 1;
    }

    // Push chunk
    parts.push(messageText.slice(0, splitIndex).trimEnd());

    // Shrink remainder
    messageText = messageText.slice(splitIndex).trimStart();
  }

  // Always return at least one element
  parts.push(messageText);

  return parts;
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
 * Parses command arguments and groups them by flags.
 *
 * Flags consume arguments until the next token beginning with "-".
 *
 * Example input:
 * ["--gm", "@user1", "--players", "@p1", "@p2"]
 *
 * Output:
 * {
 *   flagsFound: ["--gm", "--players"],
 *   flagArgs: {
 *     "--gm": ["@user1"],
 *     "--players": ["@p1", "@p2"]
 *   },
 *   freeArgs: []
 * }
 *
 * @param {string[]} args
 * Array of whitespace-split command arguments.
 *
 * @param {Set<string>} flags
 * Mapping of logical flag names to their CLI representation.
 * Example:
 * {
 *   gm: "--gm",
 *   trusted: "--trustee",
 *   players: "--players"
 * }
 *
 * @returns {{
 *   flagsFound: string[],
 *   flagArgs: Record<string, string[]>,
 *   freeArgs: string[]
 * }}
 *
 * flagsFound → list of flags that appeared
 * flagArgs   → arguments belonging to each flag
 * freeArgs   → arguments not associated with any flag
 */
export function ParseCommands(args, flags) {
  if (!flags) flags = COMMAND_FLAGS.start;

  const flagsFound = [];
  const flagArgs = {};
  const freeArgs = [];

  let currentFlag = null;

  for (const token of args) {
    // If token is a known flag
    if (flags.has(token)) {
      currentFlag = token;
      flagsFound.push(token);

      if (!flagArgs[token]) {
        flagArgs[token] = [];
      }

      continue;
    }

    // If token starts a new unknown flag
    if (token.startsWith("-")) {
      currentFlag = null;
      continue;
    }

    if (currentFlag) {
      flagArgs[currentFlag].push(token);
    } else {
      freeArgs.push(token);
    }
  }

  return {
    flagsFound,
    flagArgs,
    freeArgs,
  };
}
