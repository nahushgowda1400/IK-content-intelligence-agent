// cron.js
// Schedules the full pipeline to run daily at 9am
// Run this once: node cron.js
// Keep the terminal open (or run as a background service)

import cron from "node-cron";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log("━━━ IK Market Intelligence Scheduler ━━━");
console.log("→ Pipeline scheduled: every day at 9:00 AM");
console.log("→ Waiting... (keep this terminal open)\n");

// Run every day at 9:00 AM
cron.schedule("0 9 * * *", () => {
  console.log(`\n[${new Date().toLocaleString()}] Starting scheduled pipeline run...`);
  try {
    execSync(`node ${path.join(__dirname, "run_pipeline.js")}`, {
      stdio: "inherit",
      cwd: __dirname,
    });
  } catch (err) {
    console.error("Pipeline run failed:", err.message);
  }
}, {
  timezone: "Asia/Kolkata" // Change to your timezone if needed
});

// Also run immediately on startup (optional — comment out if you don't want this)
// import("./run_pipeline.js");
