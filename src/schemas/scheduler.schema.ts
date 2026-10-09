import { z } from "zod";

// ─── Incoming Telegram Message Validation ───────────
export const TelegramMessageSchema = z.object({
  chatId: z.union([z.string(), z.number()]).transform(String),
  userId: z.string().uuid("Invalid user ID format"),
  userName: z.string().min(1).default("Friend"),
  messageText: z.string().min(1, "Message cannot be empty"),
  timestamp: z.coerce.date().default(() => new Date()),
});

export type TelegramMessageInput = z.infer<typeof TelegramMessageSchema>;

// ─── Scheduled Job Payload (what gets enqueued in BullMQ) ───────────
export const ScheduledJobPayloadSchema = z.object({
  userId: z.string().uuid(),
  chatId: z.string().min(1),
  userName: z.string().default("Friend"),
  lastUserMessage: z.string().min(1),
  lastInteractionAt: z.coerce.date(),
  scheduledMessageId: z.string().uuid(), // DB reference
  isSimulation: z.boolean().optional().default(false),
});

export type ScheduledJobPayload = z.infer<typeof ScheduledJobPayloadSchema>;

// ─── AI Decision Response (from the decision LLM) ──────────
export const AIDecisionSchema = z.object({
  shouldSend: z.boolean(),
  message: z.string().optional().default(""),
  reason: z.string().optional().default(""),
  emotion: z.string().optional().default("neutral"),
});

export type AIDecision = z.infer<typeof AIDecisionSchema>;

// ─── Scheduler Config ────────────
export const SchedulerConfigSchema = z.object({
  minDelayMinutes: z.number().min(1).default(90),     // 1.5 hours
  maxDelayMinutes: z.number().min(1).default(120),    // 2 hours
  inactivityThresholdMs: z.number().min(60000).default(90 * 60 * 1000), // 90 min
  maxRetries: z.number().min(0).default(2),
});

export type SchedulerConfig = z.infer<typeof SchedulerConfigSchema>;

// ─── Helper: Get random delay between min and max ───────────────────
export function getRandomDelayMs(
  minMinutes: number = 90,
  maxMinutes: number = 120
): number {
  const min = minMinutes * 60 * 1000;
  const max = maxMinutes * 60 * 1000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─── Env Validation ─────────────
export const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  BOT_FATHER_API: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  GROQ_API_KEY: z.string().min(1),
  GOOGLE_API_KEY: z.string().min(1),
  BL_API_KEY: z.string().optional(),
  BL_WORKSPACE: z.string().optional(),
  REDIS_URL: z.string().optional(),   // TCP Redis for BullMQ (optional, auto-derived from Upstash if missing)
});

export type EnvConfig = z.infer<typeof EnvSchema>;
