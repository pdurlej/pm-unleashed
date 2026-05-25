import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type TenantModelConfig = Record<string, unknown>;

export async function readTenantModelConfig(filePath: string): Promise<TenantModelConfig> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as TenantModelConfig;
  } catch {
    return {};
  }
}

export async function updateTenantModelConfig(
  filePath: string,
  updater: (current: TenantModelConfig) => TenantModelConfig,
): Promise<TenantModelConfig> {
  const current = await readTenantModelConfig(filePath);
  const next = updater(current);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
