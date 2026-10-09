/**
 * Re-exporting proactive worker methods from src/jobs/proactiveMessage.worker.ts
 */
export {
  startProactiveWorker,
  getProactiveWorkerInstance,
  getProactiveWorkerInstance as getWorkerInstance,
  processProactiveJob,
  updateScheduledMessageStatus,
  recordDispatchedProactiveMessage,
} from "../../jobs/proactiveMessage.worker.js";
