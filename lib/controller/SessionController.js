import { COLLECTOR_DURATION, SESSION_STATES } from "@/lib/static/Constants.js";
import { SplitMessage } from "@/lib/static/Utils.js";
import ModelHandler from "@/lib/session/ModelHandler.js";
import CallHandler from "@/lib/session/CallHandler.js";
import QueueHandler from "@/lib/session/QueueHandler.js";
import { AttachmentBuilder } from "discord.js";

export default class SessionController {
  /** @type {string | null} */
  sessionId = null;

  /** @type {string | null} */
  sessionState = null;

  /** @type {import("discord.js").Client} */
  client = null;

  /** @type {ModelHandler | null} */
  modelHandler = null;

  /** @type {CallHandler | null} */
  callHandler = null;

  /** @type {QueueHandler | null} */
  queueHandler = null;

  /** @type {Map<string, string> | null} */
  nicknames = null;

  /** @type {Set<string> | null} */
  players = null;

  /** @type {Set<string> | null} */
  trustees = null;

  /** @type {import("@discordjs/voice").VoiceBasedChannel | null} */
  voiceChannel = null;

  /** @type {import("discord.js").TextBasedChannel | null} */
  textChannel = null;

  /** @type {string | null} */
  guildId = null;

  /** @type {number | null} */
  sessionStart = null;

  /** @type {boolean} */
  sessionPaused = false;

  /**
   * @param {import("discord.js").Client} client
   * @param {string} guildId
   * @param {Map<string, string>} nicknames
   * @param {Set<string> | null} players
   * @param {import("@discordjs/voice").VoiceBasedChannel | null} voiceChannel
   * @param {import("discord.js").TextBasedChannel | null} textChannel
   */
  constructor(
    client,
    guildId,
    nicknames,
    players,
    trustees,
    voiceChannel,
    textChannel,
  ) {
    this.sessionState = SESSION_STATES.idle;
    this.sessionId = crypto.randomUUID();
    this.sessionStart = Date.now();
    this.client = client;
    this.guildId = guildId;
    this.nicknames = nicknames;
    this.players = players;
    this.trustees = trustees;
    this.voiceChannel = voiceChannel;
    this.textChannel = textChannel;

    this.modelHandler = new ModelHandler(this.nicknames, this.sessionStart);
    this.queueHandler = new QueueHandler(this.modelHandler);
    this.callHandler = new CallHandler(
      this.guildId,
      this.voiceChannel,
      this.players,
      this.queueHandler,
    );
  }

  /**
   * Joins the call and begins transcribing
   */
  async start() {
    if (this.sessionPaused) return;
    if (this.sessionState === SESSION_STATES.revising) return;

    await this.callHandler.joinCall();

    this.sessionState = SESSION_STATES.playing;
  }

  /**
   * Pauses the current session by destroying the voice connection,
   * waiting for all transcription jobs to finish, summarizing the
   * current chat log, and resetting the log with the new summary context.
   *
   * @returns {Promise<void>}
   */
  async pause() {
    if (this.sessionPaused) return;
    if (
      this.sessionState === SESSION_STATES.idle ||
      this.sessionState === SESSION_STATES.revising
    )
      return;

    await this.callHandler.leaveCall();
    
    console.log(`Session ${this.sessionId} paused. Awaiting unpause...`);

    this.sessionPaused = true;
    this.sessionState = SESSION_STATES.paused;
  }

  /**
   * Resumes a previously paused session by rejoining the voice channel
   * and restarting the voice receiver.
   *
   * @returns {Promise<void>}
   */
  async unpause() {
    if (
      this.sessionState === SESSION_STATES.idle ||
      this.sessionState === SESSION_STATES.revising
    )
      return;

    await this.callHandler.joinCall();
    
    console.log(`Session ${this.sessionId} unpaused...`);

    this.sessionPaused = false;
    this.sessionState = SESSION_STATES.playing;
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
    await this.callHandler.leaveCall();

    console.log(
      `Session [${this.sessionId}] stopped. Piping all content to summarizier`,
    );

    this.sessionState = SESSION_STATES.revising;
    this.sessionPaused = false;

    await this.queueHandler.finishTranscriptionQueue();

    const summaryContent = await this.modelHandler.getCriticSummary();
    const transcriptContent = await this.modelHandler.getTranscript();

    const transcript = new AttachmentBuilder(
      Buffer.from(transcriptContent || "No transcript available.", "utf8"),
      { name: `Transcript-${this.sessionId}.txt` },
    );

    await this.textChannel.sendTyping();

    const finalSummary = summaryContent || "No summary generated.";
    for (const summary of SplitMessage(finalSummary)) {
      if (summary.trim().length > 0) {
        await this.textChannel.send({ content: summary });
      }
    }

    const transcriptMessage = await this.textChannel.send({
      files: [transcript],
    });
    console.log(
      `Summary finished. Sending to channel [${this.textChannel.id}] and awaiting feedback.`,
    );

    if (!transcriptMessage) return;

    const thread = await transcriptMessage.startThread({
      name: `Session Summary Discussion - ${new Date().toLocaleDateString()}`,
      autoArchiveDuration: 1440,
      reason: `Post session discussion for number [${this.guildId}]`,
    });
    console.log(`Thread [${thread.name}] created`);

    await thread.send(
      "You now have 30 minutes to reply and update the summary here. Just tell me what you want changed and I'll get to work!",
    );

    const collector = thread.createMessageCollector({
      filter: (m) => !m.author.bot && this.trustees.has(m.member.id),
      time: COLLECTOR_DURATION,
    });

    collector.on("collect", async (feedback) => {
      await feedback.react("🔄");

      console.log(`User asked: ${feedback.content}`);
      const revised = await this.modelHandler.getSummaryEdit(feedback.content);

      const finalRevised = revised || "I could not generate a revised summary.";
      for (const chunk of SplitMessage(finalRevised)) {
        if (chunk.trim().length > 0) {
          await thread.send({ content: chunk });
        }
      }
    });

    collector.on("end", async () => {
      await thread.send(
        "Summary editing by me has closed! Anything else you wish to edit must be done manually.\n-# If this didn't feel like enough time for you to edit, consider asking my host to increase the feedback duration",
      );
    });
  }

  /**
   * Returns the state of a session between idle, playing, paused, or revising
   *
   * @returns {SESSION_STATES.idle | SESSION_STATES.playing | SESSION_STATES.paused | SESSION_STATES.revising}
   */
  getSessionState() {
    return this.sessionState;
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

  /**
   * Returns the session's ID
   *
   * @returns {string}
   */
  getId() {
    return this.sessionId;
  }

  /**
   * Estimates remaining time to finish transcriptions and summaries in minutes.
   *
   * @returns {number}
   */
  getETA() {
    const pendingBytes = this.queueHandler.queue.reduce(
      (acc, job) => acc + job.buffer.length,
      0
    );
    return this.modelHandler.getETA(pendingBytes);
  }
}
