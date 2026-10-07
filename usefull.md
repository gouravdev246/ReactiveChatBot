


ngrok http 5002 --url https://pogo-jockstrap-spongy.ngrok-free.dev

AAI Reply: [
  {
    index: 0,
    message: {
      role: 'assistant',
      content: '{\n' +
        '  "message": "Wah bhai, pizza aur black color! Toh tumhe toh pizza party karne ka bahana mil gaya! 🍕 Aur software engineer banne ka goal bhi set ja raha hai. Badiya hai!",\n' +
        '  "emotion": "excited",\n' +
        '  "intent": "engage",\n' +
        '  "shouldAskQuestion": true,\n' +
        '  "question": "Tumhe coding ke kis area mein jaana hai?",\n' +
        '  "memoryHints": [\n' +
        '    {\n' +
        '      "category": "favourite",\n' +
        '      "key": "food",\n' +
        '      "value": "Pizza"\n' +
        '    },\n' +
        '    {\n' +
        '      "category": "favourite",\n' +
        '      "key": "color",\n' +
        '      "value": "Black"\n' +
        '    },\n' +
        '    {\n' +
        '      "category": "goal",\n' +
        '      "key": "dream_job",\n' +
        '      "value": "Software Engineer"\n' +
        '    }\n' +
        '  ],\n' +
        '  "relationshipSignal": "positive"\n' +
        '}',
      refusal: null,
      annotations: []
    },
    logprobs: null,
    finish_reason: 'stop'
  }
]
json {
  "message": "Wah bhai, pizza aur black color! Toh tumhe toh pizza party karne ka bahana mil gaya! 🍕 Aur software engineer banne ka goal bhi set ja raha hai. Badiya hai!",        
  "emotion": "excited",
  "intent": "engage",
  "shouldAskQuestion": true,
  "question": "Tumhe coding ke kis area mein jaana hai?",
  "memoryHints": [
    {
      "category": "favourite",
      "key": "food",
      "value": "Pizza"
    },
    {
      "category": "favourite",
      "key": "color",
      "value": "Black"
    },
    {
      "category": "goal",
      "key": "dream_job",
      "value": "Software Engineer"
    }
  ],
  "relationshipSignal": "positive"
}






sequenceDiagram
    autonumber
    actor User as Telegram User
    participant Bot as Telegram Webhook / App
    participant DB as Postgres (Prisma)
    participant Queue as BullMQ (Redis)
    participant Worker as BullMQ Worker
    participant LLM as SLM / Decision Model (Groq)

    User->>Bot: Sends message ("I am going for DBMS exam")
    Bot->>DB: Save/Update Conversation (lastInteractionAt = Now)
    Bot->>Queue: Enqueue/Reschedule delayed job (delay: 90-120 mins, jobId: user_{id})
    Bot->>User: Sends AI response ("All the best!")

    Note over Queue, Worker: 1.5 to 2 Hours Pass (No new messages from User)

    Queue->>Worker: Delayed Job fires (Check Proactive Message)
    Worker->>DB: Fetch User, Memory & Last Conversation details
    
    alt User talked recently within 90 mins
        Worker->>Worker: Discard job (User was active recently)
    else Inactive for 1.5 - 2 hours
        Worker->>LLM: Send Last Conversation + Memory + Current Time
        LLM-->>Worker: Decision { shouldSend: true, message: "Exam kaisa gaya?" }
        
        alt Decision is YES
            Worker->>User: Send Telegram Message directly
            Worker->>DB: Record Proactive Message in PastConversation
        else Decision is NO
            Worker->>Worker: Log reasoning & skip message
        end
    end
