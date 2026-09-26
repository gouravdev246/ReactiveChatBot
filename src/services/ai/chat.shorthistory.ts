import "dotenv/config";
import { ChatGroq } from "@langchain/groq";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { UpstashRedisChatMessageHistory } from "@langchain/community/stores/message/upstash_redis";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { SHORT_PROMPT } from "../../Prompt/short.chat.js";
import {DIRECT_PROMPT } from "../../Prompt/direct.chat.js"

import { SystemMessage } from "@langchain/core/messages";

// 1. Initialize the Model and Prompt
const model = new ChatGroq({
  model: "openai/gpt-oss-120b",
});

const systemprompt = DIRECT_PROMPT();

const prompt = ChatPromptTemplate.fromMessages([
  new SystemMessage(systemprompt),
  new MessagesPlaceholder("history"),
  ["human", "{question}"],
]);

const chain = prompt.pipe(model);

// 2. Create a function to retrieve session history from Redis with 15-min TTL & minimal metadata
const getMessageHistory = (sessionId: string) => {
  const history = new UpstashRedisChatMessageHistory({
    sessionId,
    sessionTTL: 15 * 60, // 15 minutes TTL in seconds (900s)
    config: {
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    },
  });

  // Intercept addMessage to store ONLY clean id + content (strips bulky tokenUsage, headers & metadata)
  const originalAddMessage = history.addMessage.bind(history);
  history.addMessage = async (message) => {
    delete (message as any).response_metadata;
    delete (message as any).usage_metadata;
    delete (message as any).additional_kwargs;
    return originalAddMessage(message);
  };

  return history;
};

// 3. Wrap the chain with Message History
export const chainWithHistory = new RunnableWithMessageHistory({
  runnable: chain,
  getMessageHistory,
  inputMessagesKey: "question",
  historyMessagesKey: "history",
});

