// run_pipeline.js
// Runs all agents in sequence: 1 → 2 → 3 → 4a → 4b → 4c

import dotenv from "dotenv";
dotenv.config({ override: true });
import { runAgent1 } from "./agents/agent1_fetch.js";
import { runAgent2 } from "./agents/agent2_score.js";
import { runAgent3 } from "./agents/agent3_research.js";
import { runAgent4a } from "./agents/agent4a_writer.js";
import { runAgent4b } from "./agents/agent4b_linker.js";
import { runAgent4c } from "./agents/agent4c_formatter.js";

async function runPipeline() {
  const start = Date.now();
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   IK Market Intelligence Pipeline    ║");
  console.log(`║   ${new Date().toLocaleString().padEnd(36)}║`);
  console.log("╚══════════════════════════════════════╝");

  try {
    await runAgent1();
    await runAgent2();
    await runAgent3();
    await runAgent4a();
    await runAgent4b();
    await runAgent4c();

    const mins = ((Date.now() - start) / 60000).toFixed(1);
    console.log("\n╔══════════════════════════════════════╗");
    console.log(`║  ✓ Pipeline complete in ${mins} mins  `.padEnd(41) + "║");
    console.log("╚══════════════════════════════════════╝\n");
  } catch (err) {
    console.error("\n✗ Pipeline failed:", err.message);
    process.exit(1);
  }
}

runPipeline();
