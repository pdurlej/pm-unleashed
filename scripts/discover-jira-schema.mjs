import { loadLocalEnv } from "./load-local-env.mjs";
import { discoverJiraSchema } from "../apps/jira-rest-mcp/dist/service.js";

loadLocalEnv();
const result = await discoverJiraSchema();
console.log(JSON.stringify(result, null, 2));
