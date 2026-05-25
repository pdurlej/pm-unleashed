#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

const target = readOption("--target") ?? "desktop";
const repoDir =
  readOption("--repo-dir") ??
  (target === "docker" ? "/app/server/storage/mcp/pm-unleashed" : repoRoot);
const nodeBin = readOption("--node-bin") ?? (target === "docker" ? "node" : process.execPath);
const outPath = readOption("--out");

if (!["desktop", "docker"].includes(target)) {
  throw new Error(`Unsupported target "${target}". Use "desktop" or "docker".`);
}

const config = {
  mcpServers: {
    "goals-projects-mcp": {
      command: nodeBin,
      args: [path.posix.join(repoDir.replace(/\/$/, ""), "apps/goals-projects-mcp/dist/index.js")],
      env: {
        ATLASSIAN_EMAIL: "",
        ATLASSIAN_API_TOKEN: "",
        ATLASSIAN_CLOUD_ID: "your-cloud-id",
        ATLASSIAN_SITE_URL: "https://your-domain.atlassian.net",
      },
      anythingllm: {
        autoStart: true,
      },
    },
    "jira-portfolio-mcp": {
      command: nodeBin,
      args: [path.posix.join(repoDir.replace(/\/$/, ""), "apps/jira-rest-mcp/dist/index.js")],
      env: {
        JIRA_URL: "https://your-domain.atlassian.net",
        JIRA_USERNAME: "",
        JIRA_API_TOKEN: "",
      },
      anythingllm: {
        autoStart: true,
      },
    },
  },
};

const output = `${JSON.stringify(config, null, 2)}\n`;
if (outPath) {
  const resolvedOutPath = path.resolve(outPath);
  await mkdir(path.dirname(resolvedOutPath), { recursive: true });
  await writeFile(resolvedOutPath, output, "utf8");
  console.log(resolvedOutPath);
} else {
  console.log(output);
}
