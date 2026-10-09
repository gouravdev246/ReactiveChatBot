import axios from "axios";
import { type Request, type Response } from "express";
import { directMessage } from "../ai/chat.sendmessage.ai.js";
import { prisma } from "../../config/prisma.js";
import { type User, type UserMemory } from "@prisma/client";
import { type FavouriteThings } from "../../types/userType.js";
import { chainWithHistory } from "../ai/chat.shorthistory.js";
import { chatWithLongTermMemory } from "../ai/chat.longmemory.js";
import { scheduleProactiveCheck } from "../scheduler/queue.js";
const getBotToken = () => process.env.BOT_FATHER_API || process.env.BOT_TOKEN;


export async function sendTelegramChatAction(chatId: number | string, action: string = "typing") {
    const token = getBotToken();
    if (!token) return;

    try {
        const res = await axios.post(`https://api.telegram.org/bot${token}/sendChatAction`, {
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

    const messageText = typeof text === "string" ? text : (text ? JSON.stringify(text) : "Mujhe samajh nahi aaya, ek baar fir se bolenge?");

    const TELEGRAM_MAX_LENGTH = 4000;
    if (messageText.length > TELEGRAM_MAX_LENGTH) {
        for (let i = 0; i < messageText.length; i += TELEGRAM_MAX_LENGTH) {
            const chunk = messageText.slice(i, i + TELEGRAM_MAX_LENGTH);
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: chatId,
                text: chunk,
            });
        }
        return;
    }

    return await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId,
        text: messageText,
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
        console.log(update);

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
                "Aray sirf text karoo , yeh sab abhi nehi dekh sakti 😓"
            );
            return res.status(200).json({ ok: true });
        }

        // Handle /start command
        if (incomingText.trim() === "/start") {
            const welcomeText = `Hii ${userName}! ✨\nMain Umii hoon, tumhari AI companion. Batao, aaj kaisa chal raha hai sab?`;
            await sendTelegramMessage(chatId, welcomeText);
            return res.status(200).json({ ok: true });
        }

        // Find or create user in DB first
        let user = await prisma.user.findUnique({
            where: { chat_id: String(chatId) }
        });

        if (!user) {
            user = await prisma.user.create({
                data: {
                    chat_id: String(chatId),
                    name: userName,
                    username: message.from?.username || null,
                }
            });
        }

        // Handle /simulate or /testproactive command for testing proactive messaging
        if (incomingText.trim().startsWith("/simulate") || incomingText.trim().startsWith("/testproactive")) {
            const simulatedMsg = incomingText.replace(/^\/(simulate|testproactive)/i, "").trim() || "Main DBMS exam dene ja raha hoon!";
            await sendTelegramMessage(
                chatId,
                `Testing proactive scheduler! ⏰ Maine note kiya: "${simulatedMsg}".\n10 seconds ke andar Umii ka proactive check fire hoga...`
            );
            await scheduleProactiveCheck(user.id, String(chatId), userName, simulatedMsg, {
                delayMs: 10_000,
                isSimulation: true,
            });
            return res.status(200).json({ ok: true, simulated: true });
        }

        // Send 'typing...' action so user knows AI is preparing reply
        sendTelegramChatAction(chatId, "typing").catch(() => { });

        // Get AI answer with userId so user memory is retrieved
        const config = { configurable: { sessionId: `${user.id}` } };
        const aiAnswer = await chatWithLongTermMemory(user.id, incomingText, userName);

        // const aiAnswer = await directMessage(incomingText, userName, user.id);

        const rawContent = typeof aiAnswer.content === "string" ? aiAnswer.content : JSON.stringify(aiAnswer.content);

        let parsedData: any = null;
        try {
            const cleanJson = rawContent.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
            parsedData = JSON.parse(cleanJson);
        } catch {
            parsedData = { message: rawContent, memoryHints: [] };
        }

        const replyMessage = parsedData?.message || rawContent || "Mujhe samajh nahi aaya, ek baar fir se bolenge?";

        // Send answer back to user on Telegram
        await sendTelegramMessage(chatId, replyMessage);

        // Schedule proactive follow-up check (fires after 90-120 min of inactivity)
        scheduleProactiveCheck(user.id, String(chatId), userName, incomingText).catch((err) =>
            console.error("[Scheduler] Background scheduling error:", err?.message)
        );

        // Extracting Data For UserMemory from AI-Response
        const memoryHints = parsedData?.memoryHints || [];

        const newFavourite: Record<string, any> = {};
        const newStudies: Record<string, any> = {};
        const newFriends: Record<string, any> = {};
        const newDailyRoutine: Record<string, any> = {};
        const newFacts: Record<string, any> = {};

        for (const hint of memoryHints) {
            const { category, key, value } = hint;
            if (!key) continue;

            switch (category) {
                case "favourite":
                    newFavourite[key] = value;
                    break;
                case "education":
                case "studies":
                    newStudies[key] = value;
                    break;
                case "friend":
                case "friends":
                    newFriends[key] = value;
                    break;
                case "routine":
                case "dailyRoutine":
                    newDailyRoutine[key] = value;
                    break;
                case "goal":
                case "fact":
                case "facts":
                default:
                    newFacts[key] = value;
                    break;
            }
        }




        // let userMemory = await prisma.userMemory.findUnique({
        //     where: { userId: user.id }
        // });

        // if (!userMemory) {
        //     userMemory = await prisma.userMemory.create({
        //         data: {
        //             userId: user.id,
        //             userName: userName,
        //             userAge: null,
        //             currentMode: "FRIEND",
        //             favourite: newFavourite,
        //             studies: newStudies,
        //             friends: newFriends,
        //             dailyRoutine: newDailyRoutine,
        //             facts: newFacts,
        //         }
        //     });
        // } else {
        //     // Merge new updates with existing JSON data
        //     userMemory = await prisma.userMemory.update({
        //         where: { userId: user.id },
        //         data: {
        //             favourite: { ...(userMemory.favourite as object || {}), ...newFavourite },
        //             studies: { ...(userMemory.studies as object || {}), ...newStudies },
        //             friends: { ...(userMemory.friends as object || {}), ...newFriends },
        //             dailyRoutine: { ...(userMemory.dailyRoutine as object || {}), ...newDailyRoutine },
        //             facts: { ...(userMemory.facts as object || {}), ...newFacts },
        //         }
        //     });
        // }

        // console.log("Favourite Hints :", newFavourite);
        // console.log("Facts :", newFacts);
        // console.log("studies", newStudies);
        // console.log("friends", newFriends);
        // console.log("Daily routine", newDailyRoutine);







        return res.status(200).json({ ok: true });
    } catch (error: any) {
        console.error("Telegram Webhook Error:", error?.response?.data || error?.message || error);
        // Always return 200 OK so Telegram doesn't retry failed requests infinitely
        return res.status(200).json({ ok: false, error: error?.message });
    }
}

