import "dotenv/config";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { SystemMessage } from "@langchain/core/messages";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { UpstashRedisChatMessageHistory } from "@langchain/community/stores/message/upstash_redis";
import { Index } from "@upstash/vector";
import { SHORT_PROMPT } from "../../Prompt/short.chat.js";
import { DIRECT_PROMPT } from "../../Prompt/direct.chat.js";

// 1. Vector Index for Long-Term Memory
const vectorIndex = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL || "",
  token: process.env.UPSTASH_VECTOR_REST_TOKEN || "",
});

// 2. Google Gemini Embeddings
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GOOGLE_API_KEY || "",
  modelName: "gemini-embedding-001",
  outputDimensionality: 1536,
});

/**
 * Retrieve top relevant long-term memories using Vector Similarity Search
 */
export async function retrieveLongTermMemories(
  userId: string,
  currentMessage: string
): Promise<string> {
  try {
    if (!process.env.UPSTASH_VECTOR_REST_URL || !process.env.UPSTASH_VECTOR_REST_TOKEN) {
      return "No prior memory recorded.";
    }

    const queryEmbedding = await embeddings.embedQuery(currentMessage);

    // Query Upstash Vector filtering by userId metadata
    const results = await vectorIndex.query({
      vector: queryEmbedding,
      topK: 5,
      includeMetadata: true,
      filter: `userId = '${userId}'`,
    });

    if (!results || results.length === 0) return "No prior memory recorded.";

    const facts = results
      .map((match) => (match.metadata?.fact ? `- ${match.metadata.fact}` : null))
      .filter(Boolean);

    return facts.length > 0 ? facts.join("\n") : "No relevant memory found.";
  } catch (error) {
    console.error("Error retrieving long-term memory:", error);
    return "No prior memory recorded.";
  }
}


export async function saveLongTermMemory(userId: string, userText: string) {
  try {
    if(!process.env.UPSTASH_VECTOR_REST_URL || !process.env.UPSTASH_VECTOR_REST_TOKEN) {
      return;
    }

    const extractionModel = new ChatGroq({
      model: "openai/gpt-oss-120b",
      temperature: 0.1,
    });

    const extractionPrompt = `Analyze the user's message. Extract key personal facts, preferences, relationships, goals, education, or hobbies about the user.
If no new persistent personal facts are present, reply strictly with "NONE".

Message: "${userText}"
Fact:`;

    const response = await extractionModel.invoke(extractionPrompt);
    const fact = response.content.toString().trim();

    if (fact && fact !== "NONE" && !fact.includes("NONE")) {
      const factEmbedding = await embeddings.embedQuery(fact);

      // Upsert into Upstash Vector database
      await vectorIndex.upsert({
        id: `mem_${userId}_${Date.now()}`,
        vector: factEmbedding,
        metadata: {
          userId,
          fact,
          createdAt: new Date().toISOString(),
        },
      });

      console.log(`[Long-Term Memory Saved for ${userId}]: ${fact}`);
    }
  } catch (error) {
    console.error("Error saving long-term memory:", error);
  }
}

// 3. Conversational Model & Prompt Setup
const model = new ChatGroq({
  model: "openai/gpt-oss-120b",
});

const systemPrompt = DIRECT_PROMPT();

const prompt = ChatPromptTemplate.fromMessages([
  new SystemMessage(systemPrompt),
  [
    "system",
    "RELEVANT LONG-TERM MEMORIES FROM PREVIOUS CONVERSATIONS:\n{longTermMemory}\n(Use these memories naturally when relevant. Never state that you read them from memory or a database.)",
  ],
  new MessagesPlaceholder("history"),
  ["human", "{question}"],
]);

const chain = prompt.pipe(model);

// 4. Redis Short-Term History with 15-Min TTL & stripped metadata
const getMessageHistory = (sessionId: string) => {
  const history = new UpstashRedisChatMessageHistory({
    sessionId,
    sessionTTL: 5 * 60, // 15 minutes TTL (900 seconds)
    config: {
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    },
  });

  const originalAddMessage = history.addMessage.bind(history);
  history.addMessage = async (message) => {
    delete (message as any).response_metadata;
    delete (message as any).usage_metadata;
    delete (message as any).additional_kwargs;
    return originalAddMessage(message);
  };

  return history;
};

// 5. Wrap chain with Redis session history
export const chainWithHistory = new RunnableWithMessageHistory({
  runnable: chain,
  getMessageHistory,
  inputMessagesKey: "question",
  historyMessagesKey: "history",
});

/**
 * Main function: Combines Long-Term Memory (Upstash Vector) + Short-Term History (Upstash Redis)
 */
export async function chatWithLongTermMemory(
  userId: string,
  question: string,
  userName: string = "Friend"
) {
  // Step 1: Retrieve relevant past memories from Vector DB
  const longTermMemory = await retrieveLongTermMemories(userId, question);

  // Step 2: Invoke the chain with short-term history and retrieved long-term memory
  const response = await chainWithHistory.invoke(
    {
      question,
      longTermMemory,
    },
    {
      configurable: { sessionId: userId },
    }
  );

  // Step 3: Extract and save any new long-term facts asynchronously in background
  saveLongTermMemory(userId, question).catch((err) =>
    console.error("Background saveLongTermMemory error:", err)
  );

  return response;
}
