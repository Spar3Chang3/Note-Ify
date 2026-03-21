import ollama from "ollama";
import {
  SUMMARY_MODEL,
  SUMMARY_PROMPT,
  CRITIC_PROMPT,
  FEEDBACK_PROMPT,
  SYSTEM,
  USER,
  ASSISTANT,
  WHISPER_MODEL,
  WHISPER_URL,
  MAX_TOKEN_LIMIT,
} from "@/lib/static/Constants.js";
import {
  EstimateTokens,
  FormatDuration,
  CleanTranscription,
} from "@/lib/static/Utils.js";

/**
 * Represents a queue type job
 *
 * @typedef {Object} Job
 *
 * @property {string} userId
 *  The Discord User ID
 *
 * @property {Buffer} buffer
 *  The voice stream audio data, converted to wav
 *
 * @property {number} start
 *  The JS (millis) unix timestamp where audio stream started
 *
 * @property {number} end
 *  The JS (millis) unix timestamp where audio stream ended
 */

export default class ModelHandler {
  /** @type {{ role: string, content: string }[]} */
  feedbackChat = [];

  /** @type {string[]} */
  summaryLog = [];

  /** @type {{ userContent: string, modelContent: string, modelTokens: number }[]} */
  sessionLog = [];

  /** @type {string} */
  sessionTranscript = "";

  /** @type {Map<string, string>} */
  nicknames = new Map();

  /**
   * @param {Map<string, string>} nicknames
   * @requires Map<string, string>
   */
  constructor(nicknames) {
    this.nicknames = nicknames;
    this.feedbackChat.push({ role: SYSTEM, content: FEEDBACK_PROMPT });
  }

  /**
   * Transcribes a Job and stores a model-readable/user-readable copy internally
   *
   * @param {Job} job
   * @requres Job
   *
   * @returns {void}
   */
  async addTranscription(job) {
    const transcription = await this.promptTranscriber(job.buffer);

    if (transcription.length === 0) return;
    const player = this.nicknames.get(job.userId);
    if (!player) return;

    const start = FormatDuration(job.start);
    const end = FormatDuration(job.end);

    const modelContent = `<${player}>\n${transcription}</${player}>`;
    const modelTokens = EstimateTokens(modelContent);
    const userContent = `<${player} [${start}]>\n${transcription}</${player} [${end}]`;

    this.sessionLog.push({ userContent, modelContent, modelTokens });
  }

  /**
   * Summarizes a session chat and stores it internally
   *
   * @param {string} tokenSplitTranscript
   * @requres string
   */
  async addSummary(tokenSplitTranscript) {
    const chatLog = [
      { role: SYSTEM, content: SUMMARY_PROMPT },
      { role: USER, content: tokenSplitTranscript },
    ];

    const summaryContent = await this.promptSummarizer(chatLog);

    if (summaryContent.length === 0) return;

    const summary = `<summary>${summaryContent}</summary>`;
    this.summaryLog.push(summary);
  }

  /**
   * Loops through session log and continuously prompts models until
   * all summaries are finished, then critiques them for a final summary.
   *
   * Also stores the final summary in a feedback chat for user editing
   * via model prmopting.
   *
   * @returns {Promise<string>}
   */
  async getCriticSummary() {
    let currentTokenCount = 0;
    let currentConvo = "";

    for (const chat of this.sessionLog) {
      currentConvo += chat.modelContent;
      currentTokenCount += chat.modelTokens;

      this.sessionTranscript += `\n${chat.userContent}`;

      if (currentTokenCount >= MAX_TOKEN_LIMIT * 0.75) {
        await this.addSummary(currentConvo);
        currentTokenCount = 0;
        currentConvo = "";
      }
    }

    if (currentConvo.length > 0) {
      await this.addSummary(currentConvo);
    }

    if (this.summaryLog.length === 0) {
      throw new Error("Something went wrong with getting the final summary:");
    }

    if (this.summaryLog.length === 1) {
      this.feedbackChat.push({ role: ASSISTANT, content: this.summaryLog[0] });
      return this.summaryLog[0];
    }

    const allSummaries = this.summaryLog.join("\n");
    const chatLog = [
      { role: SYSTEM, content: CRITIC_PROMPT },
      { role: USER, content: allSummaries },
    ];

    const fullSummary = await this.promptSummarizer(chatLog);

    this.feedbackChat.push({ role: ASSISTANT, content: fullSummary });

    return fullSummary;
  }

  /**
   * Prompts model for editing based on user feedback and stores
   * the feedback internally for ease of use
   *
   * @param {string} feedback
   *
   * @returns {string}
   */
  async getSummaryEdit(feedback) {
    this.feedbackChat.push({ role: USER, content: feedback });

    const revised = await this.promptSummarizer(this.feedbackChat);

    this.feedbackChat.push({ role: ASSISTANT, content: revised });

    return revised;
  }

  /**
   * Calls the configured summarization model with the given chat log
   * and returns the model's response content.
   *
   * @param {ChatMessage[]} chatLog - The conversation history to send to the model.
   * @returns {Promise<string>} The assistant's reply content from the summarization model.
   */
  async promptSummarizer(chatLog) {
    try {
      const res = await ollama.chat({
        model: SUMMARY_MODEL,
        messages: chatLog,
        think: true,
        stream: false,
      });

      return res.message.content;
    } catch (err) {
      console.error("Could not prompt model due to error:", err);
      return "";
    }
  }

  /**
   * Sends a WAV audio buffer to the Whisper inference server for transcription.
   * Returns the cleaned transcription text, or an empty string if an error occurs.
   *
   * @param {Buffer} buffer - The raw WAV audio buffer to transcribe.
   * @returns {Promise<string>} A promise that resolves to the cleaned transcription text.
   */
  async promptTranscriber(buffer) {
    const audioBlob = new Blob([buffer], {
      type: "audio/wav",
    });

    const formData = new FormData();
    formData.append("file", audioBlob, "voiceStream.wav");

    try {
      const res = await fetch(WHISPER_URL, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const json = await res.json();
        const errorText = json.error;
        throw new Error(`Whisper failed with code ${res.status}: ${errorText}`);
      }

      const result = await res.json();
      return CleanTranscription(result.text);
    } catch (err) {
      console.error(err.message);
      return ""; // returning "" here instead of throwing an error because it may have been a fluke
    }
  }

  /**
   * Puts all the conversations together into one large transcript for attachment
   *
   * @returns {Promise<string>}
   */
  async getTranscript() {
    if (this.sessionTranscript.length === 0) await this.getCriticSummary();

    return this.sessionTranscript;
  }
}
