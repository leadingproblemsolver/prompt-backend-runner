import { z } from "zod";

export const CHANNELS = ["email", "LinkedIn", "introduction"] as const;

export const LIMITS = {
  project: 600,
  proof: 600,
  deliverable: 600,
  limitations: 600,
  geography: 120,
  evidence: 600,
} as const;

const field = (max: number, label: string) =>
  z.string().trim().min(3, `${label} is required (at least 3 characters).`).max(max, `${label} must be ${max} characters or fewer.`);

export const researchInputSchema = z.object({
  project: field(LIMITS.project, "Working project/service"),
  proof: field(LIMITS.proof, "Proof/demo"),
  deliverable: field(LIMITS.deliverable, "What you can deliver"),
  limitations: field(LIMITS.limitations, "Limitations"),
  geography: field(LIMITS.geography, "Target geography"),
  evidence: z.string().trim().max(LIMITS.evidence).transform((v) => v || "Unvalidated"),
  channel: z.enum(CHANNELS),
});
export type ResearchInput = z.infer<typeof researchInputSchema>;

const str = z.string().trim().min(1).max(2000);
const nstr = z.string().trim().max(2000).nullable();

export const sourceSchema = z.object({ url: z.string().url(), title: nstr, supports: nstr });

export const prospectSchema = z.object({
  id: z.string().min(1).max(40),
  company: str,
  website: nstr,
  person: nstr,
  role: nstr,
  fitReason: str,
  observedSignal: nstr,
  signalDate: nstr,
  assumptions: z.array(str).max(10),
  contactRoute: z.object({
    type: nstr,
    value: nstr,
    sourceUrl: nstr,
    verificationLimit: str,
  }),
  sources: z.array(sourceSchema).max(15),
  sampleIdea: nstr,
});

export const outreachSchema = z.object({
  prospectId: z.string().min(1).max(40),
  message: str,
  loomSegments: z.array(z.object({ seconds: str, narration: str, screen: str })).min(1).max(8),
  ask: str,
});

export const reportSchema = z.object({
  segment: z.object({
    description: str,
    buyerRole: str,
    fitReason: str,
    exclusions: z.array(str).max(12),
  }),
  prospects: z.array(prospectSchema).max(10),
  outreachPacks: z.array(outreachSchema).max(3),
  firstAction: z.object({ prospectId: z.string().max(40).nullable(), action: str, reason: str }),
  limitations: z.array(str).max(20),
});
export type Report = z.infer<typeof reportSchema>;

export type ResearchResult = {
  report: Report;
  input: ResearchInput;
  researchedAt: string;
  model: string;
  searchQueries: string[];
  searchEntryPointHtml: string | null;
};
