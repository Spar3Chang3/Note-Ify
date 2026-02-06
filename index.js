import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel,
  EndBehaviorType,
  getVoiceConnection,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import prism from "prism-media";
import ollama from "ollama";
import {
  SYSTEM,
  USER,
  ASSISTANT,
  WHISPER_URL,
  SUMMARY_MODEL,
  INITIAL_PROMPT,
  REPLY_PROMPT,
  SILENCE_DURATION,
  FFMPEG_WAV_ARGS,
  MAX_TOKEN_LIMIT,
  COMMAND_LIST,
  TranscriptionQueue,
  TranscriptionWorking,
  EnqueueTranscription,
  DequeueTranscription,
  SetTranscriptionWorking,
  CleanTranscription,
  EstimateTokens,
  ExtractUserId,
  Red,
  Yellow,
  Green,
} from "./utils.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const currentSessions = new Map();
const allSessionsMembers = new Map();
const activeVoiceStreams = new Map();

function getVcMembers(channel, sessionId) {
  channel.members.forEach((member) => {
    allSessionsMembers.set(member.id, {
      nickname: member.displayName,
      sessionId: sessionId,
    });
  });
}

function startVoiceReceiver(connection) {
  const receiver = connection.receiver;

  receiver.speaking.on("start", (userId) => {
    if (activeVoiceStreams.has(userId)) return;

    const member = allSessionsMembers.get(userId);
    if (!member) return;

    activeVoiceStreams.set(userId, true);

    const startedAt = Date.now();
    console.log(`User [${userId}] started speaking...`);

    createVoiceListeningStream(receiver, userId, (streamMeta) => {
      EnqueueTranscription({
        userId: userId,
        sessionId: member.sessionId,
        startedAt: startedAt,
        endedAt: streamMeta.endedAt,
        wavBuffer: streamMeta.wavBuffer,
      });
      DequeueTranscription(handleUserWavBuffer);
    });
  });
}

function createVoiceListeningStream(receiver, userId, onComplete) {
  const opusStream = receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: SILENCE_DURATION,
    },
  });
  const decoder = new prism.opus.Decoder({
    channels: 2,
    rate: 48000,
  });
  const ffmpeg = new prism.FFmpeg({
    args: FFMPEG_WAV_ARGS,
  });

  const wavChunks = [];

  ffmpeg.on("data", (chunk) => {
    wavChunks.push(chunk);
  });

  ffmpeg.on("end", () => {
    const buffer = Buffer.concat(wavChunks);
    console.log(
      Green(
        `Finished processing <${buffer.length}> bytes of WAV audio for user [${userId}]`,
      ),
    );

    if (activeVoiceStreams.has(userId)) {
      activeVoiceStreams.delete(userId);
    }

    if (buffer.length > 0) {
      onComplete({
        endedAt: Date.now() - SILENCE_DURATION,
        wavBuffer: buffer,
      });
    }
  });

  opusStream.pipe(decoder).pipe(ffmpeg);

  const errorHandler = (err, source) => {
    console.error(`Error in "${source}" for [${userId}]:`, err);
    if (activeVoiceStreams.has(userId)) {
      activeVoiceStreams.delete(userId);
    }
    opusStream.destroy();
  };

  opusStream.on("error", (err) => errorHandler(err, "OpusStream"));
  decoder.on("error", (err) => errorHandler(err, "Decoder"));
  ffmpeg.on("error", (err) => errorHandler(err, "FFmpeg"));
}

async function handleUserWavBuffer(transcriptionJob) {
  const audioBlob = new Blob([transcriptionJob.wavBuffer], {
    type: "audio/wav",
  });

  const formData = new FormData();
  formData.append("file", audioBlob, "voiceStream.wav");
  formData.append("temperature", "0.0");
  formData.append("temperature_inc", "0.2");
  formData.append("response_format", "json");

  try {
    const res = await fetch(WHISPER_URL, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const json = await res.json();
      const errorText = json.error;
      throw new Error(
        Red(`Whisper failed with code ${res.status}: ${errorText}`),
      );
    }

    const result = await res.json();
    const text = CleanTranscription(result.text);
    if (text.length > 0) {
      const member = allSessionsMembers.get(transcriptionJob.userId);
      const content = `<${member.nickname}>${text}</${member.nickname}`;

      const session = currentSessions.get(member.sessionId);
      session.chatLog.push({
        role: USER,
        content: content,
      });

      session.tokenCount = session.tokenCount + EstimateTokens(content);

      if (session.tokenCount >= MAX_TOKEN_LIMIT * 0.75) {
        await client.channels.cache
          .get(session.channelId)
          ?.send(
            "## Warning!!! \n Summarizing token maximum is 75% full! Due to memory constraints and that <311952559755493378> is a lazy bitch, I will soon forcefully disconnect to summarize the current game state. \n You can mitigate this by taking a break and telling me to `!pause-session`!",
          );
      } else if (session.tokenCount >= MAX_TOKEN_LIMIT * 0.8) {
        //TODO: implement this lol
      }
    }
  } catch (err) {
    console.error(
      Red(`Error connecting to whisper server or replying on discord: ${err}`),
    );
  }
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  let command = "";
  let args = [];
  let players = [];
  let start = null;
  const sessionGmId = message.member.id;
  const sessionChannelId = message.channelId;

  if (message.content[0] === "!") {
    const fullCommand = message.content.split(" ");

    command = fullCommand[0];

    args = fullCommand.slice(1);
  } else return;

  switch (command) {
    case COMMAND_LIST.start.cmd:
      const voiceChannel = message.member?.voice?.channel;
      if (!voiceChannel) {
        await message.reply(
          "You need to be in a voice channel first. Additionally, please only start sessions if you are GM.",
        );
        return;
      }

      for (let i = 0; i < args.length; i++) {
        const targetId = ExtractUserId(args[i]);
        if (targetId) {
          const member = await message.guild.members.fetch(targetId);
          if (!member) continue;

          allSessionsMembers.set(targetId, {
            nickname: member.displayName,
            sessionId: sessionGmId,
          });

          players.push(targetId);
        }
      }
      allSessionsMembers.set(sessionGmId, {
        nickname: "GM",
        sessionId: sessionGmId,
      });

      console.log(message.content);
      console.log(allSessionsMembers);

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: true,
      });

      connection.on(VoiceConnectionStatus.Ready, () => {
        console.log(
          Green(
            `Voice connected for channel [${voiceChannel.id}], starting receiver.`,
          ),
        );
        start = Date.now();
        startVoiceReceiver(connection);
      });

      currentSessions.set(sessionGmId, {
        connection: connection,
        channelId: sessionChannelId,
        tokenCount: 0,
        startTime: start,
        players: players,
        chatLog: [{ role: SYSTEM, content: INITIAL_PROMPT }],
      });

      await message.reply(`Joined ${voiceChannel.name} and listening.`);
      break;
    case COMMAND_LIST.stop.cmd:
      const session = currentSessions.get(message.member.id);
      if (session) {
        session.connection.destroy();

        while (TranscriptionWorking || TranscriptionQueue.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        console.log(
          Yellow(
            `Session [${message.member.id}] stopped. Piping all content to summarizing LLM`,
          ),
        );

        const channel = client.channels.cache.get(session.channelId);
        await channel.sendTyping();

        const summaryRes = await ollama.chat({
          model: SUMMARY_MODEL,
          messages: session.chatLog,
          stream: false,
        });

        const markdownSummary = summaryRes.message.content;
        const summaryMessage = await channel?.send(markdownSummary);
        console.log(
          Green(
            `Summary finished. Sending to channel [${session.channelId}] and awaiting summary change prompting.`,
          ),
        );

        if (summaryMessage) {
          const thread = await summaryMessage.startThread({
            name: `Session Summary Discussion - ${new Date().toLocaleDateString()}`,
            autoArchiveDuration: 1440,
            reason: `Post session discussion for ${message.member.id}`,
          });

          console.log(
            Green(
              `Thread [${thread.name}] created. Updating assistant prompt.`,
            ),
          );

          session.chatLog.push({
            role: ASSISTANT,
            content: markdownSummary,
          });
          session.chatLog.push({
            role: SYSTEM,
            content: REPLY_PROMPT,
          });

          await thread.send(
            "You now have 30 minutes to reply and update the summary here. I will only listen to the GM, in fact I will listen to EVERYTHING the GM says, so no fluff.",
          );

          const collector = thread.createMessageCollector({
            filter: (m) => !m.author.bot && m.author.id === message.member.id,
            time: 30 * 60 * 1000,
          });

          collector.on("collect", async (feedbackMessage) => {
            await feedbackMessage.react("🔄");
            await thread.sendTyping();

            session.chatLog.push({
              role: USER,
              content: feedbackMessage.content,
            });
            console.log(Yellow(`User asked: ${feedbackMessage.content}`));

            const revise = await ollama.chat({
              model: SUMMARY_MODEL,
              messages: session.chatLog,
              stream: false,
            });

            const reviseMessage = revise.message.content;

            session.chatLog.push({
              role: ASSISTANT,
              content: reviseMessage,
            });

            await thread.send(reviseMessage);
          });

          collector.on("end", () => {
            thread.send(
              "Summary editing by me has been locked! You now gotta do it yourself",
            );
          });
        }

        setTimeout(
          () => {
            for (const [userId, memberData] of allSessionsMembers) {
              if (memberData.sessionId === message.member.id) {
                allSessionsMembers.delete(userId);
              }
            }

            currentSessions.delete(message.member.id);
          },
          30 * 60 * 1000,
        );
      } else return;
      break;
    case COMMAND_LIST.pause.cmd:
      const sessionToPause = currentSessions.get(message.member.id);
      if (sessionToPause) {
        sessionToPause.connection.destroy();

        while (TranscriptionWorking || TranscriptionQueue.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        console.log(
          Yellow(
            `Session [${message.member.id}] paused. Piping all content to summarizing LLM`,
          ),
        );

        const channel = client.channels.cache.get(sessionToPause.channelId);
        await channel.sendTyping();

        const summaryRes = await ollama.chat({
          model: SUMMARY_MODEL,
          messages: sessionToPause.chatLog,
          stream: false,
        });

        const markdownSummary = summaryRes.message.content;

        sessionToPause.chatLog = [];
        sessionToPause.chatLog.push({
          role: SYSTEM,
          content: INITIAL_PROMPT,
        });
        sessionToPause.chatLog.push({
          role: ASSISTANT,
          content: markdownSummary,
        });

        for (const [userId, memberData] of allSessionsMembers) {
          if (memberData.sessionId === message.member.id) {
            allSessionsMembers.delete(userId);
          }
        }

        await message.reply(
          "Summarized the current game state and ready to unpause!",
        );
      } else return;
      break;
    case COMMAND_LIST.unpause.cmd:
      const sessionToUnpause = currentSessions.get(message.member.id);
      const unpauseVoiceChannel = message.member?.voice?.channel;
      if (sessionToUnpause && unpauseVoiceChannel) {
        for (let i = 0; i < sessionToUnpause.players.length; i++) {
          const member = await message.guild.members.fetch(
            sessionToUnpause.players[i],
          );
          if (!member) continue;

          allSessionsMembers.set(member.id, {
            nickname: member.displayName,
            sessionId: message.member.id,
          });
          if (activeVoiceStreams.has(sessionToUnpause.players[i])) {
            activeVoiceStreams.delete(sessionToUnpause.players[i]);
          }
        }
        allSessionsMembers.set(message.member.id, {
          nickname: "GM",
          sessionId: message.member.id,
        });
        if (activeVoiceStreams.has(message.member.id)) {
          activeVoiceStreams.delete(message.member.id);
        }

        const newConnection = joinVoiceChannel({
          channelId: unpauseVoiceChannel.id,
          guildId: unpauseVoiceChannel.guild.id,
          adapterCreator: unpauseVoiceChannel.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: true,
        });

        newConnection.on(VoiceConnectionStatus.Ready, () => {
          console.log(
            Green(
              `Voice connected for channel [${unpauseVoiceChannel.id}], starting receiver.`,
            ),
          );
          start = Date.now();
          startVoiceReceiver(newConnection);
        });

        sessionToUnpause.connection = newConnection;

        await message.reply(
          `Joined ${unpauseVoiceChannel.name} and listening.`,
        );
      } else return;
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
