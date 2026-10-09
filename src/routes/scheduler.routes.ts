import { Router, type Request, type Response } from "express";
import { getQueueStats } from "../services/scheduler/queue.js";
import { getProactiveWorkerInstance } from "../jobs/proactiveMessage.worker.js";
import { prisma } from "../config/prisma.js";

const router = Router();

/**
 * GET /api/scheduler/stats — Queue health dashboard
 */
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await getQueueStats();
    const worker = getProactiveWorkerInstance();

    res.json({
      success: true,
      queue: stats,
      worker: {
        running: !!worker,
        status: worker ? "active" : "not started",
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message });
  }
});

/**
 * GET /api/scheduler/scheduled — List recent scheduled messages
 */
router.get("/scheduled", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;

    const messages = await prisma.scheduledMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        user: { select: { name: true, chat_id: true } },
      },
    });

    res.json({ success: true, count: messages.length, messages });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message });
  }
});

/**
 * GET /api/scheduler/proactive-logs — List sent proactive messages
 */
router.get("/proactive-logs", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;

    const logs = await prisma.proactiveMessageLog.findMany({
      orderBy: { sentAt: "desc" },
      take: limit,
      include: {
        user: { select: { name: true, chat_id: true } },
      },
    });

    res.json({ success: true, count: logs.length, logs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message });
  }
});

/**
 * POST /api/scheduler/simulate — Trigger an immediate or short-delay proactive message simulation
 */
router.post("/simulate", async (req: Request, res: Response) => {
  try {
    const { message = "Main DBMS exam dene ja raha hoon!", delaySeconds = 10 } = req.body;
    let { userId, chatId } = req.body;

    // If userId not provided, pick the first user from the database
    let user = null;
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId } });
    } else if (chatId) {
      user = await prisma.user.findUnique({ where: { chat_id: String(chatId) } });
    } else {
      user = await prisma.user.findFirst();
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "No user found in database. Send a message on Telegram first to create a user profile.",
      });
    }

    const targetChatId = user.chat_id || chatId || "simulated_chat";
    const userName = user.name || "Friend";
    const delayMs = Math.max(1, parseInt(String(delaySeconds), 10)) * 1000;

    const { scheduleProactiveCheck } = await import("../services/scheduler/queue.js");
    const jobId = await scheduleProactiveCheck(
      user.id,
      String(targetChatId),
      userName,
      message,
      { delayMs, isSimulation: true }
    );

    res.json({
      success: true,
      message: `Proactive message check scheduled in ${delaySeconds}s (simulation mode)`,
      jobId,
      user: {
        id: user.id,
        name: userName,
        chatId: targetChatId,
      },
      simulatedUserMessage: message,
      delaySeconds,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message });
  }
});

export default router;
