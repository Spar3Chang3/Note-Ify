import { Client, GatewayIntentBits } from "discord.js";
import AppController from "@/lib/controller/AppController.js";
import {
  DISCORD_TOKEN,
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
  .then(() =>
    console.log(`${LOGIN_ASCII_ART}\nLogged in and awaiting vc to join`),
  )
  .catch((err) => console.error(`${ERR_ASCII_ART}\n`, err));
