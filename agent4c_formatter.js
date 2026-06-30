// agents/agent4c_formatter.js
// Agent 4c: Reads linked markdown → converts to final IK-styled HTML → saves .html file

import "dotenv/config";
import fs from "fs";
import path from "path";
import { getAllRecords, updateRecords } from "../lib/airtable.js";

const RAW_STORIES_BASE = { baseId: process.env.AIRTABLE_BASE_ID_RAW_STORIES };
const ARTICLES_DIR = path.join(process.cwd(), "articles");

// ─── Main ──────────────────────────────────────────────────────────────────────

export async function runAgent4c() {
  console.log("\n━━━ Agent 4c: HTML Formatter ━━━");

  const allRecords = await getAllRecords(process.env.AIRTABLE_RAW_STORIES_TABLE, {
    ...RAW_STORIES_BASE,
    filterByFormula: `AND({Status} = "Linked", {Content File Doc Link} != "")`,
    fields: ["Headline", "Content File Doc Link", "Relevance Score"],
  });

  // Only process local .md files — skip old Google Docs URLs
  const records = allRecords
    .filter(r => {
      const p = r.fields["Content File Doc Link"] || "";
      return !p.startsWith("http") && p.endsWith(".md");
    })
    .sort((a, b) => (b.fields["Relevance Score"] || 0) - (a.fields["Relevance Score"] || 0))
    .slice(0, 3);

  console.log(`→ Found ${allRecords.length} Linked records, formatting ${records.length} local files`);
  if (records.length === 0) { console.log("  Nothing to format. Exiting."); return; }

  const updates = [];

  for (const record of records) {
    const headline = record.fields["Headline"] || "Untitled";
    const mdPath = record.fields["Content File Doc Link"];

    console.log(`\n  Formatting: ${headline.slice(0, 60)}`);

    if (!mdPath || mdPath.startsWith("http")) {
      console.warn(`    ⚠ Skipping non-local path`);
      continue;
    }
    if (!fs.existsSync(mdPath)) {
      console.warn(`    ⚠ File not found: ${mdPath}`);
      continue;
    }

    const markdown = fs.readFileSync(mdPath, "utf-8");
    const html = convertToHTML(headline, markdown);

    const htmlPath = mdPath.replace(".md", ".html");
    fs.writeFileSync(htmlPath, html, "utf-8");
    console.log(`    → HTML saved: ${htmlPath}`);

    updates.push({
      id: record.id,
      headline: headline,
      score: record.fields["Relevance Score"] || "",
      filePath: htmlPath,
      fields: {
        "Content File ID": htmlPath,
        Status: "HTML Ready",
      },
    });
  }

  if (updates.length > 0) {
    await updateRecords(process.env.AIRTABLE_RAW_STORIES_TABLE, updates, RAW_STORIES_BASE);
    console.log(`\n→ Updated ${updates.length} records in Airtable`);
  }

  console.log("\n✓ Agent 4c complete");
  return updates;
}

// ─── Main Converter ───────────────────────────────────────────────────────────

function convertToHTML(headline, markdown) {
  // Step 1: Process IK custom component markers → clean HTML blocks
  let html = markdown;
  html = processKeyTakeaways(html);
  html = processTOC(html);
  html = processTLDR(html);
  html = processTipBox(html);
  html = processPitfall(html);
  html = processExpertInsight(html);
  html = processQnA(html);
  html = processRelatedReads(html);

  // Step 2: Convert markdown to HTML — paragraph-aware so divs never get wrapped in <p>
  html = convertMarkdown(html);

  // Strip any em dashes or en dashes that slipped through from the writer
  html = html.replace(/—/g, ",").replace(/–/g, "-");

  return `<!-- IK Article: ${headline} -->\n<!-- Generated: ${new Date().toISOString()} -->\n\n${html.trim()}`;
}

// ─── IK Component Converters ──────────────────────────────────────────────────

function spacer() { return `\n<div style="height: 24px;"></div>\n`; }

function processKeyTakeaways(html) {
  return html.replace(/\[KEY_TAKEAWAYS\]([\s\S]*?)\[\/KEY_TAKEAWAYS\]/g, (_, content) => {
    const items = content.trim().split("\n")
      .filter(l => l.trim().match(/^[-*]/))
      .map(l => `      <li style="margin-bottom: 6px;">${l.replace(/^[-*]\s*/, "").trim()}</li>`)
      .join("\n");
    return spacer() + `<div style="max-width: 1000px; display: flex; gap: 12px; background-color: #f3f8ff; border-radius: 14px; padding: 22px 26px;">
  <div style="width: 4px; background-color: #2563eb; border-radius: 4px; flex-shrink: 0;"></div>
  <div style="flex: 1;">
    <div style="font-weight: bold; font-size: 22px; color: #111827; margin-bottom: 14px;">Key Takeaways</div>
    <ul style="margin: 0; padding-left: 18px; color: #1f2937;">
${items}
    </ul>
  </div>
</div>` + spacer();
  });
}

function processTOC(html) {
  return html.replace(/\[TOC\]([\s\S]*?)\[\/TOC\]/g, (_, content) => {
    const items = content.trim().split("\n")
      .filter(l => l.trim().match(/^[-*]/))
      .map(l => {
        const text = l.replace(/^[-*]\s*/, "").trim();
        const anchor = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
        return `    <li><a style="color: #1d4ed8; text-decoration: none;" href="#${anchor}">${text}</a></li>`;
      }).join("\n");
    return spacer() + `<section style="background-color: #f8fafc; border-radius: 14px; padding: 18px 20px; margin: 32px 0; border: 1px solid #e5e7eb;">
  <p style="margin: 0 0 12px 0; font-weight: 600; font-size: 1.1em;">Table of Contents</p>
  <ul style="margin: 0; padding-left: 18px; line-height: 1.6;">
${items}
  </ul>
</section>` + spacer();
  });
}

function processTLDR(html) {
  return html.replace(/\[TLDR\]([\s\S]*?)\[\/TLDR\]/g, (_, content) =>
    spacer() + `<div style="max-width: 1000px; background-color: #f4f7ff; border-left: 5px solid #3a6ee8; border-radius: 10px; padding: 12px 18px;">
  <div style="color: #1f2a44;">
    <span style="display: inline-block; background-color: #3a6ee8; color: #ffffff; padding: 2px 8px; border-radius: 6px; font-weight: 700; margin-bottom: 4px;">TL;DR</span><br>
    ${content.trim()}
  </div>
</div>` + spacer()
  );
}

function processTipBox(html) {
  return html.replace(/\[TIP\]([\s\S]*?)\[\/TIP\]/g, (_, content) =>
    `\n<div style="height: 16px;"></div>
<div style="max-width: 1000px; background-color: #f4f9f2; border-left: 6px solid #79a857; border-radius: 12px; padding: 24px 28px;">
  <div style="display: flex; align-items: center; gap: 10px; color: #79a857; margin-bottom: 10px; font-weight: 600;">
    <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background-color: #79a857; color: #ffffff; font-size: 13px; flex-shrink: 0;">💡</span>
    Bonus Tip
  </div>
  <div style="color: #3e5a2f;">${content.trim()}</div>
</div>
<div style="height: 16px;"></div>\n`
  );
}

function processPitfall(html) {
  return html.replace(/\[PITFALL\]([\s\S]*?)\[\/PITFALL\]/g, (_, content) =>
    spacer() + `<div style="max-width: 1000px; background-color: #fff7f5; border-left: 6px solid #d16b5a; border-radius: 12px; padding: 28px 32px;">
  <div style="display: flex; align-items: center; gap: 10px; color: #d16b5a; margin-bottom: 10px; font-weight: 600;">
    <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background-color: #d16b5a; color: #ffffff; font-size: 13px; flex-shrink: 0;">⚠</span>
    Pitfalls to Watch For
  </div>
  <div style="color: #5a2f28;">${content.trim()}</div>
</div>` + spacer()
  );
}

function processExpertInsight(html) {
  return html.replace(/\[EXPERT_INSIGHT title="([^"]+)"\]([\s\S]*?)\[\/EXPERT_INSIGHT\]/g, (_, title, content) =>
    spacer() + `<div style="max-width: 1000px; background-color: #f7f9fc; border-left: 6px solid #2fa4a9; border-radius: 12px; padding: 28px 32px;">
  <div style="display: flex; align-items: center; gap: 10px; color: #2fa4a9; margin-bottom: 10px; font-weight: 600;">
    <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background-color: #2fa4a9; color: #ffffff; font-size: 13px; flex-shrink: 0;">i</span>
    Expert Insight
  </div>
  <div style="color: #0b1b3f; margin-bottom: 14px; font-weight: 700; font-size: 20px;">${title}</div>
  <div style="color: #2c2c2c;">${content.trim()}</div>
</div>` + spacer()
  );
}

function processQnA(html) {
  return html.replace(/\[QNA question="([^"]+)"(?:\s+attribution="([^"]+)")?\]([\s\S]*?)\[\/QNA\]/g, (_, question, attribution, content) =>
    spacer() + `<div style="max-width: 1000px; background-color: #f7f9fc; border-left: 6px solid #1f4fd8; border-radius: 12px; padding: 28px 32px;">
  <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px; color: #1f4fd8; font-weight: 600;">
    <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background-color: #1f4fd8; color: #ffffff; font-size: 13px; flex-shrink: 0;">?</span>
    Question
  </div>
  <div style="color: #0b1b3f; margin-bottom: 16px; font-weight: 700;">${question}</div>
  <div style="color: #2c2c2c; margin-bottom: 20px;">${content.trim()}</div>
  ${attribution ? `<div style="color: #5c6b8a; text-align: right; font-style: italic;">— ${attribution}</div>` : ""}
</div>` + spacer()
  );
}

function processRelatedReads(html) {
  return html.replace(/\[RELATED_READS\]([\s\S]*?)\[\/RELATED_READS\]/g, (_, content) => {
    const links = content.trim().split("\n")
      .map(l => {
        const match = l.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (match) return `      <li style="margin-bottom: 8px;"><a style="color: #1d4ed8; text-decoration: none;" href="${match[2]}">${match[1]}</a></li>`;
        const urlMatch = l.match(/https?:\/\/\S+/);
        if (urlMatch) {
          const label = urlMatch[0].split("/").pop().replace(/-/g, " ");
          return `      <li style="margin-bottom: 8px;"><a style="color: #1d4ed8; text-decoration: none;" href="${urlMatch[0]}">${label}</a></li>`;
        }
        return "";
      }).filter(Boolean).join("\n");

    return spacer() + `<div style="display: flex; gap: 18px; margin: 40px 0; padding: 22px 26px; background: rgba(15,23,42,0.02); border-radius: 10px;">
  <div style="width: 4px; background: #2563eb; border-radius: 4px;"></div>
  <div style="flex: 1;">
    <div style="font-size: 16px; font-weight: 600; color: #2563eb; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 10px;">Related Reads</div>
    <ul style="margin: 0; padding-left: 18px; line-height: 1.8;">
${links}
    </ul>
  </div>
</div>` + spacer();
  });
}

// ─── Markdown Converter — div-safe ────────────────────────────────────────────

function convertMarkdown(md) {
  // Split into blocks — process each block independently
  // Blocks separated by blank lines
  const blocks = md.split(/\n{2,}/);
  const output = blocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return "";

    // Already an HTML block — pass through untouched
    if (trimmed.startsWith("<")) return trimmed;

    // Heading lines
    if (trimmed.startsWith("### ")) return `<h3>${inlineMarkdown(trimmed.slice(4))}</h3>`;
    if (trimmed.startsWith("## ")) {
      const text = trimmed.slice(3);
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
      return `<h2 id="${id}">${inlineMarkdown(text)}</h2>`;
    }
    if (trimmed.startsWith("# ")) return `<h1>${inlineMarkdown(trimmed.slice(2))}</h1>`;

    // Horizontal rule
    if (trimmed === "---") return `<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">`;

    // Unordered list block
    if (trimmed.split("\n").every(l => l.trim().match(/^[-*] /))) {
      const items = trimmed.split("\n")
        .map(l => `  <li style="margin-bottom: 6px;">${inlineMarkdown(l.replace(/^[-*] /, "").trim())}</li>`)
        .join("\n");
      return `<ul style="padding-left: 18px; color: #1f2937;">\n${items}\n</ul>`;
    }

    // Ordered list block
    if (trimmed.split("\n").every(l => l.trim().match(/^\d+\. /))) {
      const items = trimmed.split("\n")
        .map(l => `  <li style="margin-bottom: 6px;">${inlineMarkdown(l.replace(/^\d+\. /, "").trim())}</li>`)
        .join("\n");
      return `<ol style="padding-left: 18px; color: #1f2937;">\n${items}\n</ol>`;
    }

    // Table block
    if (trimmed.includes("|") && trimmed.includes("\n")) {
      const rows = trimmed.split("\n").filter(r => !r.match(/^\|[-:| ]+\|$/));
      if (rows.length >= 2) {
        const headerCells = rows[0].split("|").filter(c => c.trim())
          .map(c => `<th style="border: 1px solid #ccc; padding: 10px; text-align: left;">${inlineMarkdown(c.trim())}</th>`)
          .join("");
        const bodyRows = rows.slice(1).map(r => {
          const cells = r.split("|").filter(c => c.trim())
            .map(c => `<td style="border: 1px solid #ccc; padding: 10px;">${inlineMarkdown(c.trim())}</td>`)
            .join("");
          return `  <tr>${cells}</tr>`;
        }).join("\n");
        return `<table style="width: 100%; border-collapse: collapse;">\n  <thead><tr style="background-color: #f0f4ff;">${headerCells}</tr></thead>\n  <tbody>\n${bodyRows}\n  </tbody>\n</table>`;
      }
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      return `<blockquote style="font-size: 1.3em; font-style: italic; color: #333; border-left: 4px solid #f4c542; padding: 16px 20px; margin: 20px 0; background: #fff7e0; border-radius: 4px;">${inlineMarkdown(trimmed.slice(2))}</blockquote>`;
    }

    // Plain paragraph — multi-line paragraphs joined
    const lines = trimmed.split("\n").map(l => inlineMarkdown(l.trim())).join(" ");
    return `<p>${lines}</p>`;
  });

  return output.filter(Boolean).join("\n\n");
}

// Inline markdown — bold, italic, code, links only — no block elements
function inlineMarkdown(text) {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: #1d4ed8;">$1</a>');
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

if (process.argv[1].endsWith("agent4c_formatter.js")) {
  runAgent4c()
    .then(() => { console.log("\n✓ Agent 4c complete\n"); process.exit(0); })
    .catch(err => { console.error("\n✗ Agent 4c failed:", err.message); process.exit(1); });
}
