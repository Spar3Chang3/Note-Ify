import { Client, GatewayIntentBits } from "discord.js";
import {
  COMMAND_LIST,
  ExtractUserId,
  ParseCommands,
  Green,
  DISCORD_TOKEN,
  Red,
  Yellow,
  COLLECTOR_DURATION,
} from "./lib/utils.js";
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

client.on("messageCreate", (message) => {
  void (async () => {
    try {
      if (message.author.bot) return;

      const mentioned = message.mentions.users.has(client.user.id);
      if (!mentioned) return;

      if (!message.guild) {
        await message
          .reply("This command only works in a server.")
          .catch(() =>
            console.log(
              Yellow(
                "Could not reply to an invalid message, please check logs or restart",
              ),
            ),
          );
        return;
      }

      const sessionId = message.guild.id;
      const sessionChannelId = message.channelId;

      const fullCommand = message.content.trim().split(/\s+/);
      const command = fullCommand[1]; // Account for @
      const args = fullCommand.slice(2);

      switch (command) {
        case COMMAND_LIST.start.cmd: {
          const session = currentSessions.get(sessionId);

          if (session) {
            const isForce = args.includes(COMMAND_LIST.start.flags.force);

            if (!isForce) {
              await message
                .reply(
                  "A session is already running in this server. Try sending `--force` with your `start` command. This **WILL** stop my summary collecting on the previous session.",
                )
                .catch(() => {});
              break;
            }

            if (!session.hasTrustee(message.member.id)) {
              await message
                .reply(
                  "A session is already running in this server. You have not been chosen as a trustee to force the bot!",
                )
                .catch(() => {});
              break;
            }

            clearTimeout(session.timeout);
            currentSessions.delete(sessionId);
          }

          const playerMap = new Map();
          const trusteeSet = new Set();

          const voiceChannel = message.member?.voice?.channel;
          if (!voiceChannel) {
            await message.reply(
              "You need to be in a voice channel first. Additionally, please only start sessions if you are GM.",
            );
            break;
          }

          let reply = `Joined ${message.member.voice.channel} and listening.`;
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

          const idsToFetch = new Set();

          for (const raw of trusteeArgs) {
            const id = ExtractUserId(raw);
            if (id) idsToFetch.add(id);
          }
          for (const raw of playerArgs) {
            const id = ExtractUserId(raw);
            if (id) idsToFetch.add(id);
          }
          if (targetGm) idsToFetch.add(targetGm);

          const fetchedMembers = new Map();
          for (const id of idsToFetch) {
            const member = await message.guild.members
              .fetch(id)
              .catch(() => null);
            if (member) fetchedMembers.set(id, member);
          }

          // I don't like this solution
          // I'm calling ExtractUserId() way more than I need to
          // TODO: implement separate arrays and push them all to playerMap

          for (const raw of trusteeArgs) {
            const id = ExtractUserId(raw);
            if (id && fetchedMembers.has(id)) trusteeSet.add(id);
          }
          for (const raw of playerArgs) {
            const id = ExtractUserId(raw);
            const member = id ? fetchedMembers.get(id) : null;
            if (id && member) playerMap.set(id, member.displayName);
          }

          if (playerArgs.length === 0) {
            reply +=
              "\n**You are the only person in this adventure.**\n-# If this was a mistake, consider sending `!help`.";
          }
          if (flagsFound.includes(COMMAND_LIST.start.flags.gm)) {
            const gmMember = targetGm ? fetchedMembers.get(targetGm) : null;

            if (!gmMember) {
              reply +=
                "\n**The `--gm` flag could not be understood, by default you have become the GM**";
            } else {
              gmId = gmMember.id;
            }
          } else {
            reply += "\n**You have been selected as the GM by default**";
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
          let handler;
          try {
            handler = new Handler(sessionData, client);
          } catch (err) {
            console.error(Red("Failed to construct Handler:"), err);
            await message
              .reply(
                "⚠️ I couldn't start the session due to an internal error.",
              )
              .catch(() => {});
            break;
          }
          currentSessions.set(sessionId, handler);

          try {
            await handler.start();
          } catch (err) {
            console.error(Red("Failed to start Handler:"), err);
            currentSessions.delete(sessionId);
            await message
              .reply("⚠️ I failed to connect to voice.")
              .catch(() => {});
            break;
          }

          await message.reply(reply).catch(() => {});
          break;
        }
        case COMMAND_LIST.stop.cmd: {
          const h = currentSessions.get(sessionId);
          if (!h) {
            await message
              .reply(
                "No session is currently running. Try joining a vc and running `@bot start`, or `@bot help` for a list of commands.",
              )
              .catch(() => {});
            break;
          }
          if (!message.member || !h.hasTrustee(message.member.id)) break;
          await message
            .reply(
              `I've left the channel and have begun summarizing. ETA is ${Math.floor(Math.random() * 10)} minutes`,
            )
            .catch(() => {});
          try {
            await h.stop();
          } catch (err) {
            console.error(Red("stop() failed:"), err);
            await message
              .reply(
                "⚠️ Stop failed partway through. Check logs; I may have still posted partial output.",
              )
              .catch(() => {});
          } finally {
            h.timeout = setTimeout(() => {
              currentSessions.delete(sessionId);
            }, COLLECTOR_DURATION);
          }
          break;
        }
        case COMMAND_LIST.pause.cmd: {
          const h = currentSessions.get(sessionId);
          if (!h) {
            await message
              .reply(
                "No session is currently running. Try joining a vc and running `@bot start`, or `@bot help` for a list of commands.",
              )
              .catch(() => {});
            break;
          }
          if (!message.member || !h.hasTrustee(message.member.id)) break;

          try {
            await h.pause();
          } catch (err) {
            console.error(Red("pause() failed:"), err);
            await message.reply("⚠️ Pause failed.").catch(() => {});
          }
          break;
        }
        case COMMAND_LIST.unpause.cmd: {
          const h = currentSessions.get(sessionId);
          if (!h) {
            await message
              .reply(
                "No session is currently running. Try joining a vc and running `@bot start`, or `@bot help` for a list of commands.",
              )
              .catch(() => {});
            break;
          }
          if (!message.member || !h.hasTrustee(message.member.id)) break;

          try {
            await h.unpause();
            await message
              .reply(`Joined ${message.member.voice.channel} and listening.`)
              .catch(() => {});
          } catch (err) {
            console.error(Red(`unapuse() failed:`), err);
            await message.reply("⚠️ Unpause failed.").catch(() => {});
          }
          break;
        }
        case COMMAND_LIST.help.cmd: {
          let helpMessage = "";
          helpMessage += `\`${COMMAND_LIST.start.cmd}\`: ${COMMAND_LIST.start.desc} \n`;
          helpMessage += `\`${COMMAND_LIST.stop.cmd}\`: ${COMMAND_LIST.stop.desc} \n`;
          helpMessage += `\`${COMMAND_LIST.pause.cmd}\`: ${COMMAND_LIST.pause.desc} \n`;
          helpMessage += `\`${COMMAND_LIST.unpause.cmd}\`: ${COMMAND_LIST.unpause.desc} \n`;
          helpMessage += `\`${COMMAND_LIST.help.cmd}\`: ${COMMAND_LIST.help.desc} \n`;

          await message.reply(helpMessage).catch(() => {
            console.log(
              Yellow(
                "Could not post help when asked, please check logs or restart",
              ),
            );
          });
          break;
        }
        default: {
          await message
            .reply(
              "I couldn't understand that. Try sending `@bot help` to get a list of commands.",
            )
            .catch(() => {
              console.log(
                Yellow(
                  "Could not reply to a confusing command, please check logs or restart",
                ),
              );
            });
        }
      }
    } catch (err) {
      console.error("Error in messageCreate handler:", err);
      try {
        await message.reply(
          "⚠️ I hit an internal error handling that command.",
        );
      } catch {}
    }
  })();
});

console.log("Running on:", DetectPlatform());

client
  .login(process.env.DISCORD_TOKEN ?? DISCORD_TOKEN)
  .then(() => console.log(Green("Logged in and awaiting vc join")))
  .catch((err) => console.error(Red("Failed to login:"), err));
