import { Client, GatewayIntentBits } from "discord.js";
import AppController from "@/lib/controller/AppController.js";
import {
  DISCORD_TOKEN,
  WHISPER_URL,
  WHISPER_MODEL,
  SUMMARY_MODEL,
  SUMMARY_PROMPT,
  CRITIC_PROMPT,
  FEEDBACK_PROMPT,
  COLLECTOR_DURATION,
  MAX_TOKEN_LIMIT,
  LOGIN_ASCII_ART,
  ERR_ASCII_ART,
} from "@/lib/static/Constants.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

/** @type {AppController} */
const controller = new AppController(client);

client.on("messageCreate", async (message) => {
  controller.handleMessage(message);
});

client
  .login(process.env.DISCORD_TOKEN ?? DISCORD_TOKEN)
  .then(() => {
    console.log(`${LOGIN_ASCII_ART}\nLogged in and awaiting vc to join`);
    printValues();
  })
  .catch((err) => console.error(`${ERR_ASCII_ART}\n`, err));

function printValues() {
  console.log("Whisper URL:", WHISPER_URL);
  console.log("Whisper Model:", WHISPER_MODEL);
  console.log("Summary Model:", SUMMARY_MODEL);
  console.log("Collector Duration:", COLLECTOR_DURATION);
  console.log("Max Token Limit:", MAX_TOKEN_LIMIT);
}
