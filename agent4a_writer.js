// agents/agent4a_writer.js
// Agent 4a: Reads research brief → writes full article in markdown with IK component markers

import "dotenv/config";
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { getAllRecords, updateRecords } from "../lib/airtable.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const RAW_STORIES_BASE = { baseId: process.env.AIRTABLE_BASE_ID_RAW_STORIES };

const ARTICLES_DIR = path.join(process.cwd(), "articles");
const BRIEFS_DIR = path.join(process.cwd(), "briefs");

const ARTICLE_PROMPT = fs.readFileSync(
  path.join(process.cwd(), "prompts/article_prompt.txt"),
  "utf-8"
);

// ─── Main ──────────────────────────────────────────────────────────────────────

export async function runAgent4a() {
  console.log("\n━━━ Agent 4a: Article Writer ━━━");

  // Ensure articles dir exists
  if (!fs.existsSync(ARTICLES_DIR)) fs.mkdirSync(ARTICLES_DIR, { recursive: true });

  const TOP_N = 3; // Only write top 3 articles per run

  // Load Research Done stories only
  const allRecords = await getAllRecords(process.env.AIRTABLE_RAW_STORIES_TABLE, {
    ...RAW_STORIES_BASE,
    filterByFormula: `AND({Status} = "Research Done", {Research and Content Brief Doc Link} != "")`,
    fields: ["Headline", "Research and Content Brief Doc Link", "Relevance Score"],
  });

  // Sort by score descending, take top 2
  const records = allRecords
    .sort((a, b) => (b.fields["Relevance Score"] || 0) - (a.fields["Relevance Score"] || 0))
    .slice(0, TOP_N);

  console.log(`→ Found ${allRecords.length} Research Done stories, writing top ${records.length}`);
  if (records.length === 0) { console.log("  Nothing to write. Exiting."); return; }

  const updates = [];

  for (const record of records) {
    const headline = record.fields["Headline"] || "Untitled";
    const briefPath = record.fields["Research and Content Brief Doc Link"];
    const score = record.fields["Relevance Score"];

    console.log(`\n  Writing [${score}/10]: ${headline.slice(0, 60)}`);

    // Read research brief
    if (!briefPath || !fs.existsSync(briefPath)) {
      console.warn(`    ⚠ Brief file not found: ${briefPath}`);
      continue;
    }
    const brief = fs.readFileSync(briefPath, "utf-8");

    // Generate article via Claude Sonnet with web search for latest context
    const article = await writeArticle(headline, brief);
    console.log(`    → Article written (${article.length} chars)`);

    // Save as .md file
    const mdPath = saveArticle(record.id, headline, article);
    console.log(`    → Saved: ${mdPath}`);

    updates.push({
      id: record.id,
      fields: {
        "Content File Doc Link": mdPath,
        Status: "Article Generated",
      },
    });
  }

  // Update Airtable
  if (updates.length > 0) {
    await updateRecords(process.env.AIRTABLE_RAW_STORIES_TABLE, updates, RAW_STORIES_BASE);
    console.log(`\n✓ Updated ${updates.length} records in Airtable`);
  }

  console.log("\n✓ Agent 4a complete");
  return updates;
}

// ─── Write Article via Claude ──────────────────────────────────────────────────

async function writeArticle(headline, brief) {
  const userMessage = `Write a complete IK blog article based on this research brief. The article is about: "${headline}"\n\nRESEARCH BRIEF:\n${brief}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    system: ARTICLE_PROMPT,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: userMessage }],
  });

  // Extract text from response — may include tool use blocks
  return response.content
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("\n")
    .trim();
}

// ─── Save Article ─────────────────────────────────────────────────────────────

function saveArticle(recordId, headline, content) {
  const today = new Date().toISOString().split("T")[0];
  const safeHeadline = headline
    .replace(/[^a-z0-9 ]/gi, "")
    .replace(/\s+/g, "_")
    .slice(0, 60);

  const filename = `${today}_${safeHeadline}_${recordId}.md`;
  const filePath = path.join(ARTICLES_DIR, filename);

  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

if (process.argv[1].endsWith("agent4a_writer.js")) {
  runAgent4a()
    .then(() => { console.log("\n✓ Agent 4a complete\n"); process.exit(0); })
    .catch(err => { console.error("\n✗ Agent 4a failed:", err.message); process.exit(1); });
}
