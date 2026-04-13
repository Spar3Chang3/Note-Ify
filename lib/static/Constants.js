import config from "@/conf/conf.toml";

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
export const WHISPER_URL = config.apis.whisper_url;

/**
 * The specific model tag used for generating transcripts.
 * currently a quantized medium model
 * @constant {string}
 */
export const WHISPER_MODEL = config.models.whisper_model;

/**
 * The specific model tag used for generating summaries.
 * currently using a qwen3 8b abliterated model
 * @constant {string}
 */
export const SUMMARY_MODEL = config.models.summary_model;

/**
 * Your Discord Bot token
 * Used to login as your bot when running the program
 * This should not be used if you can help it, but if you're lazy then I entirely understand (me too)
 * @constant {string}
 */
export const DISCORD_TOKEN = config.tokens.discord_token;

/**
 * The foundational system prompt that defines the AI's persona and constraints.
 * Used to initialize the summarization context.
 * @constant {string}
 */
export const SUMMARY_PROMPT = config.prompts.summary_prompt;

/**
 * The consistency system prompt that scans over all given summaries across token splits.
 * Used to attempt a coherent story
 * @constant {string}
 */
export const CRITIC_PROMPT = config.prompts.critic_prompt;

/**
 * The editing system prompt that defines how the ai should edit its summary.
 * Used to ready the AI for user prompting.
 * @constant {string}
 */
export const FEEDBACK_PROMPT = config.prompts.feedback_prompt;

/**
 * The duration of silence for the OPUS stream to end
 * Used to keep OPUS streams accurate and subtract from end time
 * @constant {number}
 */
export const SILENCE_DURATION = 500;

/**
 * The duration summary bot keeps a collector open for
 * Used to make sure threads don't instantly close
 * @constant {number}
 */
export const COLLECTOR_DURATION =
  60 * 1000 * parseInt(config.limits.feedback_time);

/**
 * The model parameters you don't want to fuck with
 * @constant {number}
 * @constant {number}
 * @constant {number}
 */
export const TEMPERATURE = parseFloat(config.limits.temperature);

export const TOP_K = parseInt(config.limits.top_k);

export const TOP_P = parseFloat(config.limits.top_p);

/**
 * The number of characters before sending a message in discord
 * you really shouldn't mess with this unless you somehow got bot initial_prompt
 *
 * @constant {number}
 */
export const CHARACTER_LIMIT = 1950;

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
export const MAX_TOKEN_LIMIT = config.limits.token_limit;

/**
 * The list of commands for Note Ify
 * @constant {Object}
 */
export const COMMAND_LIST = {
  start: {
    cmd: "start",
    flags: {
      gm: "--gm",
      trusted: "--trustees",
      players: "--players",
      force: "--force",
    },
    desc: "Tells the bot to join the voice channel you're currently in and begin recording the session. You can optionally specify participants using flags: `--gm @user` to set the game master (defaults to you), `--players @user @user ...` to list players to track, `--trustees @user @user ...` to allow additional users to control the bot, and `--force` to foce the bot to leave/restart a session. Example: `@bot start --gm @gmUser --players @p1 @p2 --trustees @helper --force`.",
  },
  stop: {
    cmd: "stop",
    desc: "Tells the bot to leave the voice channel and begin summarizing the session. Only the GM or users listed with `--trustees` during `start` can run this command. Usage: `@bot stop`.",
  },
  pause: {
    cmd: "pause",
    desc: "Tells the bot to remain in the voice channel but stop recording and summarize the current game state. Useful for breaks or resetting the model's context. Only the GM or users listed with `--trustees` during `start` can run this command. Usage: `@bot pause`.",
  },
  unpause: {
    cmd: "unpause",
    desc: "Resumes recording for the previously specified participants after a pause. The bot will continue monitoring the same players defined during `start`. Only the GM or users listed with `--trustees` can run this command. Usage: `@bot unpause`.",
  },
  help: {
    cmd: "help",
    desc: "Literally this message. Can be used by typing `@bot help`.",
  },
};

/**
 * The command flags from COMMAND_LIST in a Set() for ParseCommands
 * @constant {Set<string>}
 */
export const COMMAND_FLAGS = {
  start: new Set(["--gm", "--trustees", "--players", "--force"]),
};

/**
 * The states that a session can be in
 */
export const SESSION_STATES = {
  idle: "idle",
  playing: "playing",
  paused: "paused",
  revising: "revising",
};

/**
 * The ascii art for logging in
 */
export const LOGIN_ASCII_ART = `
  .-----------------------------------------------.
  |       ___   ___   ___         ___   ___       |
  ||\\  | |   |   |   |             |   |      \\ / |
  || + | |   |   +   |-+-   -+-    +   |-+-    +  |
  ||  \\| |   |   |   |             |   |       |  |
  |       ---         ---         ---             |
  '-----------------------------------------------'
`;

/**
 * The ascii art for an error
 */
export const ERR_ASCII_ART = `
  .-----------------------------.
  | ___   ___   ___   ___   ___ |
  ||     |   | |   | |   | |   ||
  ||-+-  |-+-  |-+-  |   | |-+- |
  ||     |  \\  |  \\  |   | |  \\ |
  | ---               ---       |
  '-----------------------------'
`;
