import "dotenv/config";
import { prisma } from "../../config/prisma.js";
import { scheduleProactiveCheck, proactiveQueue } from "./queue.js";
import { startProactiveWorker } from "../../jobs/proactiveMessage.worker.js";

async function runEndToEndSimulation() {
  console.log("=== PHASE 4: END-TO-END PROACTIVE SCHEDULER SIMULATION ===");

  // 1. Get or create a user in DB
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        chat_id: "test_chat_simulation",
        name: "Gourav",
      },
    });
  }

  console.log(`- Testing with user: "${user.name}" (ID: ${user.id}, Chat: ${user.chat_id})`);

  // 2. Start Worker
  const worker = startProactiveWorker();
  console.log("- Proactive Worker started and waiting for jobs");

  // 3. Trigger Proactive Scheduler with a 5-second simulation delay
  const testMessage = "Main DBMS exam dene ja raha hoon, milte hain!";
  console.log(`- Enqueuing job with 5-second delay: "${testMessage}"`);

  const jobId = await scheduleProactiveCheck(
    user.id,
    user.chat_id || "test_chat",
    user.name || "Gourav",
    testMessage,
    { delayMs: 5000, isSimulation: true }
  );

  console.log(`- Delayed Job enqueued in BullMQ! Job ID: ${jobId}`);

  // 4. Verify job state in BullMQ immediately
  const job = await proactiveQueue.getJob(jobId!);
  const initialState = await job?.getState();
  console.log(`- Immediate Job state in BullMQ: "${initialState}" (expected: delayed)`);

  // 5. Wait for the 5-second delay to elapse and worker to process
  console.log("- Waiting for worker to pick up and complete job...");
  let scheduledRecord = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    scheduledRecord = await prisma.scheduledMessage.findFirst({
      where: { bullJobId: jobId || "" },
    });
    if (
      scheduledRecord &&
      (scheduledRecord.status === "SENT" ||
        scheduledRecord.status === "SKIPPED" ||
        scheduledRecord.status === "FAILED")
    ) {
      break;
    }
  }

  // 6. Check DB records
  console.log(`- ScheduledMessage DB Status: "${scheduledRecord?.status}"`);
  console.log(`- ScheduledMessage Reason: "${scheduledRecord?.reason}"`);

  const proactiveLog = await prisma.proactiveMessageLog.findFirst({
    where: { userId: user.id },
    orderBy: { sentAt: "desc" },
  });

  if (proactiveLog) {
    console.log(`- ProactiveMessageLog Entry Created:`);
    console.log(`  • Message Sent: "${proactiveLog.messageSent}"`);
    console.log(`  • Context: "${proactiveLog.context}"`);
    console.log(`  • AI Decision:`, proactiveLog.aiDecision);
  }

  // Gracefully close worker & queue connections
  await worker.close();
  console.log("- Worker closed gracefully");

  console.log("\n=== SIMULATION RESULT ===");
  if (scheduledRecord?.status === "SENT" || scheduledRecord?.status === "SKIPPED") {
    console.log("✅ End-to-end delayed job pipeline verified successfully! 🚀");
  } else {
    console.log(`⚠️ Job ended with status: ${scheduledRecord?.status}`);
  }
}

runEndToEndSimulation()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Simulation failed:", err);
    process.exit(1);
  });
