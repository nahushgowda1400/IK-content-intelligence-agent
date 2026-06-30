// agents/agent4b_linker.js
// Agent 4b: Reads article markdown → crawls IK sitemaps fresh → inserts interlinks → saves updated md

import "dotenv/config";
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { getAllRecords, updateRecords } from "../lib/airtable.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const RAW_STORIES_BASE = { baseId: process.env.AIRTABLE_BASE_ID_RAW_STORIES };
const ARTICLES_DIR = path.join(process.cwd(), "articles");

// IK sitemaps to crawl each run
const SITEMAPS = [
  "https://interviewkickstart.com/articles-sitemap.xml",
  "https://interviewkickstart.com/career-advice-sitemap.xml",
  "https://interviewkickstart.com/interview-questions-sitemap.xml",
  "https://interviewkickstart.com/post-sitemap.xml",
  "https://interviewkickstart.com/ai-glossary-sitemap.xml",
];

const MAX_LINKS = 8;       // Max interlinks per article
const MAX_SITEMAP_URLS = 200; // Cap per sitemap to control tokens

// ─── Main ──────────────────────────────────────────────────────────────────────

export async function runAgent4b() {
  console.log("\n━━━ Agent 4b: Internal Linker ━━━");

  // 1. Crawl all sitemaps fresh
  console.log("→ Crawling IK sitemaps...");
  const allUrls = await crawlSitemaps();
  console.log(`→ Loaded ${allUrls.length} IK URLs for linking`);

  // 2. Load articles ready for linking — only local files (not Google Docs from old pipeline)
  const allRecords = await getAllRecords(process.env.AIRTABLE_RAW_STORIES_TABLE, {
    ...RAW_STORIES_BASE,
    filterByFormula: `AND({Status} = "Article Generated", {Content File Doc Link} != "")`,
    fields: ["Headline", "Content File Doc Link", "Relevance Score"],
  });

  // Filter to only local .md files — skip any Google Docs URLs from old pipeline
  const records = allRecords
    .filter(r => {
      const p = r.fields["Content File Doc Link"] || "";
      return !p.startsWith("http") && p.endsWith(".md");
    })
    .sort((a, b) => (b.fields["Relevance Score"] || 0) - (a.fields["Relevance Score"] || 0))
    .slice(0, 3); // Max 3 per run

  console.log(`→ Found ${allRecords.length} Article Generated records, processing ${records.length} local files`);
  if (records.length === 0) { console.log("  Nothing to link. Exiting."); return; }

  const updates = [];

  for (const record of records) {
    const headline = record.fields["Headline"] || "Untitled";
    const mdPath = record.fields["Content File Doc Link"];

    console.log(`\n  Linking: ${headline.slice(0, 60)}`);

    // Skip Google Docs URLs from old Postman pipeline
    if (!mdPath || mdPath.startsWith('http')) {
      console.warn(`    ⚠ Skipping non-local path: ${mdPath?.slice(0, 60)}`);
      continue;
    }
    if (!fs.existsSync(mdPath)) {
      console.warn(`    ⚠ File not found: ${mdPath}`);
      continue;
    }

    const articleMd = fs.readFileSync(mdPath, "utf-8");

    // Filter urls relevant to this article's topic using Haiku
    const relevantUrls = await filterRelevantUrls(headline, articleMd, allUrls);
    console.log(`    → ${relevantUrls.length} relevant URLs identified`);

    // Insert interlinks into the article
    const linkedMd = await insertInterlinks(articleMd, relevantUrls);
    console.log(`    → Interlinks inserted`);

    // Save updated article (overwrite same file)
    fs.writeFileSync(mdPath, linkedMd, "utf-8");
    console.log(`    → Saved: ${mdPath}`);

    updates.push({
      id: record.id,
      fields: { Status: "Linked" },
    });
  }

  if (updates.length > 0) {
    await updateRecords(process.env.AIRTABLE_RAW_STORIES_TABLE, updates, RAW_STORIES_BASE);
    console.log(`\n→ Updated ${updates.length} records in Airtable`);
  }

  console.log("\n✓ Agent 4b complete");
  return updates;
}

// ─── Crawl Sitemaps ───────────────────────────────────────────────────────────

async function crawlSitemaps() {
  const allUrls = [];

  for (const sitemapUrl of SITEMAPS) {
    try {
      const res = await fetch(sitemapUrl, {
        headers: { "User-Agent": "IK-MarketIntelligence/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) { console.warn(`  ⚠ Failed: ${sitemapUrl}`); continue; }

      const xml = await res.text();

      // Extract URLs and slugs from sitemap XML
      const matches = [...xml.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/g)];
      const urls = matches
        .map(m => m[1].trim())
        .filter(u => !u.endsWith(".xml")) // skip nested sitemaps
        .slice(0, MAX_SITEMAP_URLS)
        .map(url => {
          // Extract slug words from URL for matching
          const slug = url.split("/").pop() || "";
          const words = slug.replace(/-/g, " ").replace(/[^a-z0-9 ]/gi, "").toLowerCase();
          return { url, slug, words };
        });

      allUrls.push(...urls);
      console.log(`  ✓ ${sitemapUrl.split("/").pop()}: ${urls.length} URLs`);
    } catch (err) {
      console.warn(`  ⚠ Sitemap error ${sitemapUrl}: ${err.message}`);
    }
  }

  return allUrls;
}

// ─── Filter Relevant URLs via Haiku ───────────────────────────────────────────

async function filterRelevantUrls(headline, articleMd, allUrls) {
  // First do a quick keyword pre-filter to reduce what we send to Claude
  const articleWords = new Set(
    articleMd.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 4)
  );

  // Score each URL by word overlap with article
  const scored = allUrls
    .map(item => {
      const slugWords = item.words.split(" ").filter(w => w.length > 4);
      const matches = slugWords.filter(w => articleWords.has(w)).length;
      return { ...item, matches };
    })
    .filter(item => item.matches > 0)
    .sort((a, b) => b.matches - a.matches)
    .slice(0, 40); // Send top 40 candidates to Claude

  if (scored.length === 0) return [];

  // Use Haiku to pick the best matches semantically
  const urlList = scored.map(u => `${u.url} | keywords: ${u.words}`).join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `Article topic: "${headline}"

From this list of IK URLs, pick the ${MAX_LINKS} most relevant ones for internal linking. 
The anchor text in the article should naturally match the URL slug's topic.
Return ONLY a JSON array of URLs, no explanation:

${urlList}`,
    }],
  });

  try {
    const raw = response.content[0].text.trim().replace(/```json|```/g, "").trim();
    const selected = JSON.parse(raw);
    return scored.filter(u => selected.includes(u.url));
  } catch {
    // Fallback: return top scored by keyword match
    return scored.slice(0, MAX_LINKS);
  }
}

// ─── Insert Interlinks into Article ───────────────────────────────────────────

async function insertInterlinks(articleMd, relevantUrls) {
  if (relevantUrls.length === 0) return articleMd;

  // Show slug as readable phrase so Haiku knows what anchor text to match
  const urlDescriptions = relevantUrls
    .map(u => {
      const slugPhrase = u.url.split("/").pop().replace(/-/g, " ");
      return `URL: ${u.url}\nAnchor must match: "${slugPhrase}"`;
    })
    .join("\n\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 6000,
    messages: [{
      role: "user",
      content: `You are an SEO expert adding internal links to a markdown article.

CRITICAL RULES — READ CAREFULLY:
- Return the COMPLETE article with ZERO content changes except adding markdown links
- Do NOT convert markdown to HTML — keep all markdown syntax exactly as-is
- Do NOT remove, rewrite, or summarise any content — every word must be preserved
- Do NOT touch IK component markers like [KEY_TAKEAWAYS], [TIP], [PITFALL], [TOC], [TLDR], [EXPERT_INSIGHT], [QNA], [RELATED_READS] — leave them completely intact with all their content
- The anchor text MUST closely match the URL slug words. Slug "machine-learning-engineer-salary" → anchor "machine learning engineer salary". If no close match exists, skip that URL
- Wrap anchor text in standard markdown link format: [anchor text](url)
- Do NOT link inside headings
- Each URL used at most once
- For the [RELATED_READS][/RELATED_READS] section, replace its contents with a markdown list of the URLs using slug phrases as link text

URLS TO LINK:
${urlDescriptions}

ARTICLE (return this complete, with only markdown links added):
${articleMd}`,
    }],
  });

  return response.content[0].text.trim();
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

if (process.argv[1].endsWith("agent4b_linker.js")) {
  runAgent4b()
    .then(() => { console.log("\n✓ Agent 4b complete\n"); process.exit(0); })
    .catch(err => { console.error("\n✗ Agent 4b failed:", err.message); process.exit(1); });
}
