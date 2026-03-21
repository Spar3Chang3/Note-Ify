import ModelHandler from "@/lib/session/ModelHandler.js";

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

export default class QueueHandler {
  /** @type {boolean} */
  working = false;

  /** @type {{ start: string, end: string, userId: string, buffer: Buffer }[] | []} */
  queue = [];

  /** @type {ModelHandler | null} */
  modelHandler = null;

  /**
   * @param {ModelHandler} modelHandler
   * @requires ModelHandler
   */
  constructor(modelHandler) {
    this.modelHandler = modelHandler;
  }

  /**
   * Enqueues a new audio transcription job and starts the worker
   * if it is currently idle.
   *
   * @param {Job} job - The transcription job to enqueue.
   * @returns {Promise<void>}
   */
  async enqueue(job) {
    this.queue.push(job);

    if (!this.working) this.dequeue();
  }

  /**
   * Dequeues and uses ModelHandler to process transcription jobs one-by-one.
   * Automatically continues.
   *
   * @returns {Promise<void>}
   */
  async dequeue() {
    if (this.working || this.queue.length === 0) return;

    const job = this.queue.shift();
    if (!job) return;

    this.working = true;

    try {
      await this.modelHandler.addTranscription(job);
    } catch (err) {
      console.err(err);
    } finally {
      this.working = false;

      this.dequeue();
    }
  }

  /**
   * Waits for everything in queue to finsh.
   * Obviously this assumes ModelHandler is not null
   *
   * @returns {Promise<void>}
   */
  async finishTranscriptionQueue() {
    while (this.working || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
