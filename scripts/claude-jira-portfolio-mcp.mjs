#!/usr/bin/env node
import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();
await import("../apps/jira-rest-mcp/dist/index.js");

