import { createFileRoute } from "@tanstack/react-router";
import { researchInputSchema } from "@/lib/research/schema";

// Best-effort per-instance rate limit: 5 requests per 10 minutes per IP.
const WINDOW_MS = 10 * 60_000;
const MAX_REQ = 5;
const hits = new Map<string, number[]>();
const inFlight = new Set<string>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export const Route = createFileRoute("/api/research")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
        const now = Date.now();
        const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
        if (recent.length >= MAX_REQ) return json({ error: { code: "rate_limited", message: "Too many research requests. Please wait a few minutes and try again." } }, 429);
        if (inFlight.has(ip)) return json({ error: { code: "busy", message: "A research request is already running. Please wait for it to finish." } }, 409);

        let body: unknown;
        try { body = await request.json(); } catch { return json({ error: { code: "bad_json", message: "The request was not readable." } }, 400); }
        const parsed = researchInputSchema.safeParse(body);
        if (!parsed.success) return json({ error: { code: "invalid_input", message: parsed.error.issues.map((i) => i.message).join(" ") } }, 400);

        recent.push(now);
        hits.set(ip, recent);
        inFlight.add(ip);
        try {
          const { runResearch } = await import("@/lib/research/gemini.server");
          const result = await runResearch(parsed.data);
          return json({ result });
        } catch (e: any) {
          const code = e?.code ?? "unknown";
          // Log only the error class, never the submitted project details.
          console.error("research failed:", code);
          if (code === "missing_key") return json({ error: { code, message: "missing_key" } }, 503);
          return json({ error: { code, message: e?.status ? e.message : "Something went wrong. Please try again." } }, e?.status ?? 500);
        } finally {
          inFlight.delete(ip);
        }
      },
    },
  },
});
