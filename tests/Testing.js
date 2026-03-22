import { readFile } from "node:fs/promises";
import ModelHandler from "@/lib/session/ModelHandler.js";
import { EstimateTokens } from "@/lib/static/Utils.js";

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

  const blocks = raw.match(/<([^>\n]+)>[\s\S]*?<\/\1>/g) ?? [];
  return blocks.map((block) => block.trim());
}

/**
 * Creates a little 3x3 dot spinner in the terminal.
 *
 * @param {string} label
 * @param {number} intervalMs
 * @returns {{ stop: (finalMessage?: string) => void }}
 */
function createDotSpinner(label = "Summarizing transcript", intervalMs = 80) {
  const frames = [
    "●○○ ○○○ ○○○",
    "○●○ ○○○ ○○○",
    "○○● ○○○ ○○○",
    "○○○ ●○○ ○○○",
    "○○○ ○●○ ○○○",
    "○○○ ○○● ○○○",
    "○○○ ○○○ ●○○",
    "○○○ ○○○ ○●○",
    "○○○ ○○○ ○○●",
  ];

  let frameIndex = 0;

  const timer = setInterval(() => {
    const frame = frames[frameIndex];
    process.stdout.write(`\r${label} ${frame}`);
    frameIndex = (frameIndex + 1) % frames.length;
  }, intervalMs);

  return {
    stop(finalMessage = `${label} done.`) {
      clearInterval(timer);
      process.stdout.write("\r" + " ".repeat(label.length + 20) + "\r");
      console.log(finalMessage);
    },
  };
}

console.log("=".repeat(64));
console.log("+".repeat(64));

const modelHandler = new ModelHandler(null, null);

console.log("Parsing fake transcript...");
console.log("=".repeat(64));

const parsedTranscript = await splitTranscriptByDelimiters();

console.log("Creating fake sessionLog...");
console.log("=".repeat(64));

const sessionLog = [];

for (const chunk of parsedTranscript) {
  sessionLog.push({
    userContent: "bitch",
    modelContent: chunk,
    modelTokens: EstimateTokens(chunk),
  });
}

modelHandler.sessionLog = sessionLog;

console.log("Testing ModelHandler's getCriticSummary()");

const spinner = createDotSpinner("Summarizing transcript");

try {
  await modelHandler.getCriticSummary();
  spinner.stop("Summarization complete.");
} catch (err) {
  spinner.stop("Summarization failed.");
  throw err;
}

console.log("FEEDBACK:\n", modelHandler.feedbackChat);
console.log("=".repeat(64));
console.log("SUMMARIES:\n", modelHandler.summaryLog);
console.log();

let totalTokens = 0;
for (const chunk of modelHandler.summaryLog) {
  const tokens = EstimateTokens(chunk.modelContent);
  console.log("Summary Tokens:", tokens);
  totalTokens += tokens;
}

console.log("Total Tokens:", totalTokens);
console.log("+".repeat(64));
console.log("=".repeat(64));
