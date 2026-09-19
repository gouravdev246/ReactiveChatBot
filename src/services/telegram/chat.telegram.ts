import axios from "axios";
import { type Request, type Response } from "express";
import { directMessage } from "../ai/chat.sendmessage.ai.js";

const getBotToken = () => process.env.BOT_FATHER_API || process.env.BOT_TOKEN;


export async function sendTelegramChatAction(chatId: number | string, action: string = "typing") {
    const token = getBotToken();
    if (!token) return;

    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendChatAction`, {
            chat_id: chatId,
            action: action,
        });
    } catch (error: any) {
        console.error("Failed to send chat action:", error?.response?.data || error?.message);
    }
}

/**
 * Send a text message to a Telegram chat
 */
export async function sendTelegramMessage(chatId: number | string, text: string) {
    const token = getBotToken();
    if (!token) {
        throw new Error("Telegram BOT token is not configured in .env");
    }

    const TELEGRAM_MAX_LENGTH = 4000;
    if (text.length > TELEGRAM_MAX_LENGTH) {
        for (let i = 0; i < text.length; i += TELEGRAM_MAX_LENGTH) {
            const chunk = text.slice(i, i + TELEGRAM_MAX_LENGTH);
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: chatId,
                text: chunk,
            });
        }
        return;
    }

    return await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId,
        text: text,
    });
}

/**
 * Set the webhook URL for Telegram Bot
 */
export async function setTelegramWebhook(webhookUrl: string) {
    const token = getBotToken();
    if (!token) {
        throw new Error("Telegram BOT token is not configured in .env");
    }

    const response = await axios.get(
        `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
    );
    return response.data;
}

/**
 * Get the current Telegram webhook status
 */
export async function getTelegramWebhookInfo() {
    const token = getBotToken();
    if (!token) {
        throw new Error("Telegram BOT token is not configured in .env");
    }

    const response = await axios.get(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    return response.data;
}

/**
 * Controller/Handler for incoming Telegram webhook updates
 */
export async function callTelegramWebHook(req: Request, res: Response) {
    try {
        const update = req.body;

        // Verify if update contains a message
        const message = update?.message || update?.edited_message;
        if (!message || !message.chat?.id) {
            // Acknowledge non-message updates (e.g., poll, inline query, my_chat_member)
            return res.status(200).json({ ok: true, note: "No message to process" });
        }

        const chatId = message.chat.id;
        const incomingText = message.text;
        const userName = message.from?.first_name || message.from?.username || "Friend";

        // If user sent a photo/voice/sticker without text
        if (!incomingText) {
            await sendTelegramMessage(
                chatId,
                "Mujhe abhi sirf text messages samajh aate hain! Kuch likh kar bhejo 😊"
            );
            return res.status(200).json({ ok: true });
        }

        // Handle /start command
        if (incomingText.trim() === "/start") {
            const welcomeText = `Hii ${userName}! ✨\nMain Umii hoon, tumhari AI companion. Batao, aaj kaisa chal raha hai sab?`;
            await sendTelegramMessage(chatId, welcomeText);
            return res.status(200).json({ ok: true });
        }

        // Send 'typing...' action so user knows AI is preparing reply
        sendTelegramChatAction(chatId, "typing").catch(() => {});

        // Get AI answer
        const aiAnswer = await directMessage(incomingText, userName);

        // Send answer back to user on Telegram
        await sendTelegramMessage(chatId, aiAnswer);

        return res.status(200).json({ ok: true });
    } catch (error: any) {
        console.error("Telegram Webhook Error:", error?.response?.data || error?.message || error);
        // Always return 200 OK so Telegram doesn't retry failed requests infinitely
        return res.status(200).json({ ok: false, error: error?.message });
    }
}
