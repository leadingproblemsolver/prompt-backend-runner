import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Download, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CHANNELS, LIMITS, researchInputSchema, type ResearchResult } from "@/lib/research/schema";
import { buildReportHtml, reportFilename, safeHref } from "@/lib/research/report-html";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Project → Prospects — find customers for work you can demo" },
      { name: "description", content: "Enter a project you can already demonstrate and get a source-backed shortlist of prospects, outreach messages and Loom scripts." },
      { property: "og:title", content: "Project → Prospects" },
      { property: "og:description", content: "A source-backed research shortlist for work you can already demonstrate." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type Form = { project: string; proof: string; deliverable: string; limitations: string; geography: string; evidence: string; channel: (typeof CHANNELS)[number] };
type Err = { code: string; message: string };

const FIELDS: { key: keyof typeof LIMITS; label: string; long?: boolean; hint?: string }[] = [
  { key: "project", label: "Working project/service", long: true },
  { key: "proof", label: "Proof/demo URL or description", hint: "Not opened by the research — described only." },
  { key: "deliverable", label: "What I can personally deliver", long: true },
  { key: "limitations", label: "Limitations", long: true },
  { key: "geography", label: "Target geography" },
  { key: "evidence", label: "Existing customer/problem evidence", long: true },
];

function copy(text: string) {
  navigator.clipboard.writeText(text).then(() => toast.success("Copied"), () => toast.error("Couldn't copy"));
}

function Index() {
  const [form, setForm] = useState<Form>({ project: "", proof: "", deliverable: "", limitations: "", geography: "", evidence: "Unvalidated", channel: "email" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Err | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const v = researchInputSchema.safeParse(form);
    if (!v.success) { setError({ code: "invalid_input", message: v.error.issues.map((i) => i.message).join(" ") }); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v.data) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.result) setError(data?.error ?? { code: "unknown", message: "Something went wrong. Please try again." });
      else setResult(data.result);
    } catch {
      setError({ code: "network", message: "Couldn't reach the server. Check your connection and try again." });
    } finally { setLoading(false); }
  }

  function download() {
    if (!result) return;
    const blob = new Blob([buildReportHtml(result)], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = reportFilename(new Date(result.researchedAt));
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <header className="mb-10">
        <p className="text-sm font-medium uppercase tracking-widest text-primary">Project → Prospects</p>
        <h1 className="mt-2 text-4xl font-bold leading-tight md:text-5xl">Find people who might need what you've already built.</h1>
        <p className="mt-3 text-muted-foreground">You get a research shortlist with sources — not proof of demand, and not guaranteed contacts.</p>
      </header>

      <form onSubmit={submit} className="space-y-5 rounded-lg border bg-card p-6">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={f.key}>{f.label}</Label>
            {f.long ? (
              <Textarea id={f.key} rows={2} maxLength={LIMITS[f.key]} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            ) : (
              <Input id={f.key} maxLength={LIMITS[f.key]} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            )}
            {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
          </div>
        ))}
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Preferred contact channel</legend>
          <div className="flex gap-2">
            {CHANNELS.map((c) => (
              <Button key={c} type="button" size="sm" variant={form.channel === c ? "default" : "outline"} onClick={() => setForm({ ...form, channel: c })}>{c}</Button>
            ))}
          </div>
        </fieldset>
        <Button type="submit" size="lg" disabled={loading} className="w-full">
          {loading ? <><Loader2 className="animate-spin" /> Searching the web and checking sources… (can take 1–2 minutes)</> : "Find relevant prospects"}
        </Button>
      </form>

      {error && <ErrorBox error={error} />}
      {result && <Results r={result} onDownload={download} />}
    </main>
  );
}

function ErrorBox({ error }: { error: Err }) {
  if (error.code === "missing_key") {
    return (
      <div className="mt-6 rounded-lg border border-destructive/40 bg-card p-5" role="alert">
        <h2 className="text-xl font-bold">Setup needed: Gemini API key</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          <li>Create a key at Google AI Studio (aistudio.google.com/apikey).</li>
          <li>Add it as a secret named <code>GEMINI_API_KEY</code>. Optional: <code>GEMINI_MODEL</code> (default gemini-2.5-flash).</li>
          <li>Press “Find relevant prospects” again — your answers are kept.</li>
        </ol>
      </div>
    );
  }
  return <div className="mt-6 rounded-lg border border-destructive/40 bg-card p-5 text-sm" role="alert"><b>Couldn't finish the research.</b> {error.message} Your answers are kept — press the button to retry.</div>;
}

function Results({ r, onDownload }: { r: ResearchResult; onDownload: () => void }) {
  const { report } = r;
  const byId = new Map(report.prospects.map((p) => [p.id, p]));
  const fa = report.firstAction;
  return (
    <section className="mt-12 space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-foreground pb-3">
        <div>
          <h2 className="text-3xl font-bold">Research shortlist</h2>
          <p className="text-xs text-muted-foreground">Researched {new Date(r.researchedAt).toLocaleString()} · {r.model}</p>
        </div>
        <Button onClick={onDownload}><Download /> Download my HTML report</Button>
      </div>

      <Block title="Customer segment">
        <p>{report.segment.description}</p>
        <p><b>Buyer role:</b> {report.segment.buyerRole}</p>
        <p><b>Why it fits:</b> {report.segment.fitReason}</p>
        {report.segment.exclusions.length > 0 && <><p className="mt-2 font-medium">Exclude:</p><ul className="list-disc pl-5">{report.segment.exclusions.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      </Block>

      <div>
        <h3 className="mb-3 text-2xl font-bold">Prospects ({report.prospects.length})</h3>
        {report.prospects.length === 0 && <p className="text-muted-foreground">No prospects could be backed by sources. See the next step below.</p>}
        <div className="space-y-4">
          {report.prospects.map((p, i) => (
            <article key={p.id} className="space-y-2 rounded-lg border bg-card p-5 text-sm">
              <h4 className="font-display text-lg font-bold">{i + 1}. {p.company}</h4>
              <p><b>Website:</b> <SafeLink url={p.website} /></p>
              <p><b>Person / role:</b> {p.person ?? <Unknown />} — {p.role ?? <Unknown />} <span className="text-muted-foreground">(purchase authority: unknown)</span></p>
              <p><b>Why they fit</b> <Tag>hypothesis</Tag>: {p.fitReason}</p>
              <p><b>Observed signal:</b> {p.observedSignal ?? <Unknown />} <span className="text-muted-foreground">· Date: {p.signalDate ?? "unknown"}</span></p>
              {p.assumptions.length > 0 && <div><b>Still assumed:</b><ul className="list-disc pl-5">{p.assumptions.map((a, j) => <li key={j}>{a}</li>)}</ul></div>}
              <p><b>Contact:</b> {p.contactRoute.type ?? <Unknown />}: {p.contactRoute.value ?? <Unknown />} {p.contactRoute.sourceUrl && <SafeLink url={p.contactRoute.sourceUrl} label="(source)" />}<br /><span className="text-muted-foreground">{p.contactRoute.verificationLimit}</span></p>
              <p><b>Sample idea:</b> {p.sampleIdea ?? <Unknown />}</p>
              <div><b>Sources</b> <Tag>Google Search</Tag>
                <ol className="list-decimal pl-5">{p.sources.map((s, j) => <li key={j}><SafeLink url={s.url} label={s.title ?? s.url} />{s.supports && <span className="text-muted-foreground"> — supports: “{s.supports}”</span>}</li>)}</ol>
              </div>
            </article>
          ))}
        </div>
      </div>

      {report.outreachPacks.length > 0 && (
        <div>
          <h3 className="mb-3 text-2xl font-bold">Outreach for the top {report.outreachPacks.length}</h3>
          <div className="space-y-4">
            {report.outreachPacks.map((o) => {
              const script = o.loomSegments.map((s) => `${s.seconds}\nSCREEN: ${s.screen}\nSAY: ${s.narration}`).join("\n\n");
              return (
                <article key={o.prospectId} className="space-y-3 rounded-lg border bg-card p-5 text-sm">
                  <h4 className="font-display text-lg font-bold">{byId.get(o.prospectId)?.company}</h4>
                  <div className="flex items-center justify-between"><b>Message ({r.input.channel})</b><Button size="sm" variant="outline" onClick={() => copy(o.message)}><Copy /> Copy message</Button></div>
                  <p className="whitespace-pre-wrap rounded bg-muted p-3">{o.message}</p>
                  <p><b>Ask:</b> {o.ask}</p>
                  <div className="flex items-center justify-between"><b>Loom script</b><Button size="sm" variant="outline" onClick={() => copy(script)}><Copy /> Copy script</Button></div>
                  <div className="space-y-2">{o.loomSegments.map((s, j) => (
                    <div key={j} className="grid grid-cols-[4rem_1fr] gap-2 border-t pt-2"><span className="font-medium">{s.seconds}</span><div><p className="text-muted-foreground">Screen: {s.screen}</p><p>Say: {s.narration}</p></div></div>
                  ))}</div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      <Block title="Recommended first action">
        <p className="font-medium">{fa.prospectId ? byId.get(fa.prospectId)?.company : "Discovery step"}</p>
        <p>{fa.action}</p>
        <p className="text-muted-foreground">{fa.reason}</p>
      </Block>

      <Block title="Limitations">
        <ul className="list-disc pl-5">{report.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        {r.searchEntryPointHtml && (
          <iframe title="Google Search suggestions" sandbox="allow-popups" srcDoc={r.searchEntryPointHtml} className="mt-3 h-24 w-full rounded border" />
        )}
      </Block>

      <Block title="Follow-up tracker">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead><tr>{["Prospect", "Contacted Date", "Channel", "Sample Sent", "Actual Reply", "Outcome Class", "Next Action"].map((h) => <th key={h} className="border p-2 text-left">{h}</th>)}</tr></thead>
            <tbody>{(report.outreachPacks.length ? report.outreachPacks : [0, 1, 2]).map((o, i) => (
              <tr key={i}><td className="border p-2">{typeof o === "object" ? byId.get(o.prospectId)?.company : ""}</td>{Array.from({ length: 6 }).map((_, j) => <td key={j} className="border p-2">&nbsp;</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      </Block>
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="space-y-1 rounded-lg border bg-card p-5 text-sm"><h3 className="mb-2 text-2xl font-bold">{title}</h3>{children}</div>;
}
function Unknown() { return <em className="text-muted-foreground">Unknown</em>; }
function Tag({ children }: { children: React.ReactNode }) { return <span className="rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground">{children}</span>; }
function SafeLink({ url, label }: { url: string | null; label?: string }) {
  const h = safeHref(url);
  if (!h) return <Unknown />;
  return <a href={h} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">{label ?? h}<ExternalLink className="size-3" /></a>;
}
