// agents/agent3_research.js
// Agent 3:
//   - Triages all "Scored" stories: 6+ → Selected, 5 and below → Rejected
//   - Takes top 2 Selected stories → writes research brief → saves as .txt file → updates Airtable

import "dotenv/config";
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { getAllRecords, updateRecords } from "../lib/airtable.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const RAW_STORIES_BASE = { baseId: process.env.AIRTABLE_BASE_ID_RAW_STORIES };

const TOP_N = 3;
const SELECT_THRESHOLD = 6;

// Research briefs saved here
const BRIEFS_DIR = path.join(process.cwd(), "briefs");

const RESEARCH_PROMPT = fs.readFileSync(
  path.join(process.cwd(), "prompts/research_prompt.txt"),
  "utf-8"
);

// ─── Main ──────────────────────────────────────────────────────────────────────

export async function runAgent3() {
  console.log("\n━━━ Agent 3: Triage + Research ━━━");

  // Create briefs folder if it doesn't exist
  if (!fs.existsSync(BRIEFS_DIR)) {
    fs.mkdirSync(BRIEFS_DIR, { recursive: true });
    console.log("→ Created briefs/ folder");
  }

  // 1. Load ALL "Scored" stories
  const scoredRecords = await getAllRecords(process.env.AIRTABLE_RAW_STORIES_TABLE, {
    ...RAW_STORIES_BASE,
    filterByFormula: `{Status} = "Scored"`,
    fields: ["Headline", "Summary", "Source Name", "Keywords matched", "Relevance Score", "BU Tags"],
  });

  console.log(`→ Found ${scoredRecords.length} Scored stories to triage`);

  if (scoredRecords.length === 0) {
    console.log("  Nothing to triage. Exiting.");
    return;
  }

  // 2. Split into Selected and Rejected
  const selected = scoredRecords.filter(r => (r.fields["Relevance Score"] || 0) >= SELECT_THRESHOLD);
  const rejected = scoredRecords.filter(r => (r.fields["Relevance Score"] || 0) < SELECT_THRESHOLD);

  console.log(`→ Triage results:`);
  console.log(`   Selected (score >= ${SELECT_THRESHOLD}): ${selected.length} stories`);
  console.log(`   Rejected (score < ${SELECT_THRESHOLD}):  ${rejected.length} stories`);

  // 3. Bulk update Rejected
  if (rejected.length > 0) {
    const rejectUpdates = rejected.map(r => ({ id: r.id, fields: { Status: "Rejected" } }));
    await updateRecords(process.env.AIRTABLE_RAW_STORIES_TABLE, rejectUpdates, RAW_STORIES_BASE);
    console.log(`→ Marked ${rejected.length} stories as Rejected`);
  }

  if (selected.length === 0) {
    console.log("  No stories selected for research. Exiting.");
    return;
  }

  // 4. Mark all Selected in Airtable
  const selectUpdates = selected.map(r => ({ id: r.id, fields: { Status: "Selected" } }));
  await updateRecords(process.env.AIRTABLE_RAW_STORIES_TABLE, selectUpdates, RAW_STORIES_BASE);
  console.log(`→ Marked ${selected.length} stories as Selected`);

  // 5. Take top N by score for research
  const sorted = selected.sort(
    (a, b) => (b.fields["Relevance Score"] || 0) - (a.fields["Relevance Score"] || 0)
  );
  const topStories = sorted.slice(0, TOP_N);
  console.log(`→ Writing research briefs for top ${topStories.length} stories`);

  // 6. Generate brief and save as .txt for each top story
  const docUpdates = [];

  for (const record of topStories) {
    const headline = record.fields["Headline"] || "Untitled";
    const score = record.fields["Relevance Score"];
    console.log(`\n  Researching [${score}/10]: ${headline.slice(0, 60)}`);

    // Generate brief via Claude
    const brief = await generateBrief(record);
    console.log(`    → Brief generated (${brief.length} chars)`);

    // Save to local .txt file
    const filePath = saveBrief(record.id, headline, brief);
    console.log(`    → Saved: ${filePath}`);

    docUpdates.push({
      id: record.id,
      fields: {
        "Research and Content Brief Doc Link": filePath,
        Status: "Research Done",
      },
    });
  }

  // 7. Write file paths back to Airtable
  if (docUpdates.length > 0) {
    await updateRecords(process.env.AIRTABLE_RAW_STORIES_TABLE, docUpdates, RAW_STORIES_BASE);
    console.log(`\n→ File paths written to ${docUpdates.length} Airtable records`);
  }

  console.log(`\n✓ Agent 3 complete`);
  console.log(`   ${rejected.length} Rejected`);
  console.log(`   ${selected.length} Selected`);
  console.log(`   ${topStories.length} Research briefs saved to briefs/`);

  return { selected, rejected, topStories };
}

// ─── Generate Research Brief via Claude ───────────────────────────────────────

async function generateBrief(record) {
  const story = {
    headline: record.fields["Headline"] || "",
    summary: record.fields["Summary"] || "",
    source: record.fields["Source Name"] || "",
    keywords: record.fields["Keywords matched"] || "",
    buTags: record.fields["BU Tags"] || [],
    score: record.fields["Relevance Score"] || 0,
  };

  const userMessage = `Write a research brief for this news story:\n\n${JSON.stringify(story, null, 2)}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    system: RESEARCH_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  return response.content[0].text.trim();
}

// ─── Save Brief as .txt ────────────────────────────────────────────────────────

function saveBrief(recordId, headline, brief) {
  const today = new Date().toISOString().split("T")[0];

  // Clean headline for use as filename
  const safeHeadline = headline
    .replace(/[^a-z0-9 ]/gi, "")
    .replace(/\s+/g, "_")
    .slice(0, 60);

  const filename = `${today}_${safeHeadline}_${recordId}.txt`;
  const filePath = path.join(BRIEFS_DIR, filename);

  // Write full brief with header
  const content = [
    `INTERVIEW KICKSTART — RESEARCH BRIEF`,
    `Generated: ${new Date().toISOString()}`,
    `Airtable Record ID: ${recordId}`,
    `Headline: ${headline}`,
    ``,
    `${"=".repeat(80)}`,
    ``,
    brief,
  ].join("\n");

  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

if (process.argv[1].endsWith("agent3_research.js")) {
  runAgent3()
    .then(() => { console.log("\n✓ Agent 3 complete\n"); process.exit(0); })
    .catch(err => { console.error("\n✗ Agent 3 failed:", err.message); process.exit(1); });
}
