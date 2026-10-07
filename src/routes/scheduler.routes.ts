import { Router, type Request, type Response } from "express";
import { getQueueStats } from "../services/scheduler/queue.js";
import { getWorkerInstance } from "../services/scheduler/worker.js";
import { prisma } from "../config/prisma.js";

const router = Router();

/**
 * GET /api/scheduler/stats — Queue health dashboard
 */
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await getQueueStats();
    const worker = getWorkerInstance();

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

export default router;
