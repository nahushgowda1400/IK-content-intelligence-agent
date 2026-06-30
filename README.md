# Content Intelligence Agent

A six-agent content pipeline that turns industry news into published, internally-linked, SEO-ready articles, with editorial judgment built into the architecture rather than bolted on after.

Built and run in production for [Interview Kickstart](https://interviewkickstart.com), an ed-tech platform. This repository is a sanitized version: real credentials, internal business logic, and proprietary editorial strategy have been removed or genericized. The orchestration code is exactly what runs in production.

## Why this exists

Most "AI content automation" is a prompt that writes a draft. This is different: it's a pipeline with **checkpoints**, every story gets scored before it's researched, every research brief gets reviewed before it's written, every article gets a "Human Check" flag if the system itself isn't confident. The goal isn't to remove editorial judgment, it's to spend that judgment only where it actually matters, and automate everything around it.

## How it works

```
Agent 1: Fetch        →  Pulls RSS + Reddit sources, deduplicates by headline similarity
Agent 2: Score         →  Claude scores each story 1-10 for editorial relevance, flags ambiguous ones for human review
Agent 3: Research      →  Triages scored stories, writes a structured research brief for the top candidates
Agent 4a: Write         →  Claude Sonnet writes a full article from the brief, with live web search for current data
Agent 4b: Link          →  Crawls the site's own sitemaps fresh each run, inserts relevant internal links
Agent 4c: Format        →  Converts the final markdown into publish-ready HTML
```

Each stage reads and writes its state to Airtable, so the pipeline can stop, resume, or be inspected mid-run. A daily summary email reports what was fetched, scored, selected, rejected, and flagged, with the generated articles attached.

## What's real here

- **The orchestration**: `run_pipeline.js` and all six `agent*.js` files are the actual production code, unedited beyond removing secrets.
- **The output**: [`sample-article.md`](https://github.com/nahushgowda1400/IK-content-intelligence-agent/blob/main/sample-article.md) is a real article this pipeline generated end to end, including the internal links Agent 4b inserted (you can click them, they're live).
- **The research brief**: [`sample-research-brief.txt`](https://github.com/nahushgowda1400/IK-content-intelligence-agent/blob/main/sample-research-brief.txt) is the real brief that produced that article, with company-specific product names swapped for generic placeholders (the structure and reasoning are untouched).

## What's been removed

- All API keys, tokens, and service account credentials (see `.env.example` for the shape, not the values)
- Real employee names and email addresses, replaced with an env-configured recipient list
- The two prompt files (`score_prompt.txt`, `research_prompt.txt`) aren't included here. They encode editorial judgment calls and product-positioning language that belong to the company this was built for. A representative excerpt is shown on my portfolio's AI Systems page instead.
- All other generated articles and research briefs beyond the single example above, those are live content assets tied to an active editorial calendar, not mine to redistribute.

## Stack

Node.js · Claude (Haiku for scoring, Sonnet for research and writing, with live web search) · Airtable as the pipeline's state store · Gmail/Nodemailer for reporting · node-cron for scheduling

## Setup

```bash
npm install
cp .env.example .env   # fill in your own keys
npm run pipeline       # runs all six agents in sequence
npm run cron           # schedules a daily 9am run
```

---

Part of Nahush Gowda's AI content systems work, built alongside a portfolio site covering the content cluster map this pipeline feeds.
