// agents/agent2_score.js
// Agent 2: Reads "New" stories → scores 1-10 via Claude → writes score + status back

import dotenv from "dotenv";
dotenv.config({ override: true });
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { getAllRecords, updateRecords } from "../lib/airtable.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const RAW_STORIES_BASE = { baseId: process.env.AIRTABLE_BASE_ID_RAW_STORIES };
const BATCH_SIZE = 15;

const SCORE_PROMPT = fs.readFileSync(
  path.join(process.cwd(), "prompts/score_prompt.txt"),
  "utf-8"
);

// ─── Main ──────────────────────────────────────────────────────────────────────

export async function runAgent2() {
  console.log("\n━━━ Agent 2: Score Stories ━━━");

  const records = await getAllRecords(process.env.AIRTABLE_RAW_STORIES_TABLE, {
    ...RAW_STORIES_BASE,
    filterByFormula: `{Status} = "New"`,
    fields: ["Headline", "Summary", "Source Name", "Keywords matched"],
  });

  console.log(`→ Found ${records.length} stories to score`);
  if (records.length === 0) { console.log("  No new stories. Exiting."); return; }

  const updates = [];
  const batches = chunkArray(records, BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`\n  Scoring batch ${i + 1}/${batches.length} (${batch.length} stories)...`);

    const scored = await scoreBatch(batch);

    for (const { id, score, status } of scored) {
      updates.push({
        id,
        fields: {
          "Relevance Score": score,
          // Human Check stories get that status, everything else gets Scored
          Status: status === "Human Check" ? "Human Check" : "Scored",
        },
      });
    }

    if (i < batches.length - 1) await sleep(1000);
  }

  console.log(`\n→ Writing ${updates.length} scores to Airtable...`);
  await updateRecords(process.env.AIRTABLE_RAW_STORIES_TABLE, updates, RAW_STORIES_BASE);

  // Summary
  const scored = updates.filter(u => u.fields.Status === "Scored");
  const humanCheck = updates.filter(u => u.fields.Status === "Human Check");
  const high = scored.filter(u => u.fields["Relevance Score"] >= 8).length;
  const mid = scored.filter(u => u.fields["Relevance Score"] >= 5 && u.fields["Relevance Score"] < 8).length;
  const low = scored.filter(u => u.fields["Relevance Score"] < 5).length;

  console.log(`\n✓ Scoring complete`);
  console.log(`  High (8-10):    ${high} stories`);
  console.log(`  Mid  (5-7):     ${mid} stories`);
  console.log(`  Low  (1-4):     ${low} stories`);
  console.log(`  Human Check:    ${humanCheck.length} stories`);
  console.log(`  → ${high + mid} stories eligible for Agent 3`);

  return updates;
}

// ─── Score batch via Claude ───────────────────────────────────────────────────

async function scoreBatch(records) {
  const storyList = records.map(r => ({
    id: r.id,
    headline: r.fields["Headline"] || "",
    summary: (r.fields["Summary"] || "").slice(0, 300),
    source: r.fields["Source Name"] || "",
    keywords: r.fields["Keywords matched"] || "",
  }));

  const userMessage = `Score these ${storyList.length} stories for Interview Kickstart:\n\n${JSON.stringify(storyList, null, 2)}`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: SCORE_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const raw = response.content[0].text.trim();
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const scored = JSON.parse(cleaned);

    // Fill in any missing records with default score
    const scoredIds = new Set(scored.map(s => s.id));
    const missing = records.filter(r => !scoredIds.has(r.id));
    if (missing.length > 0) {
      console.warn(`  ⚠ ${missing.length} stories not scored — defaulting to score 3`);
      missing.forEach(r => scored.push({ id: r.id, score: 3, status: "Scored" }));
    }

    // Log each result
    scored.forEach(({ id, score, status }) => {
      const record = records.find(r => r.id === id);
      const headline = record?.fields["Headline"]?.slice(0, 55) || id;
      const flag = status === "Human Check" ? " 👁 HUMAN CHECK" : "";
      console.log(`    [${score}/10] ${headline}${flag}`);
    });

    return scored;

  } catch (err) {
    console.warn(`  ⚠ Scoring failed: ${err.message}`);
    return records.map(r => ({ id: r.id, score: 3, status: "Scored" }));
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ─── Entrypoint ───────────────────────────────────────────────────────────────

if (process.argv[1].endsWith("agent2_score.js")) {
  runAgent2()
    .then(() => { console.log("\n✓ Agent 2 complete\n"); process.exit(0); })
    .catch(err => { console.error("\n✗ Agent 2 failed:", err.message); process.exit(1); });
}
