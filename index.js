import { Client, GatewayIntentBits } from "discord.js";
import {
  COMMAND_LIST,
  ExtractUserId,
  ParseCommands,
  Green,
  DISCORD_TOKEN
} from "./lib/utils.js";
import Handler from "./lib/Handler.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const currentSessions = new Map();

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const mentioned = message.mentions.has(client.user);

  if (!mentioned) return;

  const sessionId = message.guild.id;
  const sessionChannelId = message.channelId;

  const fullCommand = message.content.trim().split(/\s+/);
  const command = fullCommand[1]; // Account for @
  const args = fullCommand.slice(2);

  switch (command) {
    case COMMAND_LIST.start.cmd:
      const playerMap = new Map();
      const trusteeSet = new Set();

      const voiceChannel = message.member?.voice?.channel;
      if (!voiceChannel) {
        await message.reply(
          "You need to be in a voice channel first. Additionally, please only start sessions if you are GM.",
        );
        return;
      }

      // let allowTrolls = false;

      let reply = `Joined ${voiceChannel.name} and listening.`;
      let gmId = message.member.id;

      const { flagsFound, flagArgs } = ParseCommands(
        args,
        COMMAND_LIST.start.flags,
      );

      const targetGm = ExtractUserId(
        (flagArgs[COMMAND_LIST.start.flags.gm] || "")[0],
      );
      const trusteeArgs = flagArgs[COMMAND_LIST.start.flags.trusted] || [];
      const playerArgs = flagArgs[COMMAND_LIST.start.flags.players] || [];

      for (let i = 0; i < trusteeArgs.length; i++) {
        const targetId = ExtractUserId(trusteeArgs[i]);
        if (targetId) {
          const member = await message.guild.members.fetch(targetId);
          if (!member) continue;

          trusteeSet.add(targetId);
        }
      }

      for (let i = 0; i < playerArgs.length; i++) {
        const targetId = ExtractUserId(playerArgs[i]);
        if (targetId) {
          const member = await message.guild.members.fetch(targetId);
          if (!member) continue;

          playerMap.set(targetId, member.displayName);
        }
      }

      if (playerArgs.length === 0) {
        reply +=
          "\n**You are the only person in this adventure.**\n-# If this was a mistake, consider sending `!help`.";
      }

      const gmMember = targetGm
        ? await message.guild.members.fetch(targetGm).catch(() => null)
        : null;
      if (!gmMember) {
        reply +=
          "\n**The `--gm` flag was not understood or not included, so by default you have become the GM**";
      } else {
        gmId = gmMember.id;
      }

      playerMap.set(gmId, "GM");
      trusteeSet.add(gmId);

      console.log(message.content);
      console.log("Players:", playerMap);
      console.log("Trustees:", trusteeSet);

      const sessionData = {
        voiceChannel: voiceChannel,
        channelId: sessionChannelId,
        players: playerMap,
        trustees: trusteeSet,
        sessionId: sessionId,
        gmId: gmId,
      };
      const handler = new Handler(sessionData, client);
      currentSessions.set(sessionId, handler);

      handler.start();

      await message.reply(reply);
      break;
    case COMMAND_LIST.stop.cmd:
      const sessionHandler = currentSessions.get(sessionId);
      if (sessionHandler && sessionHandler.hasTrustee(message.member.id)) {
        await message.reply(
          `I've left the channel and have begun summarizing. ETA is ${Math.floor(Math.random() * 10)} minutes`,
        );
        await sessionHandler.stop();

        setTimeout(
          () => {
            currentSessions.delete(sessionId);
          },
          30 * 60 * 1000,
        );
      }
      break;
    case COMMAND_LIST.pause.cmd:
      const pauseSessionHandler = currentSessions.get(sessionId);
      if (
        pauseSessionHandler &&
        pauseSessionHandler.hasTrustee(message.member.id)
      ) {
        await pauseSessionHandler.pause();
      }
      break;
    case COMMAND_LIST.unpause.cmd:
      const sessionToUnpause = currentSessions.get(sessionId);
      if (sessionToUnpause && sessionToUnpause.hasTrustee(message.member.id)) {
        sessionToUnpause.unpause();
        await message.reply(
          `Joined ${message.member.voice.channel} and listening.`,
        );
      }
      break;
    case COMMAND_LIST.help.cmd:
      let helpMessage = "";
      helpMessage += `\`${COMMAND_LIST.start.cmd}\`: ${COMMAND_LIST.start.desc} \n`;
      helpMessage += `\`${COMMAND_LIST.stop.cmd}\`: ${COMMAND_LIST.stop.desc} \n`;
      helpMessage += `\`${COMMAND_LIST.pause.cmd}\`: ${COMMAND_LIST.pause.desc} \n`;
      helpMessage += `\`${COMMAND_LIST.unpause.cmd}\`: ${COMMAND_LIST.unpause.desc} \n`;
      helpMessage += `\`${COMMAND_LIST.help.cmd}\`: ${COMMAND_LIST.help.desc} \n`;

      await message.reply(helpMessage);
      break;
    default:
      await message.reply(
        "I couldn't understand that. Try typing `!help` to get a list of commands.",
      );
  }
});

client.login(process.env.DISCORD_TOKEN ?? DISCORD_TOKEN);
console.log(Green("Logged in and awaiting vc join"));
