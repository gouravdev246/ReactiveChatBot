


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