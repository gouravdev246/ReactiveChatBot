import { Worker, type Job } from "bullmq";
import { AIMessage } from "@langchain/core/messages";
import { UpstashRedisChatMessageHistory } from "@langchain/community/stores/message/upstash_redis";
import { createRedisConnection } from "../config/redis.js";
import { prisma } from "../config/prisma.js";
import { sendTelegramMessage, sendTelegramChatAction } from "../services/telegram/chat.telegram.js";
import { PROACTIVE_QUEUE_NAME } from "../services/scheduler/queue.js";
import { type ScheduledJobPayload } from "../schemas/scheduler.schema.js";
import { retrieveLongTermMemories } from "../services/ai/chat.longmemory.js";
import { evaluateProactiveMessage } from "../services/ai/proactive.decision.ai.js";

/**
 * Updates the ScheduledMessage record status and optional reason in Postgres
 */
export async function updateScheduledMessageStatus(
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
    console.error(`[Worker:DB] ⚠️ Failed to update ScheduledMessage (${id}):`, err?.message);
  }
}

/**
 * Logs proactive dispatch details into ProactiveMessageLog, PastConversation, and Redis history
 */
export async function recordDispatchedProactiveMessage(
  userId: string,
  message: string,
  lastUserMessage: string,
  decision: any
): Promise<void> {
  try {
    // 1. Record in ProactiveMessageLog
    await prisma.proactiveMessageLog.create({
      data: {
        userId,
        messageSent: message,
        context: lastUserMessage,
        aiDecision: decision,
        sentAt: new Date(),
      },
    });

    // 2. Record in PastConversation under UserMemory if memory exists
    const userMemory = await prisma.userMemory.findUnique({
      where: { userId },
    });

    if (userMemory) {
      await prisma.pastConversation.create({
        data: {
          userMemoryId: userMemory.id,
          topic: decision.emotion ? `Proactive (${decision.emotion})` : "Proactive Follow-up",
          lastMessage: message,
          lastConversation: new Date(),
        },
      });
    }

    // 3. Update user's lastInteractionAt to current timestamp to prevent duplicate immediate triggers
    await prisma.user.update({
      where: { id: userId },
      data: { lastInteractionAt: new Date() },
    });

    // 4. Record the AI's question into Redis short-term history so next user reply has conversation context
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      try {
        const history = new UpstashRedisChatMessageHistory({
          sessionId: userId,
          sessionTTL: 15 * 60, // 15 mins TTL
          config: {
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
          },
        });
        await history.addMessage(new AIMessage(message));
      } catch (redisErr: any) {
        console.warn("[Worker:Redis] ⚠️ Could not save AI message to Redis history:", redisErr?.message);
      }
    }

    console.log(`[Worker:DB] 📝 Recorded proactive message in DB and session history for user ${userId}`);
  } catch (err: any) {
    console.error(`[Worker:DB] ❌ Failed to record dispatched message for user ${userId}:`, err?.message);
  }
}

/**
 * Worker processor: Executes delayed job logic for checking and dispatching proactive messages
 */
export async function processProactiveJob(job: Job<ScheduledJobPayload>): Promise<void> {
  const {
    userId,
    chatId,
    userName,
    lastUserMessage,
    lastInteractionAt,
    scheduledMessageId,
    isSimulation,
  } = job.data;

  const isSimulationMode = Boolean(
    isSimulation || process.env.PROACTIVE_SIMULATION_MODE === "true"
  );

  console.log(
    `[Worker] ⚡ Processing proactive job for user ${userId} (Job ID: ${job.id}, simulation: ${isSimulationMode})`
  );

  try {
    // Step 1: Fetch user from DB and verify current activity state
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, chat_id: true, lastInteractionAt: true },
    });

    if (!user) {
      console.log(`[Worker] ⚠️ User ${userId} no longer exists. Skipping job.`);
      await updateScheduledMessageStatus(scheduledMessageId, "SKIPPED", "User not found in DB");
      return;
    }

    // Verify inactivity window (user must have been inactive for at least 80 minutes in production)
    const actualLastInteraction = user.lastInteractionAt || new Date(lastInteractionAt);
    const msSinceLastInteraction = Date.now() - actualLastInteraction.getTime();
    const inactivityThreshold = 80 * 60 * 1000; // 80 minutes

    if (!isSimulationMode && msSinceLastInteraction < inactivityThreshold) {
      const minutesAgo = Math.round(msSinceLastInteraction / 60_000);
      console.log(
        `[Worker] 🟢 User ${userId} was active recently (${minutesAgo}m ago). Skipping proactive message.`
      );
      await updateScheduledMessageStatus(
        scheduledMessageId,
        "SKIPPED",
        `User was active ${minutesAgo}m ago`
      );
      return;
    }

    // Step 2: Retrieve long-term memories via vector search for context
    const longTermMemory = await retrieveLongTermMemories(userId, lastUserMessage);

    // Update status to PROCESSING
    await updateScheduledMessageStatus(scheduledMessageId, "PROCESSING");

    // For simulation, simulate daytime and 2 hours of elapsed time so developer can test at any time of day
    const now = new Date();
    const currentHour = now.getHours();
    const effectiveCurrentTime =
      isSimulationMode && (currentHour >= 23 || currentHour < 7)
        ? new Date("2026-10-07T15:00:00+05:30") // Emulate 3:00 PM IST during night simulation
        : now;

    const effectiveLastInteraction = isSimulationMode
      ? new Date(effectiveCurrentTime.getTime() - 2 * 60 * 60 * 1000) // Exactly 2 hours prior
      : actualLastInteraction;

    // Step 3: Run Decision Engine (SLM + Guardrails)
    const decision = await evaluateProactiveMessage({
      userName,
      lastUserMessage,
      lastInteractionAt: effectiveLastInteraction,
      currentTime: effectiveCurrentTime,
      longTermMemory,
    });

    console.log(`[Worker] 🤖 Decision Engine verdict for ${userName}:`, decision);

    // Step 4: Dispatch or Skip based on decision
    if (decision.shouldSend && decision.message) {
      const targetChatId = user.chat_id || chatId;

      // Simulate typing indicator briefly before sending
      await sendTelegramChatAction(targetChatId, "typing").catch(() => {});

      // Dispatch message to Telegram
      await sendTelegramMessage(targetChatId, decision.message);
      console.log(`[Worker] 🚀 Telegram proactive message sent to ${userName} (${targetChatId}): "${decision.message}"`);

      // Log dispatch and update DB status
      await recordDispatchedProactiveMessage(userId, decision.message, lastUserMessage, decision);
      await updateScheduledMessageStatus(scheduledMessageId, "SENT", decision.reason);
    } else {
      console.log(`[Worker] ⏭️ Proactive message skipped for ${userName}. Reason: "${decision.reason}"`);
      await updateScheduledMessageStatus(scheduledMessageId, "SKIPPED", decision.reason);
    }
  } catch (error: any) {
    console.error(`[Worker] ❌ Failed processing proactive job for user ${userId}:`, error?.message || error);
    await updateScheduledMessageStatus(scheduledMessageId, "FAILED", error?.message || "Unknown error");
    throw error; // Rethrow so BullMQ handles configured retries
  }
}

// ─── Worker Lifecycle Management ────────────────────────────────────
let proactiveWorkerInstance: Worker<ScheduledJobPayload> | null = null;

/**
 * Initializes and starts the BullMQ Proactive Message Worker
 */
export function startProactiveWorker(): Worker<ScheduledJobPayload> {
  if (proactiveWorkerInstance) {
    console.log("[Worker] ⚡ Proactive message worker is already active");
    return proactiveWorkerInstance;
  }

  proactiveWorkerInstance = new Worker<ScheduledJobPayload>(
    PROACTIVE_QUEUE_NAME,
    processProactiveJob,
    {
      connection: createRedisConnection(),
      concurrency: 3, // Process up to 3 proactive jobs concurrently
      limiter: {
        max: 10,
        duration: 60_000, // Max 10 messages dispatched per minute (Telegram rate limit safe)
      },
    }
  );

  proactiveWorkerInstance.on("completed", (job) => {
    console.log(`[Worker] ✅ Job ${job.id} completed successfully`);
  });

  proactiveWorkerInstance.on("failed", (job, err) => {
    console.error(`[Worker] ❌ Job ${job?.id} failed:`, err.message);
  });

  proactiveWorkerInstance.on("error", (err) => {
    console.error("[Worker] ❌ Worker encountered an error:", err.message);
  });

  console.log("[Worker] 🚀 Proactive message worker successfully initialized and listening for jobs");
  return proactiveWorkerInstance;
}

/**
 * Returns the active worker instance
 */
export function getProactiveWorkerInstance(): Worker<ScheduledJobPayload> | null {
  return proactiveWorkerInstance;
}
