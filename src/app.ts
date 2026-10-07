import express, { type Request, type Response, type Application } from "express";
import cors from "cors";
import dotenv from "dotenv";
import telegramRouter from "./routes/telegram.routes.js";
import schedulerRouter from "./routes/scheduler.routes.js";
import { callTelegramWebHook } from "./services/telegram/chat.telegram.js";

dotenv.config();

const app: Application = express();
app.use(cors());
app.use(express.json());

app.get("/", (req: Request, res: Response) => {
    res.json({
        status: "online",
        message: "ReactiveChatBot API is running 🚀",
        endpoints: {
            telegramWebhook: "POST /api/telegram/webhook or POST /webhook",
            setWebhook: "GET/POST /api/telegram/set-webhook?url=<YOUR_PUBLIC_HTTPS_URL>/api/telegram/webhook",
            webhookInfo: "GET /api/telegram/webhook-info",
            schedulerStats: "GET /api/scheduler/stats",
            scheduledMessages: "GET /api/scheduler/scheduled",
            proactiveLogs: "GET /api/scheduler/proactive-logs",
        },
    });
});


app.use("/api/telegram", telegramRouter);
app.use("/api/scheduler", schedulerRouter);
app.post("/webhook", callTelegramWebHook);

export default app;


