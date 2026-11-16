import { GoogleGenAI } from "@google/genai";
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
  type: "object",
  additionalProperties: false,
  required: ["segment", "prospects", "outreachPacks", "firstAction", "limitations"],
  properties: {
    segment: {
      type: "object",
      required: ["description", "buyerRole", "fitReason", "exclusions"],
      properties: { description: S("string"), buyerRole: S("string"), fitReason: S("string"), exclusions: { type: "array", items: S("string") } },
    },
    prospects: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        required: ["id", "company", "website", "person", "role", "fitReason", "observedSignal", "signalDate", "assumptions", "contactRoute", "sources", "sampleIdea"],
        properties: {
          id: S("string"), company: S("string"), website: NS, person: NS, role: NS, fitReason: S("string"),
          observedSignal: NS, signalDate: NS, assumptions: { type: "array", items: S("string") },
          contactRoute: {
            type: "object",
            required: ["type", "value", "sourceId", "verificationLimit"],
            properties: { type: NS, value: NS, sourceId: NS, verificationLimit: S("string") },
          },
          sources: {
            type: "array",
            items: { type: "object", required: ["sourceId", "supports"], properties: { sourceId: S("string"), supports: NS } },
          },
          sampleIdea: NS,
        },
      },
    },
    outreachPacks: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        required: ["prospectId", "message", "loomSegments", "ask"],
        properties: {
          prospectId: S("string"), message: S("string"), ask: S("string"),
          loomSegments: { type: "array", items: { type: "object", required: ["seconds", "narration", "screen"], properties: { seconds: S("string"), narration: S("string"), screen: S("string") } } },
        },
      },
    },
    firstAction: { type: "object", required: ["prospectId", "action", "reason"], properties: { prospectId: NS, action: S("string"), reason: S("string") } },
    limitations: { type: "array", items: S("string") },
  },
};

function mapProviderError(e: unknown): ResearchError {
  if (e instanceof ResearchError) return e;
  const status = (e as { status?: number })?.status;
  const name = (e as { name?: string })?.name;
  if (name === "AbortError" || name === "TimeoutError") return new ResearchError("timeout", 504, "The research took too long and was stopped. You can try again.");
  if (status === 429) return new ResearchError("quota", 429, "The Gemini quota or rate limit was reached. Wait a bit, or check your Gemini plan, then try again.");
  if (status === 401 || status === 403) return new ResearchError("auth", 502, "Gemini rejected the API key or this model/search feature isn't enabled for it.");
  if (status === 400) return new ResearchError("provider_bad_request", 502, "Gemini could not run this request (the configured model may not support Google Search).");
  return new ResearchError("provider", 502, "Gemini is temporarily unavailable. Please try again in a moment.");
}

export async function runResearch(input: ResearchInput): Promise<ResearchResult> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new ResearchError("missing_key", 503, "missing_key");
  const model = process.env["GEMINI_MODEL"] || "gemini-2.5-flash";
  const ai = new GoogleGenAI({ apiKey });
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
    // Step 1: grounded research (Google Search tool, free text).
    const research = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: `<USER_DATA>\n${userData}\n</USER_DATA>\n\nWrite detailed research notes. For every prospect, cite the web pages you used.` }] }],
      config: {
        systemInstruction: `${SAFETY_PREAMBLE}\n\n${FIXED_PROMPT}`,
        tools: [{ googleSearch: {} }],
        abortSignal: signal,
      },
    });
    const notes = research.text?.trim();
    const cand = research.candidates?.[0];
    const gm = cand?.groundingMetadata;
    const chunks = (gm?.groundingChunks ?? [])
      .map((c) => c.web)
      .filter((w): w is { uri: string; title?: string } => !!w?.uri && /^https?:\/\//i.test(w.uri));
    if (!notes) throw new ResearchError("empty", 502, "Gemini returned no research. Please try again.");
    if (chunks.length === 0) {
      throw new ResearchError("no_grounding", 502, "Google Search grounding returned no sources, so no verified shortlist can be produced. Try again or broaden your geography.");
    }

    // Attach which text each source supports.
    const supportsBySource = new Map<number, string[]>();
    for (const s of gm?.groundingSupports ?? []) {
      const text = s.segment?.text?.trim();
      if (!text) continue;
      for (const i of s.groundingChunkIndices ?? []) {
        const arr = supportsBySource.get(i) ?? [];
        if (arr.length < 3) arr.push(text.slice(0, 300));
        supportsBySource.set(i, arr);
      }
    }
    const sourceList = chunks.map((c, i) => `S${i + 1}: ${c.title ?? "untitled"} | supports: ${(supportsBySource.get(i) ?? []).join(" / ") || "n/a"}`).join("\n");

    // Step 2: constrained normalization (no tools, strict schema, no new facts).
    const norm = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: `<RESEARCH_NOTES>\n${notes}\n</RESEARCH_NOTES>\n\n<SOURCE_LIST>\n${sourceList}\n</SOURCE_LIST>` }] }],
      config: {
        systemInstruction: `${SAFETY_PREAMBLE}\n\n${NORMALIZE_PROMPT}`,
        responseMimeType: "application/json",
        responseJsonSchema: normalizeJsonSchema,
        abortSignal: signal,
      },
    });

    let raw: any;
    try { raw = JSON.parse(norm.text ?? ""); } catch { throw new ResearchError("invalid_output", 502, "Gemini returned output that couldn't be read. Nothing was shown. Please try again."); }

    const srcFor = (id: unknown) => {
      const m = typeof id === "string" ? /^S(\d+)$/i.exec(id.trim()) : null;
      const c = m ? chunks[Number(m[1]) - 1] : undefined;
      return c ? { c, idx: Number(m![1]) - 1 } : null;
    };
    const safeUrl = (u: unknown) => (typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u.trim()) ? u.trim() : null);

    const prospects = (Array.isArray(raw?.prospects) ? raw.prospects : []).slice(0, 10).map((p: any) => {
      const seen = new Set<number>();
      const sources = (Array.isArray(p?.sources) ? p.sources : []).flatMap((s: any) => {
        const r = srcFor(s?.sourceId);
        if (!r || seen.has(r.idx)) return [];
        seen.add(r.idx);
        return [{ url: r.c.uri, title: r.c.title ?? null, supports: s?.supports ?? supportsBySource.get(r.idx)?.[0] ?? null }];
      });
      const cr = srcFor(p?.contactRoute?.sourceId);
      return {
        ...p,
        website: safeUrl(p?.website),
        assumptions: Array.isArray(p?.assumptions) ? p.assumptions.filter((a: unknown) => typeof a === "string" && a.trim()) : [],
        contactRoute: {
          type: p?.contactRoute?.type ?? null,
          // A contact without a grounded source stays unknown.
          value: cr ? p?.contactRoute?.value ?? null : null,
          sourceUrl: cr ? cr.c.uri : null,
          verificationLimit: p?.contactRoute?.verificationLimit || "A published contact is not proof of deliverability.",
        },
        sources,
      };
    }).filter((p: any) => p.sources.length > 0);

    const ids = new Set(prospects.map((p: any) => p.id));
    const limitations: string[] = Array.isArray(raw?.limitations) ? raw.limitations.filter((l: unknown) => typeof l === "string" && l.trim()) : [];
    const dropped = (raw?.prospects?.length ?? 0) - prospects.length;
    if (dropped > 0) limitations.push(`${dropped} prospect(s) were removed because none of their sources matched Google Search results.`);
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
    if (!parsed.success) throw new ResearchError("invalid_output", 502, "Gemini's answer didn't match the expected report format, so it wasn't shown. Please try again.");

    return {
      report: parsed.data,
      input,
      researchedAt: new Date().toISOString(),
      model,
      searchQueries: (gm?.webSearchQueries ?? []).slice(0, 20),
      searchEntryPointHtml: gm?.searchEntryPoint?.renderedContent ?? null,
    };
  } catch (e) {
    throw mapProviderError(e);
  }
}
