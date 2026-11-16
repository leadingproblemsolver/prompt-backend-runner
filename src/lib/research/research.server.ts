import { FIXED_PROMPT, NORMALIZE_PROMPT, SAFETY_PREAMBLE } from "./prompt";
import { reportSchema, type ResearchInput, type ResearchResult } from "./schema";

export class ResearchError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

const TOTAL_TIMEOUT_MS = 150_000;

const S = (t: string | string[]) => ({ type: t });
const NS = { type: ["string", "null"] };
const normalizeJsonSchema = {
  type: "object", additionalProperties: false,
  additionalProperties: false,
  required: ["segment", "prospects", "outreachPacks", "firstAction", "limitations"],
  properties: {
    segment: {
      type: "object", additionalProperties: false,
      required: ["description", "buyerRole", "fitReason", "exclusions"],
      properties: { description: S("string"), buyerRole: S("string"), fitReason: S("string"), exclusions: { type: "array", items: S("string") } },
    },
    prospects: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "company", "website", "person", "role", "fitReason", "observedSignal", "signalDate", "assumptions", "contactRoute", "sources", "sampleIdea"],
        properties: {
          id: S("string"), company: S("string"), website: NS, person: NS, role: NS, fitReason: S("string"),
          observedSignal: NS, signalDate: NS, assumptions: { type: "array", items: S("string") },
          contactRoute: {
            type: "object", additionalProperties: false,
            required: ["type", "value", "sourceId", "verificationLimit"],
            properties: { type: NS, value: NS, sourceId: NS, verificationLimit: S("string") },
          },
          sources: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["sourceId", "supports"], properties: { sourceId: S("string"), supports: NS } },
          },
          sampleIdea: NS,
        },
      },
    },
    outreachPacks: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object", additionalProperties: false,
        required: ["prospectId", "message", "loomSegments", "ask"],
        properties: {
          prospectId: S("string"), message: S("string"), ask: S("string"),
          loomSegments: { type: "array", items: { type: "object", additionalProperties: false, required: ["seconds", "narration", "screen"], properties: { seconds: S("string"), narration: S("string"), screen: S("string") } } },
        },
      },
    },
    firstAction: { type: "object", additionalProperties: false, required: ["prospectId", "action", "reason"], properties: { prospectId: NS, action: S("string"), reason: S("string") } },
    limitations: { type: "array", items: S("string") },
  },
};

function mapProviderError(e: unknown): ResearchError {
  if (e instanceof ResearchError) return e;
  const status = (e as { status?: number })?.status;
  const name = (e as { name?: string })?.name;
  if (name === "AbortError" || name === "TimeoutError") return new ResearchError("timeout", 504, "The research took too long and was stopped. You can try again.");
  if (status === 429) return new ResearchError("quota", 429, "OpenAI rate limit reached. Wait a minute, then try again.");
  if (status === 401 || status === 403) return new ResearchError("auth", 502, "OpenAI rejected the API key, or this model isn't available to it.");
  if (status === 400) return new ResearchError("provider_bad_request", 502, "OpenAI could not run this request (the configured model may not support web search).");
  return new ResearchError("provider", 502, "OpenAI is temporarily unavailable. Please try again in a moment.");
}


type Citation = { url: string; title: string | null; text: string };

async function callOpenAI(apiKey: string, body: unknown, signal: AbortSignal) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err: any = await res.json().catch(() => null);
    const code = err?.error?.code;
    if (res.status === 429 && code === "insufficient_quota") throw new ResearchError("quota", 429, "Your OpenAI account has no remaining quota. Add billing credit at platform.openai.com, then try again.");
    throw Object.assign(new Error("provider"), { status: res.status });
  }
  return (await res.json()) as any;
}

export async function runResearch(input: ResearchInput): Promise<ResearchResult> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new ResearchError("missing_key", 503, "missing_key");
  const model = process.env["OPENAI_MODEL"] || "gpt-5-mini";
  const signal = AbortSignal.timeout(TOTAL_TIMEOUT_MS);

  const userData = JSON.stringify({
    workingProjectOrService: input.project,
    proofOrDemo: input.proof,
    whatICanPersonallyDeliver: input.deliverable,
    limitations: input.limitations,
    targetGeography: input.geography,
    existingCustomerOrProblemEvidence: input.evidence,
    preferredContactChannel: input.channel,
  }, null, 2);

  try {
    // Step 1: web-search-grounded research (free text with URL citations).
    const research = await callOpenAI(apiKey, {
      model,
      instructions: `${SAFETY_PREAMBLE}\n\n${FIXED_PROMPT}`,
      input: `<USER_DATA>\n${userData}\n</USER_DATA>\n\nWrite detailed research notes. For every prospect, cite the web pages you used.`,
      tools: [{ type: "web_search" }],
      include: ["web_search_call.action.sources"],
      store: false,
    }, signal);

    const msgs = (research.output ?? []).filter((o: any) => o.type === "message");
    const parts = msgs.flatMap((m: any) => m.content ?? []).filter((c: any) => c.type === "output_text");
    const notes = parts.map((c: any) => c.text).join("\n").trim();
    const citations: Citation[] = [];
    const byUrl = new Map<string, number>();
    for (const c of parts) {
      for (const a of c.annotations ?? []) {
        if (a.type !== "url_citation" || typeof a.url !== "string" || !/^https?:\/\//i.test(a.url)) continue;
        const span = String(c.text).slice(a.start_index ?? 0, a.end_index ?? 0);
        const lineStart = String(c.text).lastIndexOf("\n", a.start_index ?? 0) + 1;
        const ctx = String(c.text).slice(lineStart, a.start_index ?? 0).trim().slice(-300) || span;
        const url = a.url.replace(/[?&]utm_source=openai$/, "");
        if (!byUrl.has(url)) { byUrl.set(url, citations.length); citations.push({ url, title: a.title ?? null, text: ctx }); }
      }
    }
    const searchQueries: string[] = (research.output ?? [])
      .filter((o: any) => o.type === "web_search_call")
      .flatMap((o: any) => (o.action?.query ? [String(o.action.query)] : []))
      .slice(0, 20);

    if (!notes) throw new ResearchError("empty", 502, "The AI returned no research. Please try again.");
    if (citations.length === 0) throw new ResearchError("no_grounding", 502, "Web search returned no cited sources, so no verified shortlist can be produced. Try again or broaden your geography.");

    const sourceList = citations.map((c, i) => `S${i + 1}: ${c.title ?? "untitled"} <${c.url}> | cited for: ${c.text || "n/a"}`).join("\n");

    // Step 2: constrained normalization (no tools, strict schema, no new facts).
    const norm = await callOpenAI(apiKey, {
      model,
      instructions: `${SAFETY_PREAMBLE}\n\n${NORMALIZE_PROMPT}`,
      input: `<RESEARCH_NOTES>\n${notes}\n</RESEARCH_NOTES>\n\n<SOURCE_LIST>\n${sourceList}\n</SOURCE_LIST>`,
      text: { format: { type: "json_schema", name: "report", strict: true, schema: normalizeJsonSchema } },
      store: false,
    }, signal);
    const normText = (norm.output ?? []).filter((o: any) => o.type === "message").flatMap((m: any) => m.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("");

    let raw: any;
    try { raw = JSON.parse(normText); } catch { throw new ResearchError("invalid_output", 502, "The AI returned output that couldn't be read. Nothing was shown. Please try again."); }

    const srcFor = (id: unknown) => {
      const m = typeof id === "string" ? /^S(\d+)$/i.exec(id.trim()) : null;
      const c = m ? citations[Number(m[1]) - 1] : undefined;
      return c ? { c, idx: Number(m![1]) - 1 } : null;
    };
    const safeUrl = (u: unknown) => (typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u.trim()) ? u.trim() : null);

    const prospects = (Array.isArray(raw?.prospects) ? raw.prospects : []).slice(0, 10).map((p: any) => {
      const seen = new Set<number>();
      const sources = (Array.isArray(p?.sources) ? p.sources : []).flatMap((s: any) => {
        const r = srcFor(s?.sourceId);
        if (!r || seen.has(r.idx)) return [];
        seen.add(r.idx);
        return [{ url: r.c.url, title: r.c.title, supports: s?.supports || r.c.text || null }];
      });
      const cr = srcFor(p?.contactRoute?.sourceId);
      return {
        ...p,
        website: safeUrl(p?.website),
        assumptions: Array.isArray(p?.assumptions) ? p.assumptions.filter((a: unknown) => typeof a === "string" && a.trim()) : [],
        contactRoute: {
          type: p?.contactRoute?.type ?? null,
          value: cr ? p?.contactRoute?.value ?? null : null,
          sourceUrl: cr ? cr.c.url : null,
          verificationLimit: p?.contactRoute?.verificationLimit || "A published contact is not proof of deliverability.",
        },
        sources,
      };
    }).filter((p: any) => p.sources.length > 0);

    const ids = new Set(prospects.map((p: any) => p.id));
    const limitations: string[] = Array.isArray(raw?.limitations) ? raw.limitations.filter((l: unknown) => typeof l === "string" && l.trim()) : [];
    const dropped = (raw?.prospects?.length ?? 0) - prospects.length;
    if (dropped > 0) limitations.push(`${dropped} prospect(s) were removed because none of their sources matched web search citations.`);
    limitations.push("Your proof/demo link was not opened or inspected.");

    let firstAction = raw?.firstAction;
    if (firstAction && firstAction.prospectId && !ids.has(firstAction.prospectId)) firstAction = { ...firstAction, prospectId: null };
    if (prospects.length === 0) {
      firstAction = {
        prospectId: null,
        action: firstAction?.action || "Run discovery: talk to 3 people in the proposed segment before building outreach samples.",
        reason: firstAction?.reason || "No prospects could be backed by search sources.",
      };
    }

    const parsed = reportSchema.safeParse({
      segment: raw?.segment,
      prospects,
      outreachPacks: (Array.isArray(raw?.outreachPacks) ? raw.outreachPacks : []).filter((o: any) => ids.has(o?.prospectId)).slice(0, 3),
      firstAction,
      limitations,
    });
    if (!parsed.success) throw new ResearchError("invalid_output", 502, "The AI's answer didn't match the expected report format, so it wasn't shown. Please try again.");

    return { report: parsed.data, input, researchedAt: new Date().toISOString(), model, searchQueries, searchEntryPointHtml: null };
  } catch (e) {
    throw mapProviderError(e);
  }
}
