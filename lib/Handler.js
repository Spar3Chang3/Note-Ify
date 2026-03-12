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
 *   An identification of the session based on the guildId as of right now
 *
 * @property {string} gmId
 *   The discord user ID of the Game Master
 *
 * @property {Set<string>} trustees
 *   The set of trustees given for anybody who can externally control
 */
import { Client, AttachmentBuilder, RPCDeviceType } from "discord.js";
import {
  joinVoiceChannel,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
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
  COLLECTOR_DURATION,
  EstimateTokens,
  Red,
  Yellow,
  Green,
  BuildTranscript,
  TranscribeWavBuffer,
  PromptModel,
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

  /** @type {boolean} */
  sessionTransitioning = false;

  /** @type {boolean} */
  warnedTokenLimit = false;

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

  /** @type {string | null} */
  gmId = null;

  /** @type {Set<string> | null} */
  trustees = null;

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

  /** @type {setTimeout} */
  timeout = null;

  /**
   * Creates a new Hanlder instance for a single Note Ify session.
   *
   * @param {sessionData} sessionData - All data to start a handler instance
   * @param {Client} client - Discord bot client
   */
  constructor(sessionData, client) {
    this.client = client;
    this.sessionId = sessionData.sessionId;
    this.gmId = sessionData.gmId;
    this.trustees = sessionData.trustees;

    this.voiceChannelId = sessionData.voiceChannel?.id;
    this.textChannelId = sessionData.channelId;
    this.guildId = sessionData.voiceChannel?.guild?.id;
    this.adapterCreator = sessionData.voiceChannel?.guild?.voiceAdapterCreator;
    this.activePlayers = sessionData.players;

    this.chatLog.push({ role: SYSTEM, content: INITIAL_PROMPT });

    this.connection = joinVoiceChannel({
      channelId: sessionData.voiceChannel?.id,
      guildId: sessionData.voiceChannel?.guild?.id,
      adapterCreator: sessionData.voiceChannel?.guild?.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });
    andler;
    this.connection.on("error", (err) => {
      console.error(
        Red(`Voice connection error in session [${this.sessionId}]:'`),
        err,
      );
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.log(Yellow(`Voice disconnected for session [${this.sessionId}]`));

      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        console.log(
          Red(`Voice connection destroyed for session [${this.sessionId}]`),
        );
        this.connection.destroy();
      }
    });
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
        const content = `<${player}>\n${transcription}</${player}>`;

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
      if (!member) {
        console.log(
          Yellow(`Ignoring speaker [${userId}] - not in activePlayers`),
        );
        return;
      }

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
        console.error(Red(`Stream cleanup (${reason}) for [${userId}:`), err);
      } else {
        console.log(Yellow(`Stream cleanup (${reason}) for [${userId}]`));
      }
    };

    const finalize = (reason) => {
      if (finished) return;
      finished = true;

      const buffer = Buffer.concat(wavChunks);

      console.log(
        Green(
          `Finished processing <${buffer.length}> bytes of WAV audio for user [${userId}]`,
        ),
      );

      cleanup(reason);

      if (buffer.length > 0) {
        callback(buffer);
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

    // TODO: add these reason codes as a variable in utils.js
  }

  /**
   * Wires the voice connection's Ready event to start the
   * voice receiver and log a status message. Call this once
   * after constructing the Handler.
   *
   * @returns {Promise<void>}
   */
  async start() {
    if (!this.connection) {
      console.log(
        Red(
          `There was no set connection for session [${this.sessionId}], returning`,
        ),
      );
      return;
    }

    if (this.connection.state.status === VoiceConnectionStatus.Ready) {
      console.log(
        Green(
          `Voice already ready for [${this.voiceChannelId}], starting receiver.`,
        ),
      );
      this.startVoiceReceiver();
      return;
    }

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000);
      console.log(
        Green(
          `Voice connected for channel [${this.voiceChannelId}], starting receiver.`,
        ),
      );
      this.startVoiceReceiver();
    } catch (err) {
      console.error(
        Red(`Voice never became ready for session [${this.sessionId}]`),
        err,
      );
    }
  }

  /**
   * Pauses the current session by destroying the voice connection,
   * waiting for all transcription jobs to finish, summarizing the
   * current chat log, and resetting the log with the new summary context.
   *
   * @returns {Promise<void>}
   */
  async pause() {
    if (this.sessionTransitioning) return;
    this.sessionTransitioning = true;

    try {
      try {
        this.connection.destroy();
      } catch (err) {
        console.error(Red("Failed to destroy voice connection:"), err);
      }

      await this.finishTranscriptionQueue();
      console.log(
        Yellow(
          `Session [${this.sessionId}] paused. Piping all content to summarizing LLM`,
        ),
      );

      this.activeVoiceStreams.clear();

      const channel = await this.getTextChannel();
      if (!channel) return;
      await channel.sendTyping().catch(() => {});

      await channel
        .send(
          `I'm pausing and refreshing the token limit. I will automaticaly rejoin in ~${Math.floor(Math.random() * 10)} minutes`,
        )
        .catch(() => {});

      let transcript, summary;
      try {
        ({ transcript, summary } = await this.getSummaryAndBuildTranscript());
      } catch (err) {
        console.error(Red("Failed to build transcript/summary"), err);

        transcript = null;
        summary =
          "**⚠️ Summary failed (model error). I will infer what previously happened at the next chat.**";
      }

      this.tokenCount = EstimateTokens(summary);

      this.chatLog = [
        { role: SYSTEM, content: INITIAL_PROMPT },
        { role: ASSISTANT, content: summary },
      ];

      await channel
        .send({
          content: "Summarized the current game state and ready to unpause!",
          files: [transcript],
        })
        .catch(() => {});
    } catch (err) {
      console.log(Red(`**SUPER ERROR - BROKE TRY CATCH CHAIN**:`), err);
    } finally {
      this.sessionTransitioning = false;
    }
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

    this.connection.on("error", (err) => {
      console.error(
        Red(`Voice connection error in session [${this.sessionId}]:'`),
        err,
      );
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.log(Yellow(`Voice disconnected for session [${this.sessionId}]`));

      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        console.log(
          Red(`Voice connection destroyed for session [${this.sessionId}]`),
        );
        this.connection.destroy();
      }
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
    try {
      try {
        this.connection.destroy();
      } catch (err) {
        console.error(Red("Failed to destroy voice connection:"), err);
      }

      await this.finishTranscriptionQueue();
      console.log(
        Yellow(
          `Session [${this.sessionId}] stopped. Piping all content to summarizing LLM`,
        ),
      );
      this.activeVoiceStreams.clear();

      let transcript, summary;
      try {
        ({ transcript, summary } = await this.getSummaryAndBuildTranscript());
      } catch (err) {
        console.error(Red("Failed to build transcript/summary"), err);

        transcript = null;
        summary =
          "**⚠️ Summary failed (model error). Transcript should be attached if available.**";
      }

      const channel = await this.getTextChannel();
      if (!channel) return;
      await channel.sendTyping().catch(() => {});

      try {
        for (const chunk of SplitMessage(summary ?? "")) {
          await channel.send({ content: chunk });
        }
      } catch (err) {
        console.error(Red("Failed sending summary chunks"), err);
      }

      let summaryMessage = null;
      if (transcript) {
        try {
          summaryMessage = await channel.send({ files: [transcript] });
          console.log(
            Green(
              `Summary finished. Sending to channel [${this.textChannelId}] and awaiting summary change prompting.`,
            ),
          );
        } catch (err) {
          console.error(Red("Failed sending transcript attachment"), err);
        }
      }

      if (!summaryMessage) return;

      let thread;
      try {
        thread = await summaryMessage.startThread({
          name: `Session Summary Discussion - ${new Date().toLocaleDateString()}`,
          autoArchiveDuration: 1440,
          reason: `Post session discussion for number [${this.guildId}]`,
        });
        console.log(
          Green(`Thread [${thread.name}] created. Updating assistant prompt.`),
        );
        this.chatLog = [
          { role: SYSTEM, content: INITIAL_PROMPT },
          { role: ASSISTANT, content: summary },
          { role: SYSTEM, content: REPLY_PROMPT },
        ];
      } catch (err) {
        console.error(Red("Failed to start thread:"), err);
        await channel
          .send(
            "**I failed to start a thread for the summary, unfortunately you're on your own**",
          )
          .catch(() => {});
        return;
      }

      try {
        await thread.send(
          "You now have 30 minutes to reply and update the summary here. Just tell me what you want changed and I'll get to work!",
        );
      } catch (err) {
        console.error(Red("Failed to send thread intro message:"), err);
      }

      const collector = thread.createMessageCollector({
        filter: (m) =>
          !m.author.bot && !!m.member && this.trustees?.has(m.member.id),
        time: COLLECTOR_DURATION,
      });

      collector.on("collect", (feedbackMessage) => {
        void (async () => {
          try {
            await feedbackMessage.react("🔄").catch(() => {});
            await thread.sendTyping().catch(() => {});

            this.chatLog.push({
              role: USER,
              content: feedbackMessage.content,
            });

            console.log(Yellow(`User asked: ${feedbackMessage.content}`));

            const reviseMessage = await PromptModel(this.chatLog);

            for (const chunk of SplitMessage(reviseMessage ?? "")) {
              await thread.send(chunk);
            }

            this.chatLog.push({
              role: ASSISTANT,
              content: reviseMessage,
            });
          } catch (err) {
            console.error(Red("Error handling thread feedback:"), err);
            await thread
              .send("⚠️ I hit an error trying to revise that. Try again?")
              .catch(() => {});
          }
        })();
      });

      collector.on("end", () => {
        void thread
          .send(
            "Summary editing by me has been locked! You now gotta do it yourself",
          )
          .catch(() => {});
      });
    } catch (err) {
      console.log(Red("**SUPER ERROR - BROKE TRY CATCH CHAIN**:"), err);
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
      this.tokenCount <= MAX_TOKEN_LIMIT * 0.85 &&
      !this.warnedTokenLimit
    ) {
      try {
        const channel = await this.getTextChannel();
        await channel?.send(
          `## ⚠️ Warning <@${this.gmId}> \n Summarizing token maximum is 75% full! Due to memory constraints, I will soon forcefully disconnect to summarize the current game state. \n You can mitigate this by taking a break and telling me \`@bot pause\`!`,
        );
      } catch (err) {
        console.error(
          Yellow(`Tried to warn token limit but could not send message:`),
          err,
        );
      }

      this.warnedTokenLimit = true;
    } else if (this.tokenCount >= MAX_TOKEN_LIMIT * 0.85) {
      try {
        const channel = await this.getTextChannel();
        await channel?.send(
          `I'm sorry, but I had to disconnect. Please wait ~${Math.floor(Math.random() * 10)} minutes and I should automatically rejoin`,
        );

        await this.pause();
        await this.unpause();
      } catch (err) {
        console.error(
          Yellow(`Tried to give disconnect reason but could not send message:`),
          err,
        );
      }

      this.warnedTokenLimit = false;
      this.tokenCount = EstimateTokens(
        this.chatLog[this.chatLog.length - 1].content,
      );
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

  /**
   * Gets the configured session text channel and ensures it is text-based
   *
   * @returns {Promise<import("discord.js").TextBasedChannel | null>}
   */
  async getTextChannel() {
    if (!this.client || !this.textChannelId) {
      console.error(
        Red(`Cannog get text channel: missing client or textChannelId`),
      );
      return null;
    }

    try {
      let channel = this.client.channels?.cache?.get(this.textChannelId);

      if (!channel) {
        channel = await this.client.channels?.fetch(this.textChannelId);
      }

      if (!channel) {
        console.error(
          Red(`Text channel [${this.textChannelId}] could not be found`),
        );
        return null;
      }

      if (!channel.isTextBased()) {
        console.error(Red(`Channel [${this.textChannelId}] is not text-based`));
        return null;
      }

      return channel;
    } catch (err) {
      console.error(
        Red(`Failed to fetch text channel [${this.textChannelId}]:`),
        err,
      );
      return null;
    }
  }

  /**
   * Takes current instance of chatLog and prompts model,
   * then sends current transcript in chat.
   *
   * @returns {Promise<{ transcript: AttachmentBuilder, summary: string }>}
   */
  async getSummaryAndBuildTranscript() {
    const transcript = BuildTranscript(this.chatLog);
    const transcriptAttachment = new AttachmentBuilder(
      Buffer.from(transcript, "utf8"),
      { name: `TRANSCRIPT-${new Date().toLocaleDateString()}.txt` },
    );

    const markdownSummary = await PromptModel(this.chatLog);

    return { transcript: transcriptAttachment, summary: markdownSummary };
  }

  /**
   * Checks if the current player map contains a certain player id
   *
   * @param {string} playerId
   *
   * @returns {boolean}
   */
  hasPlayer(playerId) {
    return this.activePlayers.has(playerId);
  }

  /**
   * Checks if the current trustee set contains a certain id
   *
   * @param {string} trusteeId
   *
   * @returns {boolean}
   */
  hasTrustee(trusteeId) {
    return this.trustees.has(trusteeId);
  }
}
