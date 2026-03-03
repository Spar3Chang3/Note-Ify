import { Client, GatewayIntentBits } from "discord.js";
import {
  COMMAND_LIST,
  ExtractUserId,
  Red,
  Yellow,
  Green,
  BuildTranscript,
} from "./utils.js";
import Handler from "./Handler.js";

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

  const mentioned = client.mentions.has(client.user);

  if (!mentioned) return;

  const sessionId = message.guild.id;
  const sessionChannelId = message.channelId;

  const fullCommand = message.content.trim().split(/\s+/);
  const command = fullCommand[1]; // Account for @
  const args = fullCommand.slice(2);

  switch (command) {
    case COMMAND_LIST.start.cmd:
      const playerMap = new Map();
      const voiceChannel = message.member?.voice?.channel;
      if (!voiceChannel) {
        await message.reply(
          "You need to be in a voice channel first. Additionally, please only start sessions if you are GM.",
        );
        return;
      }

      let allowTrolls = false;

      let reply = `Joined ${voiceChannel.name} and listening.`;

      for (let i = 0; i < args?.length; i++) {
        if (args[i] === COMMAND_LIST.start.optFlag) {
          allowTrolls = true;
          reply +=
            "\n**You have sent `--allow-trolls`. This means anybody can control your session!**\n";
          continue;
        }
        // ^^^ Known bug: you could pass "--allow-trolls" and it would always append that reply over and over. But, it's kinda funny, so, *shrugs*

        const targetId = ExtractUserId(args[i]);
        if (targetId) {
          const member = await message.guild.members.fetch(targetId);
          if (!member) continue;

          playerMap.set(targetId, member.displayName);
        }
      }
      playerMap.set(message.member.id, "GM");

      if (args.length === 0) {
        reply +=
          "\n**You are the only person in this adventure.**\n-# If this was a mistake, consider sending `!help`.";
      }

      console.log(message.content);
      console.log(playerMap);

      const sessionData = {
        voiceChannel: voiceChannel,
        channelId: sessionChannelId,
        players: playerMap,
        sessionId: sessionId,
        gmId: message.member.id,
        allowTrolls: allowTrolls,
      };
      const handler = new Handler(sessionData, client);
      currentSessions.set(sessionId, handler);

      handler.start();

      await message.reply(reply);
      break;
    case COMMAND_LIST.stop.cmd:
      const sessionHandler = currentSessions.get(sessionId);
      if (
        sessionHandler &&
        (sessionHandler.allowTrolls ||
          message.member.id === sessionHandler.gmId)
      ) {
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
        (pauseSessionHandler.allowTrolls ||
          message.member.id === pauseSessionHandler.gmId)
      ) {
        await pauseSessionHandler.pause();
      }
      break;
    case COMMAND_LIST.unpause.cmd:
      const sessionToUnpause = currentSessions.get(sessionId);
      if (
        sessionToUnpause &&
        (sessionToUnpause.allowTrolls ||
          message.member.id === sessionToUnpause.gmId)
      ) {
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

client.login(process.env.DISCORD_TOKEN);
console.log(Green("Logged in and awaiting vc join"));
