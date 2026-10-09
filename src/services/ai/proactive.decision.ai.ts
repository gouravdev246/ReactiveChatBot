import "dotenv/config";
import { ChatGroq } from "@langchain/groq";
import { AIDecisionSchema, type AIDecision } from "../../schemas/scheduler.schema.js";

export interface ProactiveEvaluationContext {
  userName: string;
  lastUserMessage: string;
  lastInteractionAt: Date;
  currentTime?: Date;
  longTermMemory?: string;
  timezone?: string;
}

// ─── Guardrail 1: Quiet Hours Check (10:00 PM - 7:00 AM IST) ────────
export function isQuietHours(date: Date = new Date(), timezone: string = "Asia/Kolkata"): boolean {
  try {
    const timeStr = date.toLocaleString("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(timeStr, 10);
    // Quiet hours: 10 PM (22) through 7 AM (06:59)
    return hour >= 23 || hour < 7;
  } catch {
    const localHour = date.getHours();
    return localHour >= 23 || localHour < 7;
  }
}

// ─── Guardrail 2: Trivial Message Filter ─────────────────────────────
// Discard short closure phrases where follow-ups feel intrusive or weird
const TRIVIAL_PATTERNS = [
  /^(ok|okay|k|kk|k\s*bye|bye|cya|gn|good\s*night|shubh\s*ratri)$/i,
  /^(hmm+|hm+|haan+|haa+|nah+|nahi|ha|no|yes|yep|nope)$/i,
  /^(acha|achha|theek|thik|theek\s*hai|thik\s*hai|sahi\s*hai)$/i,
  /^(haan+|haa+|ha|hn)\s+(theek|thik|sahi)\s*(hai|h)?$/i,
  /^[\p{Emoji}\s]+$/u, // only emojis
];

export function isTrivialMessage(message: string): boolean {
  const clean = message.trim().toLowerCase();
  if (clean.length === 0) return true;
  if (clean.length <= 3 && !/[a-z0-9]/i.test(clean)) return true;
  return TRIVIAL_PATTERNS.some((pattern) => pattern.test(clean));
}

// ─── Decision SLM Model Instance ────────────────────────────────────
const getDecisionModel = () =>
  new ChatGroq({
    apiKey: process.env.GROQ_API_KEY || "",
    model: "openai/gpt-oss-120b",
    temperature: 0.2, // Low temperature for consistent decision-making
  });

// ─── Evaluation Prompt Builder ──────────────────────────────────────
export function buildEvaluationPrompt(context: ProactiveEvaluationContext): string {
  const {
    userName,
    lastUserMessage,
    lastInteractionAt,
    currentTime = new Date(),
    longTermMemory = "No prior long-term facts recorded.",
    timezone = "Asia/Kolkata",
  } = context;

  const msElapsed = currentTime.getTime() - lastInteractionAt.getTime();
  const hoursSince = (msElapsed / 3_600_000).toFixed(1);

  const formattedTime = currentTime.toLocaleString("en-IN", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });

  return `You are Umii, a close, genuine, empathetic AI companion and friend to "${userName}".
You are running as a background evaluator deciding if you should initiate a follow-up message after ${hoursSince} hours of silence.

=== CONVERSATION CONTEXT ===
- User Name: "${userName}"
- User's Last Message: "${lastUserMessage}"
- Time Elapsed Since Last Chat: ~${hoursSince} hours
- Current Time: ${formattedTime} (Timezone: ${timezone})

=== LONG-TERM MEMORIES ABOUT ${userName} ===
${longTermMemory}

=== DECISION GUARDRAILS & RULES ===
1. RELEVANCE & OPEN LOOPS (Strict):
   - ONLY send if the user's last message mentioned an event, activity, emotion, or task that naturally calls for a check-in after 1.5 - 2+ hours (e.g. exams, interviews, travel, doctor visits, cooking, gym, feeling unwell, studying, crying, working on a project).
   - If the user's message was a conclusive farewell ("good night", "bye", "ok"), generic comment, or closed question, DO NOT reach out (set shouldSend: false).
2. DO NOT BE CLINGY OR GENERIC:
   - NEVER send generic robotic greetings like "Hey, how are you?", "What are you doing?", "Are you free?".
   - The message must be specific, contextual, warm, and natural — like a real friend remembering what they said earlier.
3. TONE & LANGUAGE:
   - Match the user's language style (natural conversational Hinglish / Hindi / English).
   - Keep it short: 1 or 2 sentences max.
4. DEFAULT TO CAUTION:
   - When in doubt, prefer silence (shouldSend: false). Silence is better than an annoying or out-of-place message.

=== OUTPUT FORMAT ===
Respond STRICTLY with valid JSON (no markdown formatting, no code blocks):
{
  "shouldSend": true or false,
  "message": "Friendly follow-up text in Hinglish (empty string if shouldSend is false)",
  "reason": "Brief explanation of why you chose to send or skip",
  "emotion": "caring | curious | excited | supportive | neutral"
}`;
}

/**
 * Evaluates whether to send a proactive message using the SLM and safety guardrails.
 */
export async function evaluateProactiveMessage(
  context: ProactiveEvaluationContext
): Promise<AIDecision> {
  const currentTime = context.currentTime || new Date();
  const timezone = context.timezone || "Asia/Kolkata";

  // 1. Guardrail: Quiet Hours (10 PM to 7 AM)
  if (isQuietHours(currentTime, timezone)) {
    console.log(`[SLM Evaluator] 🌙 Quiet hours active in ${timezone}. Skipping proactive message.`);
    return {
      shouldSend: false,
      message: "",
      reason: "Quiet hours active (10:00 PM - 7:00 AM IST)",
      emotion: "neutral",
    };
  }

  // 2. Guardrail: Inactivity Minimum Threshold (< 80 minutes)
  const msElapsed = currentTime.getTime() - context.lastInteractionAt.getTime();
  if (msElapsed < 80 * 60 * 1000) {
    console.log(`[SLM Evaluator] ⏱️ Inactivity window not met (${Math.round(msElapsed / 60000)}m < 80m). Skipping.`);
    return {
      shouldSend: false,
      message: "",
      reason: "User was active too recently for a proactive check-in",
      emotion: "neutral",
    };
  }

  // 3. Guardrail: Trivial / Conclusive Message Filter
  if (isTrivialMessage(context.lastUserMessage)) {
    console.log(`[SLM Evaluator] 🚫 Trivial/closing message detected ("${context.lastUserMessage}"). Skipping.`);
    return {
      shouldSend: false,
      message: "",
      reason: `Last user message ("${context.lastUserMessage}") has no open thread or pending activity`,
      emotion: "neutral",
    };
  }

  // 4. SLM Evaluation via Groq
  try {
    const prompt = buildEvaluationPrompt({ ...context, currentTime, timezone });
    const response = await getDecisionModel().invoke(prompt);

    const rawContent =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Clean JSON response (strip any ```json ... ``` code fences)
    const cleanJson = rawContent
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/, "")
      .replace(/```$/, "")
      .trim();

    const parsed = JSON.parse(cleanJson);
    const validated = AIDecisionSchema.safeParse(parsed);

    if (validated.success) {
      console.log(`[SLM Evaluator] 🎯 Decision: shouldSend=${validated.data.shouldSend}, reason="${validated.data.reason}"`);
      return validated.data;
    }

    console.warn(`[SLM Evaluator] ⚠️ Schema validation fallback. Raw output:`, cleanJson);
    return {
      shouldSend: false,
      message: "",
      reason: "AI decision output failed validation",
      emotion: "neutral",
    };
  } catch (error: any) {
    console.error(`[SLM Evaluator] ❌ Evaluation error:`, error?.message || error);
    return {
      shouldSend: false,
      message: "",
      reason: `Evaluator error: ${error?.message || "Unknown error"}`,
      emotion: "neutral",
    };
  }
}
