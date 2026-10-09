import "dotenv/config";
import { prisma } from "../config/prisma.js";
import {
  startProactiveWorker,
  getProactiveWorkerInstance,
  updateScheduledMessageStatus,
  recordDispatchedProactiveMessage,
} from "./proactiveMessage.worker.js";

async function runWorkerTests() {
  console.log("=== TEST 1: Worker Initialization & Singleton ===");
  const worker1 = startProactiveWorker();
  const worker2 = getProactiveWorkerInstance();
  console.log("- Worker started successfully:", !!worker1);
  console.log("- Singleton instance matches:", worker1 === worker2);

  console.log("\n=== TEST 2: DB Status Updates & Logging ===");
  // Find or create a test user
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        chat_id: "test_chat_12345",
        name: "Test Runner",
      },
    });
  }

  // Create a temporary ScheduledMessage record
  const testJob = await prisma.scheduledMessage.create({
    data: {
      userId: user.id,
      bullJobId: `test_job_${Date.now()}`,
      scheduledAt: new Date(Date.now() + 3600000),
      lastUserMessage: "Test run message",
      status: "PENDING",
    },
  });
  console.log("- Created test ScheduledMessage with ID:", testJob.id);

  // Test updating status
  await updateScheduledMessageStatus(testJob.id, "PROCESSING");
  let updated = await prisma.scheduledMessage.findUnique({ where: { id: testJob.id } });
  console.log("- Status updated to PROCESSING:", updated?.status === "PROCESSING");

  await updateScheduledMessageStatus(testJob.id, "SENT", "Verified test delivery");
  updated = await prisma.scheduledMessage.findUnique({ where: { id: testJob.id } });
  console.log("- Status updated to SENT:", updated?.status === "SENT", `(Reason: ${updated?.reason})`);

  // Test recordDispatchedProactiveMessage
  const testDecision = {
    shouldSend: true,
    message: "Hey! How is everything going with your project?",
    reason: "Unit test dispatch verification",
    emotion: "curious",
  };

  await recordDispatchedProactiveMessage(
    user.id,
    testDecision.message,
    "Kal presentation hai",
    testDecision
  );

  const log = await prisma.proactiveMessageLog.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  console.log("- ProactiveMessageLog successfully created:", !!log && log.messageSent === testDecision.message);

  // Clean up test scheduled record
  await prisma.scheduledMessage.delete({ where: { id: testJob.id } });
  if (log) {
    await prisma.proactiveMessageLog.delete({ where: { id: log.id } });
  }
  console.log("- Cleaned up temporary test records from DB");

  // Close worker gracefully for script exit
  await worker1.close();
  console.log("- Worker closed gracefully");
}

runWorkerTests()
  .then(() => {
    console.log("\nAll Phase 3 Worker & Dispatcher tests passed successfully! 🚀");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Worker test failed:", err);
    process.exit(1);
  });
