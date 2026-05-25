import { loadLocalEnv } from "./load-local-env.mjs";
import { discoverTenantModel } from "../apps/goals-projects-mcp/dist/service.js";

loadLocalEnv();
const result = await discoverTenantModel();
console.log(JSON.stringify(result, null, 2));
