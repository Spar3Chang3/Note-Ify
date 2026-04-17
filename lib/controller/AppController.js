import {
  COLLECTOR_DURATION,
  COMMAND_FLAGS,
  COMMAND_LIST,
  SESSION_STATES,
} from "@/lib/static/Constants.js";
import { ExtractUserId, ParseCommands } from "@/lib/static/Utils.js";
import SessionController from "@/lib/controller/SessionController.js";

export default class AppController {
  /** @type {import("discord.js").Client | null} */
  client = null;

  /** @type {Map<string, SessionController> | null} */
  sessionManager = null;

  /** @type {Map<string, Map<string, SessionController>> | null} */
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
          await this.handleChatStart(message, args);
          break;
        }
        case COMMAND_LIST.stop.cmd: {
          await this.handleChatStop(message);
          break;
        }
        case COMMAND_LIST.pause.cmd: {
          await this.handleChatPause(message);
          break;
        }
        case COMMAND_LIST.unpause.cmd: {
          await this.handleChatUnpause(message);
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
   * Handles slash commands (Ready for implementation, not actively used yet)
   *
   * @param {import("discord.js").ChatInputCommandInteraction} interaction
   *
   * @returns {Promise<void>}
   */
  async handleSlashCommand(interaction) {
    if (!interaction.isChatInputCommand()) return;

    try {
      const commandName = interaction.commandName;

      switch (commandName) {
        case COMMAND_LIST.start.cmd: {
          await this.handleSlashStart(interaction);
          break;
        }
        case COMMAND_LIST.stop.cmd: {
          await this.handleSlashStop(interaction);
          break;
        }
        case COMMAND_LIST.pause.cmd: {
          await this.handleSlashPause(interaction);
          break;
        }
        case COMMAND_LIST.unpause.cmd: {
          await this.handleSlashUnpause(interaction);
          break;
        }
        case COMMAND_LIST.help.cmd: {
          let helpMessage = "";
          helpMessage += `\`/${COMMAND_LIST.start.cmd}\`: ${COMMAND_LIST.start.desc} \n`;
          helpMessage += `\`/${COMMAND_LIST.stop.cmd}\`: ${COMMAND_LIST.stop.desc} \n`;
          helpMessage += `\`/${COMMAND_LIST.pause.cmd}\`: ${COMMAND_LIST.pause.desc} \n`;
          helpMessage += `\`/${COMMAND_LIST.unpause.cmd}\`: ${COMMAND_LIST.unpause.desc} \n`;
          helpMessage += `\`/${COMMAND_LIST.help.cmd}\`: ${COMMAND_LIST.help.desc} \n`;

          await interaction.reply({ content: helpMessage, ephemeral: true });
          break;
        }
        default: {
          await interaction.reply({ content: "Unknown command.", ephemeral: true });
        }
      }
    } catch (err) {
      console.error(err);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: "⚠️ I hit an internal error handling that slash command.", ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: "⚠️ I hit an internal error handling that slash command.", ephemeral: true }).catch(() => {});
      }
    }
  }

  // ==========================================
  // COMMAND WRAPPERS
  // ==========================================

  async handleChatStart(message, args) {
    const { flagsFound, flagArgs } = ParseCommands(args, COMMAND_FLAGS.start);

    const force = flagsFound.includes(COMMAND_LIST.start.flags.force);
    const targetGmId = ExtractUserId(flagArgs[COMMAND_LIST.start.flags.gm]?.[0] || "");
    const trusteeArgs = flagArgs[COMMAND_LIST.start.flags.trusted] || [];
    const playerArgs = flagArgs[COMMAND_LIST.start.flags.players] || [];

    await this.coreHandleStart(
      message.guild,
      message.member,
      message.member?.voice?.channel,
      message.channel,
      { targetGmId, trusteeArgs, playerArgs, force },
      async (text) => await message.reply(text)
    );
  }

  async handleSlashStart(interaction) {
    await interaction.deferReply();

    const gmUser = interaction.options.getUser("gm");
    const playersString = interaction.options.getString("players") || "";
    const trusteesString = interaction.options.getString("trustees") || "";
    const force = interaction.options.getBoolean("force") || false;

    const playersArray = playersString.split(/\s+/).filter(Boolean);
    const trusteesArray = trusteesString.split(/\s+/).filter(Boolean);
    const targetGmId = gmUser ? gmUser.id : "";

    await this.coreHandleStart(
      interaction.guild,
      interaction.member,
      interaction.member?.voice?.channel,
      interaction.channel,
      { targetGmId, trusteeArgs: trusteesArray, playerArgs: playersArray, force },
      async (text) => await interaction.editReply(text)
    );
  }

  async handleChatStop(message) {
    await this.coreHandleStop(
      message.guild,
      message.member,
      async (text) => await message.reply(text)
    );
  }

  async handleSlashStop(interaction) {
    await this.coreHandleStop(
      interaction.guild,
      interaction.member,
      async (text) => await interaction.reply({ content: text, ephemeral: true })
    );
  }

  async handleChatPause(message) {
    await this.coreHandlePause(
      message.guild,
      message.member,
      async (text) => await message.reply(text)
    );
  }

  async handleSlashPause(interaction) {
    await this.coreHandlePause(
      interaction.guild,
      interaction.member,
      async (text) => await interaction.reply({ content: text, ephemeral: true })
    );
  }

  async handleChatUnpause(message) {
    await this.coreHandleUnpause(
      message.guild,
      message.member,
      message.member?.voice?.channel,
      async (text) => await message.reply(text)
    );
  }

  async handleSlashUnpause(interaction) {
    await this.coreHandleUnpause(
      interaction.guild,
      interaction.member,
      interaction.member?.voice?.channel,
      async (text) => await interaction.reply({ content: text, ephemeral: true })
    );
  }

  // ==========================================
  // CORE BUSINESS LOGIC
  // ==========================================

  /**
   * Core logic for starting a session
   */
  async coreHandleStart(guild, member, voiceChannel, textChannel, options, reply) {
    const { targetGmId, trusteeArgs, playerArgs, force } = options;

    let session = this.sessionManager.get(guild.id);

    if (session) {
      const sessionPlaying =
        session.getSessionState() === SESSION_STATES.playing ||
        session.getSessionState() === SESSION_STATES.paused;

      if (sessionPlaying) {
        if (!force) {
          return await reply(
            "It looks like there's already a session ongoing. " +
              "If you're a trustee, try using the force option."
          );
        }

        if (!session.hasTrustee(member.id)) {
          return await reply(
            "I'm sorry Dave, I can't let you do that. You don't appear to be a trustee!"
          );
        }

        session.stop();

        const closed = this.sessionCloser.get(guild.id);
        if (closed) {
          closed.set(session.getId(), session);
        } else {
          this.sessionCloser.set(
            guild.id,
            new Map([[session.getId(), session]])
          );
        }
      }
    }

    if (!voiceChannel) {
      return await reply("You must be in a voice channel first!");
    }

    let replyMsg = `Joined ${voiceChannel} and listening.`;
    let gmId = member.id;

    const players = new Set();
    const nicknames = new Map();
    const trustees = new Set();

    for (const raw of trusteeArgs) {
      const id = ExtractUserId(raw);
      if (id) {
        const fetchMember = await guild.members.fetch(id).catch(() => null);
        if (fetchMember) {
          trustees.add(fetchMember.id);
        }
      }
    }
    for (const raw of playerArgs) {
      const id = ExtractUserId(raw);
      if (id) {
        const fetchMember = await guild.members.fetch(id).catch(() => null);
        if (fetchMember) {
          players.add(fetchMember.id);
          nicknames.set(fetchMember.id, fetchMember.displayName);
        }
      }
    }

    if (targetGmId) {
      const fetchMember = await guild.members.fetch(targetGmId).catch(() => null);
      if (!fetchMember) {
        replyMsg +=
          "\n**The GM user could not be found, by default you have become the GM**";
      } else {
        gmId = fetchMember.id;
      }
    } else {
      replyMsg += "\n**You have been selected as the GM by default**";
    }

    if (playerArgs.length === 0) {
      replyMsg +=
        "\n**You are the only person in this adventure.**\n-# If this was a mistake, consider sending the help command.";
    }

    players.add(gmId);
    nicknames.set(gmId, "GM");
    trustees.add(gmId);

    console.log(`[Start] Triggered by ${member.user.tag}`);
    console.log("Players:", nicknames);
    console.log("Trustees:", trustees);

    session = new SessionController(
      this.client,
      guild.id,
      nicknames,
      players,
      trustees,
      voiceChannel,
      textChannel
    );

    await session.start();
    await reply(replyMsg);

    this.sessionManager.set(guild.id, session);
  }

  /**
   * Core logic for stopping a session
   */
  async coreHandleStop(guild, member, reply) {
    const s = this.sessionManager.get(guild.id);
    if (!s) {
      return await reply(
        "No session is currently running. Try joining a vc and starting one, or check help for a list of commands."
      );
    }
    if (!member || !s.hasTrustee(member.id)) {
      // In the old text version, it just quietly returned if not a trustee, 
      // but replying uniformly is better UX for both slash and text commands.
      return await reply("You do not have permission to stop this session.");
    }

    await reply(
      `I've left the channel and have begun summarizing. ETA is roughly ${s.getETA()} minute(s)`
    );

    await s.stop();

    const c = this.sessionCloser.get(guild.id);
    if (c) {
      c.set(s.getId(), s);
    } else {
      this.sessionCloser.set(guild.id, new Map([[s.getId(), s]]));
    }

    setTimeout((id = s.getId()) => {
      const guildClosed = this.sessionCloser.get(guild.id);
      if (guildClosed) {
        guildClosed.delete(id);
        if (guildClosed.size === 0) {
          this.sessionCloser.delete(guild.id);
        }
      }
    }, COLLECTOR_DURATION + 300000);
  }

  /**
   * Core logic for pausing a session
   */
  async coreHandlePause(guild, member, reply) {
    const s = this.sessionManager.get(guild.id);
    if (!s) {
      return await reply(
        "No session is currently running. Try joining a vc and starting one, or check help for a list of commands."
      );
    }
    if (!member || !s.hasTrustee(member.id)) {
      return await reply("You do not have permission to pause this session.");
    }

    await s.pause();
    await reply(
      "I've left the call while you guys take a break. Just send the unpause command whenever you're ready to resume playing!"
    );
  }

  /**
   * Core logic for unpausing a session
   */
  async coreHandleUnpause(guild, member, voiceChannel, reply) {
    const s = this.sessionManager.get(guild.id);
    if (!s) {
      return await reply(
        "No session is currently running. Try joining a vc and starting one, or check help for a list of commands."
      );
    }
    if (!member || !s.hasTrustee(member.id)) {
      return await reply("You do not have permission to unpause this session.");
    }

    if (!voiceChannel) {
      return await reply("You must be in a voice channel first!");
    }

    await s.unpause();
    await reply(`Rejoined ${voiceChannel} and listening.`);
  }
}