import {
  AuditResult,
  DEFAULT_PILOT_PREFIX,
  DEFAULT_PILOT_TAGS,
  MutationMode,
  PilotScope,
} from "./contracts.js";
import { getIdempotentResult, setIdempotentResult } from "./idempotency.js";
import { stableStringify } from "./json.js";

export interface GuardedMutationOptions<TPreview = unknown, TResult = TPreview> {
  actionKey: string;
  mode: MutationMode;
  changeReason?: string;
  idempotencyKey?: string;
  preview: AuditResult<TPreview>;
  apply: () => Promise<AuditResult<TResult>>;
  pilotScope?: PilotScope;
  fingerprintInput?: unknown;
}

export async function runGuardedMutation<TPreview = unknown, TResult = TPreview>(
  options: GuardedMutationOptions<TPreview, TResult>,
): Promise<AuditResult<TPreview | TResult>> {
  if (options.mode === "preview") {
    return options.preview;
  }

  if (!options.changeReason) {
    throw new Error("`changeReason` is required when mode is `apply`.");
  }

  assertPilotScope(options.actionKey, options.pilotScope);

  const fingerprint = stableStringify({
    actionKey: options.actionKey,
    input: options.fingerprintInput,
  });

  if (options.idempotencyKey) {
    const idempotencyStoreKey = `${options.actionKey}:${options.idempotencyKey}`;
    const cached = await getIdempotentResult(idempotencyStoreKey, fingerprint);
    if (cached) {
      const cachedResult = cached as AuditResult<TPreview | TResult>;
      return { ...cachedResult, deduplicated: true };
    }

    const applied = await options.apply();
    await setIdempotentResult(idempotencyStoreKey, fingerprint, applied);
    return applied;
  }

  return options.apply();
}

export function buildAuditResult<T>(
  seed: Omit<AuditResult<T>, "applied" | "deduplicated" | "mode">,
  mode: MutationMode,
  applied: boolean,
): AuditResult<T> {
  return {
    ...seed,
    mode,
    applied,
    deduplicated: false,
  };
}

function assertPilotScope(actionKey: string, scope?: PilotScope): void {
  if (!scope) {
    return;
  }

  const candidateNames = [scope.name, scope.existingName].filter(Boolean) as string[];
  const hasPilotName = candidateNames.some((value) => value.startsWith(DEFAULT_PILOT_PREFIX));
  const candidateTags = [...(scope.tags ?? []), ...(scope.existingTags ?? [])];
  const hasPilotTags = DEFAULT_PILOT_TAGS.every((tag) => candidateTags.includes(tag));
  const candidateRefs = (scope.refs ?? []).map((value) => value.trim()).filter(Boolean);
  const hasAllowlistedRef = isApplyAllowlisted(actionKey, candidateRefs);

  if (!hasPilotName && !hasPilotTags && !hasAllowlistedRef) {
    throw new Error(
      `Apply mode is restricted to pilot-scoped objects. Use the "${DEFAULT_PILOT_PREFIX}" prefix, the ${DEFAULT_PILOT_TAGS.join(", ")} tags, or set ATLASSIAN_MCP_APPLY_ALLOWLIST with action-scoped entries like "${actionKey}:ISSUE-123".`,
    );
  }
}

function isApplyAllowlisted(actionKey: string, refs: string[]): boolean {
  const rawAllowlist = process.env.ATLASSIAN_MCP_APPLY_ALLOWLIST;
  if (!rawAllowlist || refs.length === 0) {
    return false;
  }

  const allowlist = new Set(
    rawAllowlist
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  return refs.some((ref) => allowlist.has(`${actionKey}:${ref}`) || allowlist.has(`${actionKey}:*`));
}
