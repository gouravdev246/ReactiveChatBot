import axios from "axios";
import { DIRECT_PROMPT } from "../../Prompt/direct.chat.js";
import { prisma } from "../../config/prisma.js";
import { type User , type UserMemory } from "@prisma/client";


export async function directMessage(message: string, userName?: string, userId?: string): Promise<any> {
    try {
        const workspace = process.env.BL_WORKSPACE || "gourav246";
        const apiKey = process.env.BL_API_KEY || process.env.BLAXEL_SECRET;

        let userInfo = null;
        if (userId) {
            userInfo = await prisma.userMemory.findUnique({
                where: { userId }
            });
        }

        const compressedMemory = userInfo ? {
            userName: userInfo.userName || userName || "Friend",
            userAge: userInfo.userAge,
            favourite: userInfo.favourite,
            studies: userInfo.studies,
            friends: userInfo.friends,
            dailyRoutine: userInfo.dailyRoutine,
            facts: userInfo.facts,
        } : { userName: userName || "Friend" };

        console.log("Compressed Memory Context:", compressedMemory);

        const systemPrompt = DIRECT_PROMPT(
            "Umii",
            userInfo?.userName || userName || "Friend",
            userInfo?.currentMode || "FRIEND",
            compressedMemory,
            "No recent message",
            "Neutral",
            new Date(),
            message
        );

        const response = await axios.post(
            `https://run.blaxel.ai/${workspace}/models/sandbox-openai/v1/chat/completions`,
            {
                messages: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    {
                        role: "user",
                        content: message
                    }
                ]
            },
            {
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const aiReply = response.data?.choices?.[0]?.message?.content?.trim();
        console.log("Raw AI Reply:", aiReply);

        if (!aiReply) {
            return { message: "Mujhe samajh nahi aaya, ek baar fir se bolenge?", memoryHints: [] };
        }

        // Clean any markdown code blocks if the model outputs ```json ... ```
        const cleanJson = aiReply.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();

        try {
            return JSON.parse(cleanJson);
        } catch {
            return { message: aiReply, memoryHints: [] };
        }
    } catch (error: any) {
        console.error("AI Service Error:", error?.response?.data || error?.message || error);
        return { message: "Arey yaar, abhi server thoda busy hai. Thodi der baad try karo! 😅", memoryHints: [] };
    }
}

