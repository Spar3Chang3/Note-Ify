import { readFile } from "node:fs/promises";
import ModelHandler from "@/lib/session/ModelHandler.js";
import { EstimateTokens } from "@/lib/static/Utils.js";
import { MAX_TOKEN_LIMIT } from "@/lib/static/Constants.js";

/**
 * Splits a transcript into full delimited blocks, preserving the tags.
 *
 * Example returned item:
 * <Thistle>
 *   That is somehow both the least and most comforting thing you could have said.
 * </Thistle>
 *
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
export async function splitTranscriptByDelimiters(
  filePath = "./fake-transcript.txt",
) {
  const raw = await readFile(filePath, "utf8");

  // Matches each full speaker block and keeps the delimiters included
  const blocks = raw.match(/<([^>\n]+)>[\s\S]*?<\/\1>/g) ?? [];

  return blocks.map((block) => block.trim());
}

const modelHandler = new ModelHandler(null, null);

const parsedTranscript = await splitTranscriptByDelimiters();

const sessionLog = [];

for (const chunk of parsedTranscript) {
  sessionLog.push({
    userContent: "bitch",
    modelContent: chunk,
    modelTokens: EstimateTokens(chunk),
  });
}

modelHandler.sessionLog = sessionLog;

await modelHandler.getCriticSummary();

console.log("FEEDBACK:\n", modelHandler.feedbackChat);
console.log("=".repeat(64));
console.log("SUMMARIES:\n", modelHandler.summaryLog);
console.log("=".repeat(64));
console.log("SESSION:\n", modelHandler.sessionLog);
