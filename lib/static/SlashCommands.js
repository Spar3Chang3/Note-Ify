import { SlashCommandBuilder } from "discord.js";
import { COMMAND_LIST } from "@/lib/static/Constants.js";

/**
 * Array of slash command data ready to be pushed to the Discord REST API.
 * (e.g., via rest.put(Routes.applicationCommands(CLIENT_ID), { body: SlashCommands }))
 */
export const SlashCommands = [
  new SlashCommandBuilder()
    .setName(COMMAND_LIST.start.cmd)
    .setDescription("Starts recording the session.")
    .addUserOption((option) =>
      option
        .setName("gm")
        .setDescription("The Game Master (defaults to you)")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("players")
        .setDescription("List of players to track (e.g., @user1 @user2)")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("trustees")
        .setDescription("List of trustees to allow bot control (e.g., @user1 @user2)")
        .setRequired(false)
    )
    .addBooleanOption((option) =>
      option
        .setName("force")
        .setDescription("Force the bot to leave/restart an existing session")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName(COMMAND_LIST.stop.cmd)
    .setDescription("Stops recording and begins summarizing."),

  new SlashCommandBuilder()
    .setName(COMMAND_LIST.pause.cmd)
    .setDescription("Pauses recording and summarizes current state."),

  new SlashCommandBuilder()
    .setName(COMMAND_LIST.unpause.cmd)
    .setDescription("Resumes recording from a paused state."),

  new SlashCommandBuilder()
    .setName(COMMAND_LIST.help.cmd)
    .setDescription("Shows the help message listing all commands."),
].map((command) => command.toJSON());