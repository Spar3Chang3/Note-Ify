import { SILENCE_DURATION, FFMPEG_WAV_ARGS } from "@/lib/static/Constants.js";
import QueueHandler from "@/lib/session/QueueHandler.js";
import {
  joinVoiceChannel,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";
import prism from "prism-media";

export default class CallHandler {
  /** @type {import("@discordjs/voice").VoiceConnection | null} */
  connection = null;

  /** @type {Map<string, boolean>} */
  activeVoiceStreams = new Map();

  /** @type {Set<string>} */
  receivablePlayers = new Set();

  /** @type {import("@discordjs/voice).VoiceBasedChannel | null} */
  voiceChannel = null;

  /** @type {string} */
  sessionId = null;

  /** @type {QueueHandler | null} */
  transcriptionQueue = null;

  /** @type {string} */
  guildId = null;

  /**
   *
   * @param {import("@discordjs/voice").VoiceBasedChannel} voiceChannel
   * @param {Set<string>} receivablePlayers
   * @param {QueueHandler} transcriptionQueue
   *
   */
  constructor(guildId, voiceChannel, receivablePlayers, transcriptionQueue) {
    this.guildId = guildId;
    this.voiceChannel = voiceChannel;
    this.receivablePlayers = receivablePlayers;
    this.transcriptionQueue = transcriptionQueue;
  }

  /**
   * Joins Discord voice call
   *
   * @returns {void}
   */
  async joinCall() {
    this.connection = joinVoiceChannel({
      channelId: this.voiceChannel.id,
      guildId: this.guildId,
      adapterCreator: this.voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    this.connection.on("error", (err) => {
      console.error("Could not join voice channel:", err);
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.log("Voice disconnected");

      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        console.error("Voice connection destroyed");
        this.connection.destroy();
      }
    });

    await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000);
    console.log(`Joined voice channel ${this.voiceChannel.id}`);

    this.startVoiceReceiver();
  }

  /**
   * Leaves Discord voice call
   *
   * @returns {void}
   */
  leaveCall() {
    this.connection.destroy();
    this.activeVoiceStreams.clear();
  }

  /**
   * Starts listening for voice activity events on the current connection
   * and spawns per-user listening streams when users begin speaking.
   *
   * @returns {void}
   */
  startVoiceReceiver() {
    this.activeVoiceStreams.clear();
    const receiver = this.connection.receiver;

    receiver.speaking.on("start", (userId) => {
      if (this.activeVoiceStreams.has(userId)) return;

      if (!this.receivablePlayers.has(userId)) {
        console.log(`Ignoring speaker [${userId}]`);
        return;
      }

      this.activeVoiceStreams.set(userId, true);
      console.log(`User [${userId}] started speaking...`);

      this.createVoiceListeningStream(receiver, userId, (stream) =>
        this.transcriptionQueue.enqueue({ userId, ...stream }),
      );
    });
  }

  /**
   * Subscribes to a user's Opus audio stream, decodes it to WAV via FFmpeg,
   * and calls the supplied callback with the resulting buffer once the user
   * stops speaking (after a configured silence duration).
   *
   * @param {import("@discordjs/voice").AudioReceiveStream} receiver - The voice receiver from the current connection.
   * @param {string} userId - The Discord user ID whose audio to capture.
   * @param {({ start: Date.now, end: Date.now, buffer: buffer}: stream) => void} callback - Invoked with the final WAV buffer when speech ends.
   *
   * @returns {void}
   */
  createVoiceListeningStream(receiver, userId, callback) {
    const start = Date.now();
    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: SILENCE_DURATION,
      },
    });
    const decoder = new prism.opus.Decoder({
      channels: 2,
      rate: 48000,
    });
    const ffmpeg = new prism.FFmpeg({
      args: FFMPEG_WAV_ARGS,
    });

    /** @type {Buffer[]} */
    const wavChunks = [];

    let finished = false;

    const cleanup = (reason, err) => {
      if (this.activeVoiceStreams.has(userId)) {
        this.activeVoiceStreams.delete(userId);
      }

      try {
        opusStream.destroy();
      } catch {}
      try {
        decoder.destroy?.();
      } catch {}
      try {
        ffmpeg.destroy?.();
      } catch {}

      if (err) {
        console.error(`Stream cleanup (${reason}) for [${userId}:`, err);
      } else {
        console.log(`Stream cleanup (${reason}) for [${userId}]`);
      }
    };

    const finalize = (reason) => {
      if (finished) return;
      finished = true;

      const end = Date.now();

      const buffer = Buffer.concat(wavChunks);

      console.log(
        `Finished processing <${buffer.length}> bytes of WAV audio for user [${userId}]`,
      );

      cleanup(reason);

      if (buffer.length > 0) {
        callback({
          start,
          end,
          buffer,
        });
      }
    };

    ffmpeg.on("data", (chunk) => {
      wavChunks.push(chunk);
    });

    ffmpeg.once("end", () => finalize("ffmpeg-end"));
    ffmpeg.once("close", () => finalize("ffmpeg-close"));

    // opusStream.once("end", () => finalize("opus-end"));
    // opusStream.once("close", () => finalize("opus-close"));
    // decoder.once?.("close", () => finalize("decoder-close"));
    //
    // ^^^ This needs to be changed to account for ffmpeg not being finished
    // Otherwise bytes won't be returned in time and won't transcribe anything
    // This is a low priority, as any real errors are currently caught (except for "corrupted" encoding [looking at you opus])

    opusStream.once("error", (err) => {
      if (!finished) {
        finished = true;
        cleanup("opus-error", err);
      }
    });
    decoder.once("error", (err) => {
      if (!finished) {
        finished = true;
        cleanup("decoder-error", err);
      }
    });
    ffmpeg.once("error", (err) => {
      if (!finished) {
        finished = true;
        cleanup("ffmpeg-error", err);
      }
    });

    opusStream.pipe(decoder).pipe(ffmpeg);
  }
}
