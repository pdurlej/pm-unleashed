const BEGIN_MARKER = "[MCP-METADATA-BEGIN]";
const END_MARKER = "[MCP-METADATA-END]";

export interface EmbeddedMetadata {
  idempotencyKey?: string;
  logicalGoalType?: string;
  tags?: string[];
  secondaryContributionRefs?: string[];
  primaryBusinessGoalId?: string;
  secondaryGoalRefs?: string[];
  pilot?: boolean;
}

export function stripMetadata(text?: string | null): string {
  if (!text) {
    return "";
  }
  const start = text.indexOf(BEGIN_MARKER);
  if (start === -1) {
    return text.trim();
  }
  return text.slice(0, start).trim();
}

export function extractMetadata(text?: string | null): EmbeddedMetadata {
  if (!text) {
    return {};
  }
  const start = text.indexOf(BEGIN_MARKER);
  const end = text.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    return {};
  }

  const jsonText = text
    .slice(start + BEGIN_MARKER.length, end)
    .trim();

  try {
    return JSON.parse(jsonText) as EmbeddedMetadata;
  } catch {
    return {};
  }
}

export function embedMetadata(text: string | undefined, metadata: EmbeddedMetadata): string {
  const cleanText = stripMetadata(text);
  const payload = JSON.stringify(metadata, null, 2);
  const parts = [cleanText.trim(), BEGIN_MARKER, payload, END_MARKER].filter(Boolean);
  return parts.join("\n\n").trim();
}
