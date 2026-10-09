import dotenv from "dotenv";
dotenv.config();

import {
  isQuietHours,
  isTrivialMessage,
  evaluateProactiveMessage,
} from "./proactive.decision.ai.js";

async function runTests() {
  console.log("=== TEST 1: Trivial Message Filter ===");
  const testPhrases = [
    { text: "ok", expected: true },
    { text: "good night", expected: true },
    { text: "bye", expected: true },
    { text: "k", expected: true },
    { text: "haan theek hai", expected: true },
    { text: "👍", expected: true },
    { text: "Main DBMS exam dene ja raha hoon!", expected: false },
    { text: "Hospital ja raha hoon checkup ke liye", expected: false },
  ];

  for (const { text, expected } of testPhrases) {
    const isTrivial = isTrivialMessage(text);
    console.log(`- "${text}" => isTrivial=${isTrivial} (Passed: ${isTrivial === expected})`);
  }

  console.log("\n=== TEST 2: Quiet Hours Guardrail ===");
  const lateNight = new Date("2026-10-07T23:30:00+05:30"); // 11:30 PM IST
  const earlyMorning = new Date("2026-10-07T05:30:00+05:30"); // 5:30 AM IST
  const afternoon = new Date("2026-10-07T15:00:00+05:30"); // 3:00 PM IST

  console.log(`- 11:30 PM IST quiet hours: ${isQuietHours(lateNight, "Asia/Kolkata")} (Expected: true)`);
  console.log(`- 5:30 AM IST quiet hours: ${isQuietHours(earlyMorning, "Asia/Kolkata")} (Expected: true)`);
  console.log(`- 3:00 PM IST quiet hours: ${isQuietHours(afternoon, "Asia/Kolkata")} (Expected: false)`);

  console.log("\n=== TEST 3: Evaluator on Active Event Scenario ===");
  // User had an exam 2 hours ago
  const twoHoursAgo = new Date(afternoon.getTime() - 2 * 60 * 60 * 1000);
  const result1 = await evaluateProactiveMessage({
    userName: "Gourav",
    lastUserMessage: "Main DBMS exam dene ja raha hoon, milte hain baad mein!",
    lastInteractionAt: twoHoursAgo,
    currentTime: afternoon,
    longTermMemory: "- Studying Computer Science at college\n- Loves Pizza",
  });
  console.log("Exam Follow-up Decision:", JSON.stringify(result1, null, 2));

  console.log("\n=== TEST 4: Evaluator on Concluded/Trivial Conversation ===");
  const result2 = await evaluateProactiveMessage({
    userName: "Gourav",
    lastUserMessage: "ok bye",
    lastInteractionAt: twoHoursAgo,
    currentTime: afternoon,
    longTermMemory: "- Studying Computer Science at college",
  });
  console.log("Trivial Farewell Decision:", JSON.stringify(result2, null, 2));
}

runTests()
  .then(() => {
    console.log("\nAll tests completed successfully! 🎉");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
