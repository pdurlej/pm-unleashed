export function textToAdfDocument(text: string) {
  const content = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({
      type: "paragraph",
      content: [{ type: "text", text: paragraph }],
    }));

  return {
    version: 1,
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph", content: [] }],
  };
}

export function textToAdf(text: string): string {
  return JSON.stringify(textToAdfDocument(text));
}

export function adfToPlainText(value?: string | null): string {
  if (!value) {
    return "";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return value;
  }

  if (!parsed || typeof parsed !== "object") {
    return value;
  }

  const lines: string[] = [];
  function visit(node: unknown, buffer: string[]): void {
    if (!node || typeof node !== "object") {
      return;
    }
    const record = node as { type?: string; text?: string; content?: unknown[] };
    if (typeof record.text === "string") {
      buffer.push(record.text);
    }
    if (Array.isArray(record.content)) {
      const childBuffer = record.type === "paragraph" ? [] : buffer;
      for (const child of record.content) {
        visit(child, childBuffer);
      }
      if (record.type === "paragraph") {
        lines.push(childBuffer.join(""));
      }
    }
  }

  visit(parsed, []);
  return lines.length > 0 ? lines.join("\n\n").trim() : value;
}
