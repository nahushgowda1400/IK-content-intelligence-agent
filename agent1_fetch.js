// agents/agent1_fetch.js
// Agent 1: Reads sources → fetches RSS + Reddit JSON → deduplicates → writes to Raw Stories

import "dotenv/config";
import Parser from "rss-parser";
import { getAllRecords, createRecords } from "../lib/airtable.js";

const parser = new Parser({
  timeout: 10000,
  headers: { "User-Agent": "IK-MarketIntelligence/1.0 (RSS Reader)" },
  customFields: {
    item: [
      ["media:content", "mediaContent"],
      ["content:encoded", "contentEncoded"],
    ],
  },
});

const SOURCES_BASE = { baseId: process.env.AIRTABLE_BASE_ID_SOURCES };
const RAW_STORIES_BASE = { baseId: process.env.AIRTABLE_BASE_ID_RAW_STORIES };

const LOOKBACK_DAYS = 2;
const MAX_ITEMS_PER_SOURCE = 10;
const SIMILARITY_THRESHOLD = 0.75; // Headlines 75%+ similar = duplicate

// ─── Main ──────────────────────────────────────────────────────────────────────

export async function runAgent1() {
  console.log("\n━━━ Agent 1: Fetch RSS + Reddit Sources ━━━");

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - LOOKBACK_DAYS);
  console.log(`→ Fetching stories published after: ${cutoffDate.toDateString()}`);

  // 1. Load active RSS sources
  const sources = await getActiveSources();
  console.log(`→ Found ${sources.length} active sources`);
  if (sources.length === 0) { console.log("  No active sources. Exiting."); return; }

  // 2. Load existing URLs for deduplication
  const existingUrls = await getExistingStoryUrls();
  console.log(`→ ${existingUrls.size} existing stories in Raw Stories (for dedup)`);

  // 3. Fetch each source
  const newStories = [];

  for (const source of sources) {
    const { name, url, keywords } = source;
    console.log(`\n  Fetching: ${name}`);

    const isReddit = url.includes("reddit.com") && url.includes(".json");
    const items = isReddit
      ? await fetchReddit(url, cutoffDate)
      : await fetchRSS(url, cutoffDate);

    console.log(`    → ${items.length} items within last ${LOOKBACK_DAYS} days`);

    for (const item of items) {
      if (existingUrls.has(item.url)) continue;

      const matchedKeywords = matchKeywords(item, keywords);
      if (keywords.length > 0 && matchedKeywords.length === 0) continue;

      newStories.push(buildStoryRecord(item, source, matchedKeywords));
    }
  }

  // 4. Deduplicate by headline similarity across all fetched stories
  const deduped = deduplicateByHeadline(newStories);
  const removedCount = newStories.length - deduped.length;
  if (removedCount > 0) {
    console.log(`\n→ Removed ${removedCount} near-duplicate headlines`);
  }

  console.log(`\n→ ${deduped.length} new stories to write`);

  if (deduped.length === 0) {
    console.log("  Nothing new. Exiting.");
    return;
  }

  // 5. Write to Raw Stories
  const created = await createRecords(
    process.env.AIRTABLE_RAW_STORIES_TABLE,
    deduped,
    RAW_STORIES_BASE
  );
  console.log(`✓ Wrote ${created.length} new stories to Raw Stories`);
  return created;
}

// ─── Deduplication ────────────────────────────────────────────────────────────

function deduplicateByHeadline(stories) {
  const kept = [];

  for (const story of stories) {
    const isDuplicate = kept.some(
      (existing) => headlineSimilarity(existing.Headline, story.Headline) >= SIMILARITY_THRESHOLD
    );
    if (!isDuplicate) kept.push(story);
  }

  return kept;
}

// Jaccard similarity on word sets — simple, no dependencies
function headlineSimilarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(normalize(a).split(" ").filter(w => w.length > 3));
  const wordsB = new Set(normalize(b).split(" ").filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

// ─── RSS Fetcher ───────────────────────────────────────────────────────────────

async function fetchRSS(url, cutoffDate) {
  try {
    const feed = await parser.parseURL(url);
    return (feed.items || [])
      .filter(item => item.pubDate && new Date(item.pubDate) >= cutoffDate)
      .map(item => ({
        title: item.title?.trim() || "",
        url: item.link || item.guid || "",
        summary: extractRSSSummary(item),
        publishedDate: new Date(item.pubDate).toISOString().split("T")[0],
      }))
      .filter(item => item.url)
      .slice(0, MAX_ITEMS_PER_SOURCE);
  } catch (err) {
    console.warn(`    ⚠ RSS fetch failed for ${url}: ${err.message}`);
    return [];
  }
}

// ─── Reddit JSON Fetcher ───────────────────────────────────────────────────────

async function fetchReddit(url, cutoffDate) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "IK-MarketIntelligence/1.0 (market research bot)" },
    });
    if (!res.ok) { console.warn(`    ⚠ Reddit returned ${res.status}`); return []; }

    const data = await res.json();
    return (data?.data?.children || [])
      .map(child => {
        const post = child.data;
        const created = new Date(post.created_utc * 1000);
        return {
          title: post.title?.trim() || "",
          url: `https://www.reddit.com${post.permalink}`,
          summary: post.selftext
            ? post.selftext.replace(/\s+/g, " ").trim().slice(0, 500)
            : post.title,
          publishedDate: created.toISOString().split("T")[0],
          _created: created,
        };
      })
      .filter(item => item.url && item._created >= cutoffDate)
      .slice(0, MAX_ITEMS_PER_SOURCE)
      .map(({ _created, ...item }) => item);
  } catch (err) {
    console.warn(`    ⚠ Reddit fetch failed for ${url}: ${err.message}`);
    return [];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getActiveSources() {
  const records = await getAllRecords(process.env.AIRTABLE_SOURCES_TABLE, {
    ...SOURCES_BASE,
    filterByFormula: `AND({Active} = 1, {Type} = "RSS")`,
    fields: ["Source", "URL", "BU Tags", "Keywords to Filter"],
  });
  return records.map(r => ({
    id: r.id,
    name: r.fields["Source"] || "Unknown",
    url: r.fields["URL"] || "",
    buTags: r.fields["BU Tags"] || [],
    keywords: parseKeywords(r.fields["Keywords to Filter"] || ""),
  }));
}

async function getExistingStoryUrls() {
  const records = await getAllRecords(process.env.AIRTABLE_RAW_STORIES_TABLE, {
    ...RAW_STORIES_BASE,
    fields: ["URL"],
  });
  return new Set(records.map(r => r.fields["URL"]).filter(Boolean));
}

function extractRSSSummary(item) {
  const raw = item.contentSnippet || item.contentEncoded || item.content || item.summary || "";
  return raw.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function parseKeywords(keywordString) {
  if (!keywordString) return [];
  return keywordString.split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
}

function matchKeywords(item, keywords) {
  if (keywords.length === 0) return [];
  const searchText = `${item.title} ${item.summary}`.toLowerCase();
  return keywords.filter(kw => searchText.includes(kw));
}

function buildStoryRecord(item, source, matchedKeywords) {
  const today = new Date().toISOString().split("T")[0];
  return {
    Headline: item.title,
    URL: item.url,
    Summary: item.summary,
    "Source Name": source.name,
    "Source Type": "RSS",
    "Keywords matched": matchedKeywords.join(", "),
    "Published Date": item.publishedDate || today,
    "Scraped Date": today,
    Status: "New",
  };
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

if (process.argv[1].endsWith("agent1_fetch.js")) {
  runAgent1()
    .then(() => { console.log("\n✓ Agent 1 complete\n"); process.exit(0); })
    .catch(err => { console.error("\n✗ Agent 1 failed:", err.message); process.exit(1); });
}
