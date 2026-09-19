import axios from "axios";
import { DIRECT_PROMPT } from "../../Prompt/direct.chat.js";

function buildSystemPrompt(userMessage: string, userName: string = "Friend", companionName: string = "Umii") {
    return DIRECT_PROMPT
        .replace(/\{\{COMPANION_NAME\}\}/g, companionName)
        .replace(/\{\{USER_NAME\}\}/g, userName)
        .replace(/\{\{RELATIONSHIP_LEVEL\}\}/g, "Friend")
        .replace(/\{\{CURRENT_DATETIME\}\}/g, new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))
        .replace(/\{\{RECENT_MESSAGES\}\}/g, "None")
        .replace(/\{\{RELEVANT_MEMORIES\}\}/g, "None")
        .replace(/\{\{USER_EMOTION\}\}/g, "Neutral / Friendly")
        .replace(/\{\{USER_MESSAGE\}\}/g, userMessage);
}

export async function directMessage(message: string, userName?: string): Promise<string> {
    try {
        const workspace = process.env.BL_WORKSPACE || "gourav246";
        const apiKey = process.env.BL_API_KEY || process.env.BLAXEL_SECRET;
        const systemPrompt = buildSystemPrompt(message, userName);

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
        return aiReply || "Mujhe samajh nahi aaya, ek baar fir se bolenge?";
    } catch (error: any) {
        console.error("AI Service Error:", error?.response?.data || error?.message || error);
        return "Arey yaar, abhi server thoda busy hai. Thodi der baad try karo! 😅";
    }
}