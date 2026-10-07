import app from "./src/app.js";
import { startProactiveWorker } from "./src/services/scheduler/worker.js";

const PORT = process.env.PORT || 5002;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    try {
        startProactiveWorker();
    } catch (err: any) {
        console.error("Failed to initialize proactive worker:", err?.message || err);
    }
});