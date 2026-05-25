import { z } from "zod";

export const MUTATION_MODES = ["preview", "apply"] as const;

export type MutationMode = (typeof MUTATION_MODES)[number];

export const mutationControlSchema = z.object({
  mode: z.enum(MUTATION_MODES).optional().default("preview"),
  idempotencyKey: z.string().trim().min(1).max(256).optional(),
  changeReason: z.string().trim().min(3).max(500).optional(),
});

export interface AuditStep {
  kind: "graphql" | "rest" | "note";
  description: string;
  operation?: string;
  endpoint?: string;
  input?: unknown;
  before?: unknown;
  after?: unknown;
}

export interface AuditResult<T = unknown> {
  mode: MutationMode;
  intent: string;
  target: string;
  applied: boolean;
  deduplicated: boolean;
  warnings: string[];
  steps: AuditStep[];
  result?: T;
  rollbackHint?: string;
}

export interface PilotScope {
  name?: string | null;
  tags?: string[] | null;
  refs?: string[] | null;
  existingName?: string | null;
  existingTags?: string[] | null;
}

export const DEFAULT_PILOT_PREFIX = "MCPTEST::";
export const DEFAULT_PILOT_TAGS = ["mcp-pilot", "do-not-report"];
