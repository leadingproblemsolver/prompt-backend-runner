import type { ResearchResult } from "./schema";

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function safeHref(u: unknown): string | null {
  if (typeof u !== "string") return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

const link = (u: unknown, label?: unknown) => {
  const h = safeHref(u);
  return h ? `<a href="${esc(h)}" rel="noopener noreferrer">${esc(label ?? h)}</a>` : esc(label ?? u ?? "Unknown");
};
const unk = (v: unknown) => (v == null || v === "" ? `<em>Unknown</em>` : esc(v));

export function reportFilename(d = new Date()) {
  return `project-to-prospects-${d.toISOString().slice(0, 10)}.html`;
}

export function buildReportHtml(r: ResearchResult): string {
  const { report, input } = r;
  const byId = new Map(report.prospects.map((p) => [p.id, p]));
  const prospects = report.prospects.map((p, i) => `
<section class="card">
  <h3>${i + 1}. ${esc(p.company)}</h3>
  <p><b>Website:</b> ${p.website ? link(p.website) : "<em>Unknown</em>"}</p>
  <p><b>Person / role:</b> ${unk(p.person)} — ${unk(p.role)} <span class="muted">(purchase authority: Unknown)</span></p>
  <p><b>Why they fit (hypothesis):</b> ${esc(p.fitReason)}</p>
  <p><b>Observed signal:</b> ${unk(p.observedSignal)} <span class="muted">Date: ${unk(p.signalDate)}</span></p>
  <p><b>Still assumed:</b></p><ul>${p.assumptions.map((a) => `<li>${esc(a)}</li>`).join("") || "<li><em>None listed</em></li>"}</ul>
  <p><b>Contact route:</b> ${unk(p.contactRoute.type)}: ${unk(p.contactRoute.value)}${p.contactRoute.sourceUrl ? ` (source: ${link(p.contactRoute.sourceUrl, "link")})` : ""}<br><span class="muted">${esc(p.contactRoute.verificationLimit)}</span></p>
  <p><b>Sample idea:</b> ${unk(p.sampleIdea)}</p>
  <p><b>Sources (web search citations):</b></p>
  <ol>${p.sources.map((s) => `<li>${link(s.url, s.title || s.url)}${s.supports ? ` — <span class="muted">supports: “${esc(s.supports)}”</span>` : ""}</li>`).join("")}</ol>
</section>`).join("");

  const packs = report.outreachPacks.map((o) => `
<section class="card">
  <h3>${esc(byId.get(o.prospectId)?.company ?? o.prospectId)}</h3>
  <p><b>Message (${esc(input.channel)}):</b></p><pre>${esc(o.message)}</pre>
  <p><b>Ask:</b> ${esc(o.ask)}</p>
  <table><thead><tr><th>Time</th><th>Screen</th><th>Narration</th></tr></thead><tbody>
  ${o.loomSegments.map((s) => `<tr><td>${esc(s.seconds)}</td><td>${esc(s.screen)}</td><td>${esc(s.narration)}</td></tr>`).join("")}
  </tbody></table>
</section>`).join("");

  const fa = report.firstAction;
  const tracker = (report.outreachPacks.length ? report.outreachPacks.map((o) => byId.get(o.prospectId)?.company ?? "") : ["", "", ""])
    .map((c) => `<tr><td>${esc(c)}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project → Prospects — Research shortlist</title>
<style>
body{font:15px/1.55 Georgia,"Times New Roman",serif;color:#1d1b16;background:#faf7f0;max-width:860px;margin:0 auto;padding:32px 20px}
h1{font-size:28px;margin:0 0 4px}h2{border-bottom:2px solid #1d1b16;padding-bottom:4px;margin-top:36px}h3{margin:0 0 8px}
.card{background:#fff;border:1px solid #d9d2c3;border-radius:8px;padding:16px 18px;margin:14px 0;break-inside:avoid}
.muted{color:#6b6457;font-size:13px}pre{white-space:pre-wrap;font:14px/1.5 ui-monospace,Menlo,monospace;background:#f3efe5;padding:10px;border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #d9d2c3;padding:6px;text-align:left;vertical-align:top}
a{color:#7a3b12}.note{background:#fff4d6;border:1px solid #e6cf8f;padding:10px 14px;border-radius:6px}
@media print{body{background:#fff;padding:0}.card{border-color:#999}a::after{content:" (" attr(href) ")";font-size:11px;color:#555}}
</style></head><body>
<h1>Research shortlist</h1>
<p class="muted">Project → Prospects · Researched ${esc(r.researchedAt)} · Model ${esc(r.model)}</p>
<p class="note">This is a research shortlist, not proof of demand or guaranteed contactability. Sources are web search citations; everything else is the model's summary or hypothesis.</p>
<h2>Your capability and scope (your claims)</h2>
<p><b>Project/service:</b> ${esc(input.project)}</p><p><b>Proof/demo (not inspected):</b> ${esc(input.proof)}</p>
<p><b>Deliverable:</b> ${esc(input.deliverable)}</p><p><b>Limitations:</b> ${esc(input.limitations)}</p>
<p><b>Geography:</b> ${esc(input.geography)} · <b>Evidence:</b> ${esc(input.evidence)} · <b>Channel:</b> ${esc(input.channel)}</p>
<h2>Customer segment</h2>
<p>${esc(report.segment.description)}</p><p><b>Buyer role:</b> ${esc(report.segment.buyerRole)}</p><p><b>Why it fits:</b> ${esc(report.segment.fitReason)}</p>
<p><b>Exclude:</b></p><ul>${report.segment.exclusions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
<h2>Prospects (${report.prospects.length})</h2>${prospects || "<p><em>No prospects could be backed by sources.</em></p>"}
<h2>Outreach and Loom scripts</h2>${packs || "<p><em>None — no qualified prospects.</em></p>"}
<h2>Recommended first action</h2>
<p><b>${esc(fa.prospectId ? byId.get(fa.prospectId)?.company ?? "" : "Discovery")}</b> — ${esc(fa.action)}</p><p>${esc(fa.reason)}</p>
<h2>Limitations</h2><ul>${report.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
${r.searchQueries.length ? `<p class="muted">Web searches run: ${r.searchQueries.map(esc).join(" · ")}</p>` : ""}
<h2>Follow-up tracker</h2>
<table><thead><tr><th>Prospect</th><th>Contacted Date</th><th>Channel</th><th>Sample Sent</th><th>Actual Reply</th><th>Outcome Class</th><th>Next Action</th></tr></thead><tbody>${tracker}</tbody></table>
</body></html>`;
}
