import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "../../config/redis.js";
import { prisma } from "../../config/prisma.js";
import { sendTelegramMessage } from "../telegram/chat.telegram.js";
import { PROACTIVE_QUEUE_NAME } from "./queue.js";
import { AIDecisionSchema, type ScheduledJobPayload } from "../../schemas/scheduler.schema.js";
import { ChatGroq } from "@langchain/groq";
import { retrieveLongTermMemories } from "../ai/chat.longmemory.js";

// ─── Decision LLM (lightweight model for should-send decisions) ─────
const decisionModel = new ChatGroq({
  model: "openai/gpt-oss-120b",
  temperature: 0.3,
});

/**
 * Build the prompt that asks the LLM whether to send a proactive message.
 */
function buildDecisionPrompt(
  userName: string,
  lastMessage: string,
  lastInteractionAt: Date,
  longTermMemory: string,
  currentTime: Date
): string {
  const hoursSince = ((currentTime.getTime() - lastInteractionAt.getTime()) / 3_600_000).toFixed(1);
  const timeOfDay = currentTime.getHours();

  let timeContext = "day";
  if (timeOfDay >= 22 || timeOfDay < 6) timeContext = "late night (do NOT disturb)";
  else if (timeOfDay >= 6 && timeOfDay < 9) timeContext = "early morning";
  else if (timeOfDay >= 18 && timeOfDay < 22) timeContext = "evening";

  return `You are Umii, an AI companion to "${userName}".

CONTEXT:
- Last message from ${userName}: "${lastMessage}"
- Time since last interaction: ${hoursSince} hours
- Current time context: ${timeContext} (IST)
- Current time: ${currentTime.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}

MEMORIES ABOUT ${userName}:
${longTermMemory}

TASK: Decide whether to send a follow-up message to ${userName}.

RULES:
1. ONLY send if the last conversation had a natural follow-up (e.g., "exam kaisa gaya?", "khana kha liya?")
2. Do NOT send if it's late night (10 PM - 6 AM)
3. Do NOT send generic "how are you" messages — be specific to the last conversation context
4. Keep the message short, warm, and natural (like a real friend checking in)
5. If unsure, DO NOT send

Respond in strict JSON (no markdown):
{
  "shouldSend": true/false,
  "message": "The message to send (only if shouldSend is true)",
  "reason": "Why you decided to send or not send",
  "emotion": "the emotion of the message"
}`;
}

/**
 * Process a proactive message job.
 */
async function processProactiveJob(job: Job<ScheduledJobPayload>): Promise<void> {
  const { userId, chatId, userName, lastUserMessage, lastInteractionAt, scheduledMessageId } =
    job.data;

  console.log(`[Worker] 🔧 Processing proactive job for user ${userId} (job: ${job.id})`);

  try {
    // Step 1: Check if user was active recently (within 90 min) — skip if so
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { lastInteractionAt: true, chat_id: true },
    });

    if (!user) {
      console.log(`[Worker] ⚠️ User ${userId} not found, skipping`);
      await markScheduledMessage(scheduledMessageId, "SKIPPED", "User not found in DB");
      return;
    }

    const actualLastInteraction = user.lastInteractionAt || new Date(lastInteractionAt);
    const msSinceLastInteraction = Date.now() - actualLastInteraction.getTime();
    const inactivityThreshold = 85 * 60 * 1000; // 85 minutes

    if (msSinceLastInteraction < inactivityThreshold) {
      console.log(`[Worker] 🟢 User ${userId} was active recently (${Math.round(msSinceLastInteraction / 60_000)}m ago), skipping`);
      await markScheduledMessage(scheduledMessageId, "SKIPPED", "User was active recently");
      return;
    }

    // Step 2: Retrieve long-term memories for context
    const longTermMemory = await retrieveLongTermMemories(userId, lastUserMessage);

    // Step 3: Ask decision LLM
    const decisionPrompt = buildDecisionPrompt(
      userName,
      lastUserMessage,
      actualLastInteraction,
      longTermMemory,
      new Date()
    );

    await markScheduledMessage(scheduledMessageId, "PROCESSING");

    const llmResponse = await decisionModel.invoke(decisionPrompt);
    const rawContent = typeof llmResponse.content === "string"
      ? llmResponse.content
      : JSON.stringify(llmResponse.content);

    // Clean and parse AI decision
    const cleanJson = rawContent
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/, "")
      .replace(/```$/, "")
      .trim();

    let decision;
    try {
      const parsed = JSON.parse(cleanJson);
      decision = AIDecisionSchema.parse(parsed);
    } catch {
      console.error("[Worker] ⚠️ Failed to parse AI decision, skipping:", cleanJson);
      await markScheduledMessage(scheduledMessageId, "SKIPPED", "AI response parse failed");
      return;
    }

    console.log(`[Worker] 🤖 AI Decision:`, decision);

    // Step 4: Act on the decision
    if (decision.shouldSend && decision.message) {
      const targetChatId = user.chat_id || chatId;
      await sendTelegramMessage(targetChatId, decision.message);

      // Log the proactive message
      await prisma.proactiveMessageLog.create({
        data: {
          userId,
          messageSent: decision.message,
          context: lastUserMessage,
          aiDecision: decision as any,
        },
      });

      await markScheduledMessage(scheduledMessageId, "SENT");
      console.log(`[Worker] ✅ Proactive message sent to ${userName} (${targetChatId})`);
    } else {
      await markScheduledMessage(scheduledMessageId, "SKIPPED", decision.reason);
      console.log(`[Worker] ⏭️ Skipped proactive message for ${userName}: ${decision.reason}`);
    }
  } catch (error: any) {
    console.error(`[Worker] ❌ Error processing proactive job:`, error?.message || error);
    await markScheduledMessage(scheduledMessageId, "FAILED", error?.message);
    throw error; // Let BullMQ handle retries
  }
}

/**
 * Update the ScheduledMessage status in DB
 */
async function markScheduledMessage(
  id: string,
  status: "PENDING" | "PROCESSING" | "SENT" | "SKIPPED" | "FAILED",
  reason?: string
): Promise<void> {
  try {
    await prisma.scheduledMessage.update({
      where: { id },
      data: { status, reason: reason || null },
    });
  } catch (err: any) {
    console.error("[Worker] Failed to update ScheduledMessage:", err?.message);
  }
}

// ─── Create & Start the Worker ──────────────────────────────────────
let workerInstance: Worker<ScheduledJobPayload> | null = null;

export function startProactiveWorker(): Worker<ScheduledJobPayload> {
  if (workerInstance) {
    console.log("[Worker] ⚡ Worker already running");
    return workerInstance;
  }

  workerInstance = new Worker<ScheduledJobPayload>(
    PROACTIVE_QUEUE_NAME,
    processProactiveJob,
    {
      connection: createRedisConnection(),
      concurrency: 3,      // Process up to 3 jobs at once
      limiter: {
        max: 10,            // Max 10 jobs per minute
        duration: 60_000,
      },
    }
  );

  workerInstance.on("completed", (job) => {
    console.log(`[Worker] ✅ Job ${job.id} completed`);
  });

  workerInstance.on("failed", (job, err) => {
    console.error(`[Worker] ❌ Job ${job?.id} failed:`, err.message);
  });

  workerInstance.on("error", (err) => {
    console.error("[Worker] ❌ Worker error:", err.message);
  });

  console.log("[Worker] 🚀 Proactive message worker started");
  return workerInstance;
}

export function getWorkerInstance() {
  return workerInstance;
}
