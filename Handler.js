/**
 * Represents a running Note Ify session and all of its state.
 *
 * @typedef {Object} sessionData
 *
 * @property {import("discord.js").VoiceBasedChannel} voiceChannel
 *   The active voiceChannel that caller is in
 *
 * @property {string} channelId
 *   The Discord text channel ID where session output and summaries are posted.
 *
 * @property {Map<string, string>} players
 *   Map of Discord user IDs representing the participating players and nicknames.
 *
 * @property {string} sessionId
 *   The Discord user ID of the GM representing the session ID
 */
import { Client, AttachmentBuilder, RPCDeviceType } from "discord.js";
import {
  joinVoiceChannel,
  EndBehaviorType,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import prism from "prism-media";
import {
  SYSTEM,
  USER,
  ASSISTANT,
  INITIAL_PROMPT,
  REPLY_PROMPT,
  SILENCE_DURATION,
  FFMPEG_WAV_ARGS,
  MAX_TOKEN_LIMIT,
  EstimateTokens,
  Red,
  Yellow,
  Green,
  BuildTranscript,
  TranscribeWavBuffer,
  PromptModel,
  CHARACTER_LIMIT,
  SplitMessage,
} from "./utils.js";

export default class Handler {
  /** @type {Client | null} */
  client = null;

  /** @type {number} */
  tokenCount = 0;

  /** @type {TranscriptionJob[]} */
  transcriptionQueue = [];

  /** @type {boolean} */
  transcriptionWorking = false;

  /** @type {import("@discordjs/voice").VoiceConnection | null} */
  connection = null;

  /** @type {string | null} */
  textChannelId = null;

  /** @type {string | null} */
  voiceChannelId = null;

  /** @type {string | null} */
  guildId = null;

  /** @type {string | null} */
  sessionId = null;

  /** @type {{ role: string, content: string }[]} */
  chatLog = [];

  /** @type {any} */
  adapterCreator = null;

  /** @type {Map<string, boolean>} */
  activeVoiceStreams = new Map();

  /** @type {Map<string, string>} */
  activePlayers = new Map();

  /** @type {number} */
  startTime = Date.now();

  /** @type {number} */
  endTime = Date.now();

  /**
   * Creates a new Hanlder instance for a single Note Ify session.
   *
   * @param {sessionData} sessionData - All data to start a handler instance
   * @param {Client} client - Discord bot client
   */
  constructor(sessionData, client) {
    this.client = client;
    this.sessionId = sessionData.sessionId;
    this.connection = joinVoiceChannel({
      channelId: sessionData.voiceChannel.id,
      guildId: sessionData.voiceChannel.guild.id,
      adapterCreator: sessionData.voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });
    this.voiceChannelId = sessionData.voiceChannel.id;
    this.textChannelId = sessionData.channelId;
    this.guildId = sessionData.voiceChannel.guild.id;
    this.adapterCreator = sessionData.voiceChannel.guild.voiceAdapterCreator;
    this.activePlayers = sessionData.players;
    this.chatLog.push({ role: SYSTEM, content: INITIAL_PROMPT });
  }

  /**
   * Enqueues a new audio transcription job and starts the worker
   * if it is currently idle.
   *
   * @param {TranscriptionJob} job - The transcription job to enqueue.
   * @returns {Promise<void>}
   */
  async enqueueTranscription(job) {
    this.transcriptionQueue.push(job);

    if (!this.transcriptionWorking) {
      this.dequeueTranscription();
    }
  }

  /**
   * Dequeues and processes transcription jobs one-by-one.
   * Uses a simple lock (`transcriptionWorking`) to ensure only
   * one job is processed at a time. Automatically continues
   * until the queue is empty.
   *
   * @returns {Promise<void>}
   */
  async dequeueTranscription() {
    if (this.transcriptionWorking || this.transcriptionQueue.length === 0)
      return;

    const job = this.transcriptionQueue.shift();
    if (!job) return;

    this.transcriptionWorking = true;

    try {
      const transcription = await TranscribeWavBuffer(job.buffer);
      if (transcription.length > 0) {
        const player = this.activePlayers.get(job.userId);
        const content = `<${player}>${transcription}</${player}>`;

        this.chatLog.push({ role: USER, content: content });

        this.tokenCount = this.tokenCount + EstimateTokens(content);
        await this.checkTokenLimit();
      }
    } catch (err) {
      console.error(Red(`Error processing transcription job: ${err}`));
    } finally {
      this.transcriptionWorking = false;

      this.dequeueTranscription();
    }
  }

  /**
   * Starts listening for voice activity events on the current connection
   * and spawns per-user listening streams when users begin speaking.
   *
   * @returns {void}
   */
  startVoiceReceiver() {
    const receiver = this.connection.receiver;

    receiver.speaking.on("start", (userId) => {
      if (this.activeVoiceStreams.has(userId)) return;

      const member = this.activePlayers.get(userId);
      if (!member) return;

      this.activeVoiceStreams.set(userId, true);
      console.log(`User [${userId}] started speaking...`);

      this.createVoiceListeningStream(receiver, userId, (buffer) =>
        this.enqueueTranscription({ userId, buffer }),
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
   * @param {(buffer: Buffer) => void} callback - Invoked with the final WAV buffer when speech ends.
   * @returns {void}
   */
  createVoiceListeningStream(receiver, userId, callback) {
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

    const wavChunks = [];

    ffmpeg.on("data", (chunk) => {
      wavChunks.push(chunk);
    });

    ffmpeg.on("end", () => {
      const buffer = Buffer.concat(wavChunks);
      console.log(
        Green(
          `Finished processing <${buffer.length}> bytes of WAV audio for user [${userId}]`,
        ),
      );

      if (this.activeVoiceStreams.has(userId)) {
        this.activeVoiceStreams.delete(userId);
      }

      if (buffer.length > 0) {
        callback(buffer);
      }
    });

    opusStream.pipe(decoder).pipe(ffmpeg);

    const errorHandler = (err, source) => {
      console.error(`Error in "${source}" for [${userId}]:`, err);
      if (this.activeVoiceStreams.has(userId)) {
        this.activeVoiceStreams.delete(userId);
      }
      opusStream.destroy();
    };

    opusStream.on("error", (err) => errorHandler(err, "OpusStream"));
    decoder.on("error", (err) => errorHandler(err, "Decoder"));
    ffmpeg.on("error", (err) => errorHandler(err, "FFmpeg"));
  }

  /**
   * Wires the voice connection's Ready event to start the
   * voice receiver and log a status message. Call this once
   * after constructing the Handler.
   *
   * @returns {Promise<void>}
   */
  async start() {
    this.connection.on(VoiceConnectionStatus.Ready, () => {
      console.log(
        Green(
          `Voice connected for channel [${this.voiceChannelId}], starting receiver.`,
        ),
      );
      this.startVoiceReceiver();
    });
  }

  /**
   * Pauses the current session by destroying the voice connection,
   * waiting for all transcription jobs to finish, summarizing the
   * current chat log, and resetting the log with the new summary context.
   *
   * @returns {Promise<void>}
   */
  async pause() {
    this.connection.destroy();

    await this.finishTranscriptionQueue();
    console.log(
      Yellow(
        `Session [${sessionId}] paused. Piping all content to summarizing LLM`,
      ),
    );

    const transcript = BuildTranscript(chatLog);
    const transcriptAttachment = new AttachmentBuilder(
      Buffer.from(transcript, "utf8"),
      { name: `TRANSCRIPT-${new Date().toLocaleDateString()}.txt` },
    );

    const channel = this.client.channels.cache.get(this.textChannelId);
    await channel?.sendTyping();

    const markdownSummary = await PromptModel(this.chatLog);
    await channel?.send({
      content: "Summarized the current game state and ready to unpause!",
      files: [transcriptAttachment],
    });

    this.chatLog = [
      { role: SYSTEM, content: INITIAL_PROMPT },
      { role: ASSISTANT, content: markdownSummary },
    ];

    this.activeVoiceStreams.clear();
  }

  /**
   * Resumes a previously paused session by rejoining the voice channel
   * and restarting the voice receiver.
   *
   * @returns {Promise<void>}
   */
  async unpause() {
    this.connection = joinVoiceChannel({
      channelId: this.voiceChannelId,
      guildId: this.guildId,
      adapterCreator: this.adapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    await this.start();
  }

  /**
   * Stops the current session entirely: destroys the voice connection,
   * waits for any remaining transcription work to finish, sends a full
   * summary + transcript to the text channel, and opens a feedback thread
   * for the GM to refine the summary.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    this.connection.destroy();

    await this.finishTranscriptionQueue();
    console.log(
      Yellow(
        `Session [${this.sessionId}] stopped. Piping all content to summarizing LLM`,
      ),
    );

    const transcript = BuildTranscript(this.chatLog);
    const transcriptAttachment = new AttachmentBuilder(
      Buffer.from(transcript, "utf8"),
      { name: `TRANSCRIPT-${new Date().toLocaleDateString()}.txt` },
    );

    const channel = this.client.channels.cache.get(this.textChannelId);
    await channel.sendTyping();

    const markdownSummary = await PromptModel(this.chatLog);
    const splitSummary = SplitMessage(markdownSummary);
    for (let i = 0; i < splitSummary.length; i++) {
      await channel?.send({
        content: `${splitSummary[i]} \n\n-# (Part ${i + 1}/${splitSummary.length})`,
      });
    }
    const summaryMessage = await channel?.send({
      files: [transcriptAttachment],
    });
    console.log(
      Green(
        `Summary finished. Sending to channel [${this.textChannelId}] and awaiting summary change prompting.`,
      ),
    );

    this.activeVoiceStreams.clear();

    if (summaryMessage) {
      const thread = await summaryMessage.startThread({
        name: `Session Summary Discussion - ${new Date().toLocaleDateString()}`,
        autoArchiveDuration: 1440,
        reason: `Post session discussion for <@${this.sessionId}>`,
      });

      console.log(
        Green(`Thread [${thread.name}] created. Updating assistant prompt.`),
      );

      this.chatLog = [
        { role: SYSTEM, content: INITIAL_PROMPT },
        { role: ASSISTANT, content: markdownSummary },
        { role: SYSTEM, content: REPLY_PROMPT },
      ];

      await thread.send(
        "You now have 30 minutes to reply and update the summary here. I will only listen to the GM, in fact I will listen to EVERYTHING the GM says, so no fluff.",
      );

      const collector = thread.createMessageCollector({
        filter: (m) => !m.author.bot && m.author.id === this.sessionId,
        time: 30 * 60 * 1000,
      });

      collector.on("collect", async (feedbackMessage) => {
        await feedbackMessage.react("🔄");
        await thread.sendTyping();

        this.chatLog.push({
          role: USER,
          content: feedbackMessage.content,
        });
        console.log(Yellow(`User asked: ${feedbackMessage.content}`));

        const reviseMessage = await PromptModel(this.chatLog);
        const splitRevise = SplitMessage(reviseMessage);
        for (let i = 0; i < splitRevise.length; i++) {
          await thread.send(
            `${splitRevise[i]} \n\n-# (Part ${i + 1}/${splitRevise.length})`,
          );
        }
        this.chatLog.push({
          role: ASSISTANT,
          content: reviseMessage,
        });
      });

      collector.on("end", () => {
        thread.send(
          "Summary editing by me has been locked! You now gotta do it yourself",
        );
      });
    }
  }

  /**
   * Checks whether the current token count is approaching or exceeding
   * the model's maximum limit and notifies the GM in the text channel
   * when thresholds are crossed.
   *
   * @returns {Promise<void>}
   */
  async checkTokenLimit() {
    if (
      this.tokenCount >= MAX_TOKEN_LIMIT * 0.75 &&
      this.tokenCount <= MAX_TOKEN_LIMIT * 0.85
    ) {
      await this.client.channels.cache
        .get(this.textChannelId)
        ?.send(
          "## Warning!!! \n Summarizing token maximum is 75% full! Due to memory constraints and that <311952559755493378> is a lazy bitch, I will soon forcefully disconnect to summarize the current game state. \n You can mitigate this by taking a break and telling me to `!pause-session`!",
        );
    } else if (this.tokenCount >= MAX_TOKEN_LIMIT * 0.85) {
      // need to pause and then rejoin automatically here
    }
  }

  /**
   * Blocks until all queued transcription jobs have been processed
   * and the worker is idle. Used before summarizing to ensure that
   * no conversation audio is missing from the final transcript.
   *
   * @returns {Promise<void>}
   */
  async finishTranscriptionQueue() {
    while (this.transcriptionWorking || this.transcriptionQueue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
