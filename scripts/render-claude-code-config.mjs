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

const repoDir = readOption("--repo-dir") ?? repoRoot;
const nodeBin = readOption("--node-bin") ?? process.execPath;
const outPath = readOption("--out") ?? path.join(repoRoot, ".mcp.json");

const config = {
  mcpServers: {
    "goals-projects-local": {
      type: "stdio",
      command: nodeBin,
      args: [path.join(repoDir, "scripts/claude-goals-projects-mcp.mjs")],
      env: {},
    },
    "jira-portfolio-local": {
      type: "stdio",
      command: nodeBin,
      args: [path.join(repoDir, "scripts/claude-jira-portfolio-mcp.mjs")],
      env: {},
    },
  },
};

const output = `${JSON.stringify(config, null, 2)}\n`;
const resolvedOutPath = path.resolve(outPath);
await mkdir(path.dirname(resolvedOutPath), { recursive: true });
await writeFile(resolvedOutPath, output, "utf8");
console.log(resolvedOutPath);

