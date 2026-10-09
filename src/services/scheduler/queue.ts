import { Queue } from "bullmq";
import { createRedisConnection } from "../../config/redis.js";
import { prisma } from "../../config/prisma.js";
import {
  ScheduledJobPayloadSchema,
  getRandomDelayMs,
  type ScheduledJobPayload,
} from "../../schemas/scheduler.schema.js";

// ─── Queue Name ─────────────────────────────────────────────────────
export const PROACTIVE_QUEUE_NAME = "proactive-messages";

// ─── BullMQ Queue Instance ─────────────────────────────────────────
const proactiveQueue = new Queue<ScheduledJobPayload>(PROACTIVE_QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { count: 100 },  // keep last 100 completed jobs
    removeOnFail: { count: 50 },       // keep last 50 failed jobs
  },
});

proactiveQueue.on("error", (err) => {
  console.error("[ProactiveQueue] ❌ Queue error:", err.message);
});

/**
 * Schedule (or reschedule) a proactive message check for a user.
 *
 * Called every time a user sends a message. This:
 *  1. Cancels any existing pending job for this user (debounce)
 *  2. Creates a new ScheduledMessage record in DB
 *  3. Enqueues a delayed BullMQ job (90-120 min from now)
 *  4. Updates the user's lastInteractionAt timestamp
 */
export async function scheduleProactiveCheck(
  userId: string,
  chatId: string,
  userName: string,
  lastUserMessage: string,
  options?: { delayMs?: number; isSimulation?: boolean }
): Promise<string | undefined> {
  try {
    // Step 1: Remove any existing pending job for this user (debounce)
    const pendingMsg = await prisma.scheduledMessage.findFirst({
      where: { userId, status: "PENDING" },
    });

    if (pendingMsg?.bullJobId) {
      const existingJob = await proactiveQueue.getJob(pendingMsg.bullJobId);
      if (existingJob) {
        await existingJob.remove();
        console.log(`[Scheduler] 🔄 Removed old pending job (${pendingMsg.bullJobId})`);
      }
    }

    // Also mark any existing PENDING scheduled messages as SKIPPED and release bullJobId
    await prisma.scheduledMessage.updateMany({
      where: { userId, status: "PENDING" },
      data: { status: "SKIPPED", reason: "User sent a new message — rescheduled", bullJobId: null },
    });

    const jobId = `proactive_${userId}_${Date.now()}`;

    // Step 2: Update user's lastInteractionAt
    await prisma.user.update({
      where: { id: userId },
      data: { lastInteractionAt: new Date() },
    });

    // Step 3: Compute delay (supports configurable short delays for testing/simulation)
    const envDelay = process.env.PROACTIVE_SIMULATION_DELAY_MS
      ? parseInt(process.env.PROACTIVE_SIMULATION_DELAY_MS, 10)
      : undefined;

    const delayMs = options?.delayMs ?? envDelay ?? getRandomDelayMs(90, 120);
    const isSim =
      options?.isSimulation ??
      (delayMs < 60_000 || process.env.PROACTIVE_SIMULATION_MODE === "true");
    const scheduledAt = new Date(Date.now() + delayMs);

    const scheduledMsg = await prisma.scheduledMessage.create({
      data: {
        userId,
        scheduledAt,
        lastUserMessage,
        status: "PENDING",
        bullJobId: jobId,
      },
    });

    // Step 4: Build and validate payload via Zod
    const payload = ScheduledJobPayloadSchema.parse({
      userId,
      chatId,
      userName,
      lastUserMessage,
      lastInteractionAt: new Date(),
      scheduledMessageId: scheduledMsg.id,
      isSimulation: isSim,
    });

    // Step 5: Enqueue the delayed job in BullMQ
    await proactiveQueue.add("check-and-send", payload, {
      jobId,
      delay: delayMs,
    });

    const delayFormatted =
      delayMs >= 60_000
        ? `~${Math.round(delayMs / 60_000)} minutes`
        : `${Math.round(delayMs / 1000)} seconds (simulation)`;
    console.log(
      `[Scheduler] ⏰ Scheduled proactive check for user ${userId} in ${delayFormatted} (jobId: ${jobId})`
    );

    return jobId;
  } catch (error: any) {
    console.error("[Scheduler] ❌ Failed to schedule proactive check:", error?.message || error);
    return undefined;
  }
}

/**
 * Get queue health info (for monitoring/debugging)
 */
export async function getQueueStats() {
  const [waiting, active, delayed, completed, failed] = await Promise.all([
    proactiveQueue.getWaitingCount(),
    proactiveQueue.getActiveCount(),
    proactiveQueue.getDelayedCount(),
    proactiveQueue.getCompletedCount(),
    proactiveQueue.getFailedCount(),
  ]);

  return { waiting, active, delayed, completed, failed };
}

export { proactiveQueue };
