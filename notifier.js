// lib/notifier.js
// Sends daily pipeline summary via Gmail with HTML attachments

import nodemailer from "nodemailer";
import fs from "fs";

// Recipients are configured via env, not hardcoded.
// Example: RECIPIENT_EMAILS="you@company.com,teammate@company.com"
const RECIPIENTS = (process.env.RECIPIENT_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean);

export async function sendSummaryEmail(summary) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_FROM,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  const { date, fetched, scored, selected, rejected, humanCheck, briefs, articles, htmlFiles, headlines, errors } = summary;

  // Build attachments from HTML files
  const attachments = (headlines || [])
    .filter(h => h.filePath && fs.existsSync(h.filePath))
    .map(h => ({
      filename: h.filePath.split("\\").pop(),
      path: h.filePath,
      contentType: "text/html",
    }));

  const headlineRows = (headlines || []).length > 0
    ? (headlines || []).map((h, i) => `
        <tr>
          <td style="padding: 14px 18px; border-bottom: 1px solid #e8f4f0;">
            <div style="font-weight: 600; color: #0f2a1e; font-size: 14px; line-height: 1.4;">${h.headline}</div>
          </td>
          <td style="padding: 14px 18px; border-bottom: 1px solid #e8f4f0; text-align: center; white-space: nowrap;">
            <span style="background: ${h.score >= 8 ? "#00e5a0" : "#f0c040"}; color: ${h.score >= 8 ? "#0a2e20" : "#3d2e00"}; padding: 4px 10px; border-radius: 20px; font-size: 13px; font-weight: 700;">${h.score}/10</span>
          </td>
          <td style="padding: 14px 18px; border-bottom: 1px solid #e8f4f0; text-align: center; white-space: nowrap;">
            <span style="background: #1a3a2a; color: #00e5a0; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; letter-spacing: 0.05em;">📎 ATTACHED</span>
          </td>
        </tr>`).join("")
    : `<tr><td colspan="3" style="padding: 20px; text-align: center; color: #6b7280; font-size: 14px;">No articles generated today</td></tr>`;

  const errorBlock = errors && errors.length > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px;">
        <tr>
          <td style="background: #1a0a0a; border-left: 4px solid #ff5e3a; border-radius: 8px; padding: 18px 22px;">
            <div style="font-weight: 700; color: #ff5e3a; font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px;">⚠ Errors Detected</div>
            <div style="font-size: 13px; color: #ffb3a0; line-height: 1.6;">${errors.join("<br>")}</div>
          </td>
        </tr>
      </table>`
    : `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px;">
        <tr>
          <td style="background: #0a2e20; border-left: 4px solid #00e5a0; border-radius: 8px; padding: 18px 22px;">
            <div style="font-weight: 700; color: #00e5a0; font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase;">✓ Clean Run — No Errors</div>
          </td>
        </tr>
      </table>`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #060d0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background: #060d0a; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="620" cellpadding="0" cellspacing="0" style="max-width: 620px; width: 100%;">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0a2e20 0%, #0d3d28 60%, #061a10 100%); border-radius: 14px 14px 0 0; padding: 36px 36px 32px; position: relative; overflow: hidden;">
              <div style="font-family: monospace; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: #00e5a0; border: 1px solid rgba(0,229,160,0.3); display: inline-block; padding: 4px 12px; border-radius: 2px; margin-bottom: 16px;">Daily Pipeline Report</div>
              <div style="font-size: 28px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; margin-bottom: 4px;">IK Market Intelligence</div>
              <div style="font-size: 14px; color: #4d9e7a;">${date}</div>
              <!-- Decorative circle -->
              <div style="position: absolute; top: -40px; right: -40px; width: 160px; height: 160px; background: radial-gradient(circle, rgba(0,229,160,0.12) 0%, transparent 70%); border-radius: 50%;"></div>
            </td>
          </tr>

          <!-- Stats Grid -->
          <tr>
            <td style="background: #0d1a12; padding: 28px 36px 24px;">
              <div style="font-family: monospace; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: #4d9e7a; margin-bottom: 18px;">01 — Pipeline Stats</div>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  ${miniStat("Stories Fetched", fetched, "#00e5a0", "#0a2e20")}
                  <td width="8"></td>
                  ${miniStat("Scored", scored, "#3a9fd8", "#0a1e2e")}
                  <td width="8"></td>
                  ${miniStat("Selected", selected, "#00e5a0", "#0a2e20")}
                </tr>
                <tr><td colspan="5" height="8"></td></tr>
                <tr>
                  ${miniStat("Rejected", rejected, "#ff5e3a", "#2e0a0a")}
                  <td width="8"></td>
                  ${miniStat("Human Check", humanCheck, "#f0c040", "#2e2a0a")}
                  <td width="8"></td>
                  ${miniStat("HTML Files", htmlFiles, "#00e5a0", "#0a2e20")}
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="background: #0d1a12; padding: 0 36px;">
              <div style="height: 1px; background: linear-gradient(90deg, transparent, #1e3528, transparent);"></div>
            </td>
          </tr>

          <!-- Articles Table -->
          <tr>
            <td style="background: #0d1a12; padding: 24px 36px 28px;">
              <div style="font-family: monospace; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: #4d9e7a; margin-bottom: 18px;">02 — Articles Generated Today</div>
              <table width="100%" cellpadding="0" cellspacing="0" style="background: #0a120d; border-radius: 10px; overflow: hidden; border: 1px solid #1e3528;">
                <tr style="background: #0f1f16;">
                  <th style="padding: 12px 18px; text-align: left; font-size: 11px; color: #4d9e7a; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; font-family: monospace;">Headline</th>
                  <th style="padding: 12px 18px; text-align: center; font-size: 11px; color: #4d9e7a; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; font-family: monospace; white-space: nowrap;">Score</th>
                  <th style="padding: 12px 18px; text-align: center; font-size: 11px; color: #4d9e7a; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; font-family: monospace;">File</th>
                </tr>
                ${headlineRows}
              </table>
              ${attachments.length > 0 ? `<div style="margin-top: 12px; font-size: 12px; color: #4d9e7a; font-family: monospace;">↳ ${attachments.length} HTML file${attachments.length > 1 ? "s" : ""} attached to this email</div>` : ""}
            </td>
          </tr>

          <!-- Error/Success -->
          <tr>
            <td style="background: #0d1a12; padding: 0 36px 28px;">
              ${errorBlock}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #060d0a; border-radius: 0 0 14px 14px; padding: 18px 36px; border-top: 1px solid #1e3528;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family: monospace; font-size: 11px; color: #2d5c42;">Sent automatically · IK Market Intelligence Pipeline</td>
                  <td align="right" style="font-family: monospace; font-size: 11px; color: #2d5c42;">interviewkickstart.com</td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;

  await transporter.sendMail({
    from: `"IK Market Intelligence" <${process.env.GMAIL_FROM}>`,
    to: RECIPIENTS.join(", "),
    subject: `[IK Pipeline] ${date} — ${articles || 0} article${articles !== 1 ? "s" : ""} generated`,
    html,
    attachments,
  });

  console.log(`✓ Email sent to ${RECIPIENTS.length} recipients${attachments.length > 0 ? ` with ${attachments.length} HTML attachment${attachments.length > 1 ? "s" : ""}` : ""}`);
}

function miniStat(label, value, color, bg) {
  return `<td style="background: ${bg}; border: 1px solid ${color}22; border-radius: 8px; padding: 14px 16px; text-align: center; width: 33%;">
    <div style="font-size: 28px; font-weight: 800; color: ${color}; line-height: 1; font-family: monospace;">${value ?? 0}</div>
    <div style="font-size: 11px; color: #4d9e7a; margin-top: 4px; letter-spacing: 0.05em;">${label}</div>
  </td>`;
}
