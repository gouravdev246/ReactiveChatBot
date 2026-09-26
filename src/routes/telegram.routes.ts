import { Router, type Request, type Response } from "express";
import {
    callTelegramWebHook,
    setTelegramWebhook,
    getTelegramWebhookInfo,
    sendTelegramMessage,
} from "../services/telegram/chat.telegram.js";

const router = Router();

// Endpoint that Telegram invokes when a user messages the bot
router.post("/webhook", callTelegramWebHook);

// Helper endpoint to register your webhook with Telegram
// POST or GET /api/telegram/set-webhook?url=https://your-domain.ngrok-free.app/api/telegram/webhook
router.all("/set-webhook", async (req: Request, res: Response) => {
    try {
        const webhookUrl = (req.body?.url || req.query?.url) as string;
        if (!webhookUrl) {
            return res.status(400).json({
                success: false,
                message: "Missing 'url' parameter. Provide the public HTTPS webhook URL.",
            });
        }

        const result = await setTelegramWebhook(webhookUrl);
        console.log("result =" , result)
        return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
        return res.status(500).json({
            success: false,
            error: error?.response?.data || error?.message || error,
        });
    }
});

// Helper endpoint to check current Telegram webhook status
router.get("/webhook-info", async (req: Request, res: Response) => {
    try {
        const info = await getTelegramWebhookInfo();
        return res.status(200).json({ success: true, data: info });
    } catch (error: any) {
        return res.status(500).json({
            success: false,
            error: error?.response?.data || error?.message || error,
        });
    }
});

// Helper endpoint to test sending a direct message to a chat ID
router.post("/send-message", async (req: Request, res: Response) => {
    try {
        const { chatId, message } = req.body;
        if (!chatId || !message) {
            return res.status(400).json({
                success: false,
                message: "Please provide 'chatId' and 'message' in request body.",
            });
        }
        const result = await sendTelegramMessage(chatId, message);
        return res.status(200).json({ success: true, data: result?.data });
    } catch (error: any) {
        return res.status(500).json({
            success: false,
            error: error?.response?.data || error?.message || error,
        });
    }
});

export default router;
