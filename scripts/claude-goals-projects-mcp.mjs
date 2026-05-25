#!/usr/bin/env node
import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();
await import("../apps/goals-projects-mcp/dist/index.js");

