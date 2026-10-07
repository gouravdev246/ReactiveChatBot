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
  lastUserMessage: string
): Promise<void> {
  try {
    const jobId = `proactive_${userId}`;

    // Step 1: Remove any existing pending job for this user (debounce)
    const existingJob = await proactiveQueue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === "delayed" || state === "waiting") {
        await existingJob.remove();
        console.log(`[Scheduler] 🔄 Removed old pending job for user ${userId}`);
      }
    }

    // Also mark any existing PENDING scheduled messages as SKIPPED
    await prisma.scheduledMessage.updateMany({
      where: { userId, status: "PENDING" },
      data: { status: "SKIPPED", reason: "User sent a new message — rescheduled" },
    });

    // Step 2: Update user's lastInteractionAt
    await prisma.user.update({
      where: { id: userId },
      data: { lastInteractionAt: new Date() },
    });

    // Step 3: Create new ScheduledMessage record in DB
    const delayMs = getRandomDelayMs(90, 120); // 90-120 minutes
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
    });

    // Step 5: Enqueue the delayed job in BullMQ
    await proactiveQueue.add("check-and-send", payload, {
      jobId,
      delay: delayMs,
    });

    const delayMin = Math.round(delayMs / 60_000);
    console.log(
      `[Scheduler] ⏰ Scheduled proactive check for user ${userId} in ~${delayMin} minutes (jobId: ${jobId})`
    );
  } catch (error: any) {
    console.error("[Scheduler] ❌ Failed to schedule proactive check:", error?.message || error);
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
