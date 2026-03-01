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

  let command = "";
  let args = [];
  const sessionGmId = message.member.id;
  const sessionChannelId = message.channelId;

  if (message.content[0] === "!") {
    const fullCommand = message.content.split(" ");

    command = fullCommand[0];

    args = fullCommand.slice(1);
  } else return;

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

      let reply = `Joined ${voiceChannel.name} and listening.`;
      for (let i = 0; i < args.length; i++) {
        const targetId = ExtractUserId(args[i]);
        if (targetId) {
          const member = await message.guild.members.fetch(targetId);
          if (!member) continue;

          playerMap.set(targetId, member.displayName);
        }
      }
      playerMap.set(sessionGmId, "GM");

      if (args.length === 0) {
        reply =
          "# YOU ARE ALL ALONE\n## You might want to send `!help` to see how commands work\n" +
          reply;
      }

      console.log(message.content);
      console.log(playerMap);

      const sessionData = {
        voiceChannel: voiceChannel,
        channelId: sessionChannelId,
        players: playerMap,
        sessionId: sessionGmId,
      };
      const handler = new Handler(sessionData, client);
      currentSessions.set(sessionGmId, handler);

      handler.start();

      await message.reply(reply);
      break;
    case COMMAND_LIST.stop.cmd:
      const sessionHandler = currentSessions.get(sessionGmId);
      if (sessionHandler) {
        await sessionHandler.stop();

        setTimeout(
          () => {
            currentSessions.delete(sessionGmId);
          },
          30 * 60 * 1000,
        );
      }
      break;
    case COMMAND_LIST.pause.cmd:
      const pauseSessionHandler = currentSessions.get(sessionGmId);
      if (pauseSessionHandler) {
        await pauseSessionHandler.pause();
      }
      break;
    case COMMAND_LIST.unpause.cmd:
      const sessionToUnpause = currentSessions.get(sessionGmId);
      if (sessionToUnpause) {
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
