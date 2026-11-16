import { describe, expect, it } from "vitest";
import { buildReportHtml, reportFilename, safeHref } from "@/lib/research/report-html";
import type { ResearchResult } from "@/lib/research/schema";

const base: ResearchResult = {
  input: { project: "<script>alert(1)</script>", proof: "p", deliverable: "d", limitations: "l", geography: "g", evidence: "Unvalidated", channel: "email" },
  researchedAt: "2026-11-16T08:00:00Z", model: "m", searchQueries: [], searchEntryPointHtml: null,
  report: {
    segment: { description: "s", buyerRole: "b", fitReason: "f", exclusions: [] },
    prospects: [{ id: "p1", company: "Acme <img src=x onerror=alert(1)>", website: "javascript:alert(1)", person: null, role: null, fitReason: "f", observedSignal: null, signalDate: null, assumptions: [], contactRoute: { type: null, value: null, sourceUrl: null, verificationLimit: "v" }, sources: [{ url: "https://example.com/a", title: "A", supports: null }], sampleIdea: null }],
    outreachPacks: [], firstAction: { prospectId: null, action: "a", reason: "r" }, limitations: [],
  },
};

describe("report html", () => {
  it("escapes user and model text", () => {
    const html = buildReportHtml(base);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
  });
  it("only links http(s) urls", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(buildReportHtml(base)).not.toContain('href="javascript:');
    expect(buildReportHtml(base)).toContain('href="https://example.com/a"');
  });
  it("keeps unknown contact unknown and has no scripts", () => {
    const html = buildReportHtml(base);
    expect(html).toContain("<em>Unknown</em>");
    expect(html).not.toMatch(/<script|<link|@import/i);
  });
  it("names the file by date", () => {
    expect(reportFilename(new Date("2026-11-16T10:00:00Z"))).toBe("project-to-prospects-2026-11-16.html");
  });
});
