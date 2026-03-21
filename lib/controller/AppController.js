import {
  COLLECTOR_DURATION,
  COMMAND_FLAGS,
  COMMAND_LIST,
} from "@/lib/static/Constants.js";
import { ExtractUserId, ParseCommands } from "@/lib/static/Utils.js";
import SessionController from "@/lib/controller/SessionController.js";

export default class AppController {
  /** @type {import("discord.js").Client | null} */
  client = null;

  /** @type {Map<string, SessionController> | null} */
  sessionManager = null;

  /** @type {Map<string, Map<string, SessionController> | null} */
  sessionCloser = null;

  /**
   * @param {import("discord.js").Client} client
   */
  constructor(client) {
    this.client = client;

    this.sessionManager = new Map();
    this.sessionCloser = new Map();
  }

  /**
   * Handles initial message receive
   */
  async handleMessage(message) {
    try {
      if (message.author.bot) return;

      const mentioned = message.mentions.has(this.client.user.id);
      if (!mentioned) return;

      if (!message.guild) {
        await message.reply("This command only works in a server.");
        return;
      }

      const fullCommand = message.content.trim().split(/\s+/);

      if (ExtractUserId(fullCommand[0]) !== this.client.user.id) {
        message.reply(
          "My @bot needs to be mentioned FIRST before using raw commands. Please try again",
        );
        return;
      }

      const action = fullCommand[1];
      const args = fullCommand.slice(2);

      switch (action) {
        case COMMAND_LIST.start.cmd: {
          await this.handleStart(message, args);
          break;
        }
        case COMMAND_LIST.stop.cmd: {
          await this.handleStop(message);
          break;
        }
        case COMMAND_LIST.pause.cmd: {
          await this.handlePause(message);
          break;
        }
        case COMMAND_LIST.unpause.cmd: {
          await this.handleUnpause(message);
          break;
        }
        case COMMAND_LIST.help.cmd: {
          let helpMessage = "";
          helpMessage += `\`${COMMAND_LIST.start.cmd}\`: ${COMMAND_LIST.start.desc} \n`;
          helpMessage += `\`${COMMAND_LIST.stop.cmd}\`: ${COMMAND_LIST.stop.desc} \n`;
          helpMessage += `\`${COMMAND_LIST.pause.cmd}\`: ${COMMAND_LIST.pause.desc} \n`;
          helpMessage += `\`${COMMAND_LIST.unpause.cmd}\`: ${COMMAND_LIST.unpause.desc} \n`;
          helpMessage += `\`${COMMAND_LIST.help.cmd}\`: ${COMMAND_LIST.help.desc} \n`;

          await message.reply(helpMessage);

          break;
        }
        default: {
          await message.reply(
            "I couldn't understand that. Try sending `@bot help` to get a list of commands.",
          );
        }
      }
    } catch (err) {
      console.error(err);
      await message
        .reply("⚠️ I hit an internal error handling that command.")
        .catch(() => {});
    }
  }

  /**
   * Handles start command from handleMessage()
   *
   * @param {import("discord.js").Message} message
   * @param {string[]} args
   *
   * @returns {Promise<void>}
   */
  async handleStart(message, args) {
    const { flagsFound, flagArgs } = ParseCommands(args, COMMAND_FLAGS);

    let session = this.sessionManager.get(message.guild.id);

    if (session) {
      const isForce = flagsFound.includes(COMMAND_LIST.start.flags.force);
      const sessionPlaying =
        session.getSessionState() === SESSION_STATES.playing ||
        session.getSessionState() === SESSION_STATES.paused;

      if (sessionPlaying) {
        if (!isForce) {
          await message.reply(
            "It looks like there's already a session ongoing. " +
              "If you're a trustee, try sending the `--force` flag.",
          );
          return;
        }

        if (!session.hasTrustee(message.user.id)) {
          await message.reply(
            "I'm sorry Dave, I can't let you do that. You don't appear to be a trustee!",
          );
          return;
        }

        console.log(
          `Session [${session.getId()} stopped]. Piping all content to summarizier`,
        );
        session.stop();

        const closed = this.sessionCloser.get(message.guild.id);
        if (closed) {
          closed.set(session.getId(), session);
        } else {
          this.sessionCloser.set(
            message.guild.id,
            new Map([[session.getId(), session]]),
          );
          console.log(sessionCloser);
        }
      }
    }

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      await message.reply("You must be in a voice channel first!");
      return;
    }

    const textChannel = message.channel;

    let reply = `Joined ${message.member.voice.channel} and listening.`;
    let gmId = message.member.id;

    const players = new Set();
    const nicknames = new Map();
    const trustees = new Set();

    const targetGm = ExtractUserId(flagArgs[COMMAND_LIST.start.flags.gm] || "");
    const trusteeArgs = flagArgs[COMMAND_LIST.start.flags.trusted] || [];
    const playerArgs = flagArgs[COMMAND_LIST.start.flags.players] || [];

    for (const raw of trusteeArgs) {
      const id = ExtractUserId(raw);
      if (id) {
        const member = await message.guild.members.fetch(id).catch(() => null);
        if (member) {
          trustees.add(member.id);
        }
      }
    }
    for (const raw of playerArgs) {
      const id = ExtractUserId(raw);
      if (id) {
        const member = await message.guild.members.fetch(id).catch(() => null);
        if (member) {
          players.add(member.id);
          nicknames.set(member.id, member.displayName);
        }
      }
    }
    if (targetGm) {
      const member = await message.guild.members
        .fetch(targetGm)
        .catch(() => null);
      if (!member) {
        reply +=
          "\n**The `--gm` flag could not be understood, by default you have become the GM**";
      } else {
        gmId = member.id;
      }
    } else {
      reply += "\n**You have been selected as the GM by default**";
    }
    players.add(gmId);
    nicknames.set(gmId, "GM");
    trustees.add(gmId);

    console.log(message.content);
    console.log("Players:", nicknames);
    console.log("Trustees:", trustees);

    session = new SessionController(
      this.client,
      message.guild.id,
      nicknames,
      players,
      trustees,
      voiceChannel,
      textChannel,
    );

    await session.start();

    await message.reply(reply);

    this.sessionManager.set(message.guild.id, session);
    return;
  }

  /**
   * Handles stop command from handleMessage();
   *
   * @param {import("discord.js").Message} message
   *
   * @returns {Promise<void>}
   */
  async handleStop(message) {
    const s = this.sessionManager.get(message.guild.id);
    if (!s) {
      await message.reply(
        "No session is currently running. Try joining a vc and running `@bot start`, or `@bot help` for a list of commands.",
      );
      return;
    }
    if (!message.member || !s.hasTrustee(message.member.id)) return;

    await message.reply(
      `I've left the channel and have begun summarizing. ETA is ${Math.floor(Math.random() * 10)} minutes`,
    );

    console.log(
      `Session [${s.getId()}] stopped. Piping all content to summarizier`,
    );
    await s.stop();

    const c = this.sessionCloser.get(message.guild.id);
    if (c) {
      c.set(s.getId(), s);
    } else {
      this.sessionCloser.set(message.guild.id, new Map([[s.getId(), s]]));
    }

    setTimeout((id = s.getId()) => {
      this.sessionCloser.delete(id);
    }, COLLECTOR_DURATION + 300000);
  }

  /**
   * Handles pause command from handleMessage();
   *
   * @param {import("discord.js").Message} message
   *
   * @returns {Promise<void>}
   */
  async handlePause(message) {
    const s = this.sessionManager.get(message.guild.id);
    await message.reply(
      "No session is currently running. Try joining a vc and running `@bot start`, or `@bot help` for a list of commands.",
    );
    if (!message.member || !s.hasTrustee(message.member.id)) return;

    await s.pause();
  }

  /**
   * Handles unpause command from handleMessage();
   *
   * @param {import("discord.js").Message} message
   *
   * @returns {Promise<void>}
   */
  async handleUnpause(message) {
    const s = this.sessionManager.get(message.guild.id);
    await message.reply(
      "No session is currently running. Try joining a vc and running `@bot start`, or `@bot help` for a list of commands.",
    );
    if (!message.member || !s.hasTrustee(message.member.id)) return;

    await s.unpause();
  }
}
