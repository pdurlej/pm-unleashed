import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const STORE_PATH = path.join(os.homedir(), ".cache", "pm-unleashed", "idempotency.json");

interface IdempotencyRecord {
  fingerprint: string;
  result: unknown;
}

type IdempotencyStore = Record<string, IdempotencyRecord>;

async function loadStore(): Promise<IdempotencyStore> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as IdempotencyStore;
  } catch {
    return {};
  }
}

async function saveStore(store: IdempotencyStore): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function getIdempotentResult(
  key: string,
  fingerprint: string,
): Promise<unknown | undefined> {
  const store = await loadStore();
  const record = store[key];
  if (!record) {
    return undefined;
  }
  if (record.fingerprint !== fingerprint) {
    throw new Error(`Idempotency key "${key}" was already used for a different request.`);
  }
  return record.result;
}

export async function setIdempotentResult(
  key: string,
  fingerprint: string,
  result: unknown,
): Promise<void> {
  const store = await loadStore();
  store[key] = { fingerprint, result };
  await saveStore(store);
}
