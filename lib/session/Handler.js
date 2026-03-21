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
  SCAN_PROMPT,
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
  SUMMARY_MODEL,
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
  sessionPaused = false;

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

  /** @type {number} */
  chatLogIndex = 0;

  /** @type {{ role: string, content: string }[][]} */
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

    this.chatLog[this.chatLogIndex] = [
      { role: SYSTEM, content: INITIAL_PROMPT },
    ];

    this.connection = joinVoiceChannel({
      channelId: sessionData.voiceChannel?.id,
      guildId: sessionData.voiceChannel?.guild?.id,
      adapterCreator: sessionData.voiceChannel?.guild?.voiceAdapterCreator,
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

      let finalTranscript, finalSummary;
      const transcriptParts = [];
      const summaryChat = [{ role: SYSTEM, content: SCAN_PROMPT }];

      try {
        const index = this.chatLogIndex;

        for (let i = 0; i <= index; i++) {
          const { transcript, summary } = await this.getSummaryAndTranscript(i);
          transcriptParts.push(transToAdd);
          summaryChat.push({
            role: USER,
            content: `<summary>\n${sumToAdd}\n</summary>`,
          });
        }

        finalSummary = await PromptModel(summaryChat);
      } catch (err) {
        console.error(Red("Failed to build transcript/summary"), err);

        finalTranscript = null;
        finalSummary =
          "**⚠️ Summary failed (model error). Transcript should be attached if available.**";
      }

      finalTranscript = Buffer.concat(transcriptParts);
      const transcriptAttachment = new AttachmentBuilder(
        Buffer.from(transcript, "utf8"),
        { name: `TRANSCRIPT-${new Date().toLocaleDateString()}.txt` },
      );

      const channel = await this.getTextChannel();
      if (!channel) return;
      await channel.sendTyping().catch(() => {});

      try {
        for (const chunk of SplitMessage(finalSummary ?? "")) {
          await channel.send({ content: chunk });
        }
      } catch (err) {
        console.error(Red("Failed sending summary chunks"), err);
      }

      let summaryMessage = null;
      if (transcript) {
        try {
          summaryMessage = await channel.send({
            files: [transcriptAttachment],
          });
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
      const feedbackChat = [
        { role: SYSTEM, content: REPLY_PROMPT },
        { role: ASSISTANT, content: summary },
      ];
      try {
        thread = await summaryMessage.startThread({
          name: `Session Summary Discussion - ${new Date().toLocaleDateString()}`,
          autoArchiveDuration: 1440,
          reason: `Post session discussion for number [${this.guildId}]`,
        });
        console.log(
          Green(`Thread [${thread.name}] created. Updated assistant prompt.`),
        );
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

            feedbackChat.push({
              role: USER,
              content: feedbackMessage.content,
            });

            console.log(Yellow(`User asked: ${feedbackMessage.content}`));

            const reviseMessage = await PromptModel(feedbackChat);

            for (const chunk of SplitMessage(reviseMessage ?? "")) {
              await thread.send(chunk);
            }

            feedbackChat.push({
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
   * Takes and prompts model based on a given index,
   * then returns the summary
   *
   * @param {number} index
   *
   * @returns {Promise<{ transcript: Buffer<string>, summary: string }>}
   */
  async getSummaryAndTranscript(index) {
    const markdownSummary = await PromptModel(this.chatLog[index]);
    const transcript = BuildTranscript(this.chatLog[index]);

    return {
      transcript: Buffer.from(transcript, "utf8"),
      summary: markdownSummary,
    };
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
