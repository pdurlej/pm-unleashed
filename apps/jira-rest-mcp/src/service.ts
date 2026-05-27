import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuditStep,
  AuditResult,
  buildAuditResult,
  buildBasicAuthHeader,
  DEFAULT_PILOT_PREFIX,
  loadJiraEnv,
  MutationMode,
  readTenantModelConfig,
  resolveAccountId,
  runGuardedMutation,
  textToAdfDocument,
  updateTenantModelConfig,
  JiraRestClient,
  HttpClient,
  HttpError,
} from "@pm-unleashed/atlassian-mcp-shared";

interface JiraFieldSchema {
  type?: string;
  items?: string;
  system?: string;
  custom?: string;
  customId?: number;
  configuration?: Record<string, unknown>;
}

interface JiraField {
  id: string;
  key: string;
  name: string;
  untranslatedName?: string;
  custom?: boolean;
  clauseNames?: string[];
  schema?: JiraFieldSchema;
  scope?: {
    type?: string;
    project?: { id: string };
  };
}

interface JiraMetaField extends JiraField {
  fieldId?: string;
  required?: boolean;
  operations?: string[];
  allowedValues?: Array<{ id?: string; value?: string }>;
}

interface JiraIssueType {
  id: string;
  name: string;
  description?: string;
}

interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  simplified?: boolean;
  style?: string;
  entityId?: string;
  issueTypes?: JiraIssueType[];
}

interface JiraProjectSearchResponse {
  values: JiraProject[];
  isLast: boolean;
  maxResults: number;
  startAt: number;
}

interface SearchJqlResponse {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

interface IssueLinkType {
  id?: string;
  name: string;
  inward?: string;
  outward?: string;
}

interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, unknown>;
}

interface DiscoveredFieldRef {
  id: string;
  name: string;
  clauseName?: string;
  schema?: JiraFieldSchema;
  options?: Array<{ id: string; value: string }>;
  operations?: string[];
  scope?: JiraField["scope"];
}

interface DiscoveredJpdProject {
  id: string;
  key: string;
  name: string;
  issueTypes?: JiraIssueType[];
  ideaIssueTypeId?: string;
  horizonField?: DiscoveredFieldRef;
  desiredOutcomeField?: DiscoveredFieldRef;
  hypothesisField?: DiscoveredFieldRef;
  businessOwnerField?: DiscoveredFieldRef;
  techOwnerField?: DiscoveredFieldRef;
  adoptionOwnerField?: DiscoveredFieldRef;
  premiumFields?: {
    polarisFields: DiscoveredFieldRef[];
    connectionFields: DiscoveredFieldRef[];
  };
}

interface PlansAccessStatus {
  status: "available" | "forbidden" | "unauthorized" | "unavailable";
  endpoint: string;
  message?: string;
  planCount?: number;
  sample?: unknown[];
}

interface JiraPremiumCapabilities {
  discoveredAt: string;
  plansAccess: PlansAccessStatus;
  jpdIssueTypes: Array<{
    projectId: string;
    projectKey: string;
    projectName: string;
    issueTypes: JiraIssueType[];
  }>;
  jpdPolarisFields: DiscoveredFieldRef[];
  jpdConnectionFields: DiscoveredFieldRef[];
  advancedRoadmapsFields: {
    parentLinkField?: DiscoveredFieldRef;
    teamField?: DiscoveredFieldRef;
    targetStartField?: DiscoveredFieldRef;
    targetEndField?: DiscoveredFieldRef;
  };
}

interface JiraSchemaSnapshot {
  discoveredAt: string;
  globalFields: {
    goalsField?: DiscoveredFieldRef;
    atlassianProjectField?: DiscoveredFieldRef;
    atlassianProjectStatusField?: DiscoveredFieldRef;
    deliveryProgressField?: DiscoveredFieldRef;
    deliveryStatusField?: DiscoveredFieldRef;
    primaryJpdIdeaKeyField?: DiscoveredFieldRef;
    parentLinkField?: DiscoveredFieldRef;
    teamField?: DiscoveredFieldRef;
    targetStartField?: DiscoveredFieldRef;
    targetEndField?: DiscoveredFieldRef;
  };
  jpdProjects: DiscoveredJpdProject[];
  premiumCapabilities?: JiraPremiumCapabilities;
}

interface MutationControl {
  mode?: MutationMode;
  idempotencyKey?: string;
  changeReason?: string;
}

interface IdeaMutationInput extends MutationControl {
  projectKey: string;
  summary: string;
  description?: string;
  horizon?: string;
  desiredOutcome?: string;
  hypothesis?: string;
  businessOwnerId?: string;
  techOwnerId?: string;
  adoptionOwnerId?: string;
  primaryBusinessGoalId?: string;
  adoptionGoalId?: string;
  atlassianProjectId?: string;
  status?: string;
}

interface IdeaUpdateInput extends MutationControl {
  issueKey?: string;
  issueId?: string;
  summary?: string;
  description?: string;
  horizon?: string;
  desiredOutcome?: string;
  hypothesis?: string;
  businessOwnerId?: string;
  techOwnerId?: string;
  adoptionOwnerId?: string;
  status?: string;
}

interface IdeaLinkInput extends MutationControl {
  issueKey?: string;
  issueId?: string;
  primaryBusinessGoalId: string;
  adoptionGoalId?: string;
  atlassianProjectId: string;
}

interface EpicMutationInput extends MutationControl {
  projectKey: string;
  summary: string;
  description?: string;
  goalIds?: string[];
  primaryJpdIdeaKey?: string;
  status?: string;
}

interface EpicUpdateInput extends MutationControl {
  issueKey?: string;
  issueId?: string;
  summary?: string;
  description?: string;
  goalIds?: string[];
  primaryJpdIdeaKey?: string;
  status?: string;
}

interface IdeaEpicLinkInput extends MutationControl {
  ideaKey: string;
  epicKey: string;
  primaryJpdIdeaKey?: string;
}

interface JpdConnectionInput extends MutationControl {
  issueKey: string;
  connectionFieldId?: string;
  connectionFieldName?: string;
  targetIssueKeys: string[];
  replace?: boolean;
}

interface PlanCreateInput extends MutationControl {
  name: string;
  issueSources: Array<{ type: "Project" | "Board" | "Filter"; value: number | string }>;
  scheduling?: Record<string, unknown>;
  leadAccountId?: string;
  permissions?: Array<Record<string, unknown>>;
  customFields?: Array<Record<string, unknown>>;
  exclusionRules?: Record<string, unknown>;
  crossProjectReleases?: Array<Record<string, unknown>>;
}

interface PlanUpdateInput extends MutationControl {
  planId: number | string;
  patch: Array<Record<string, unknown>>;
}

interface PortfolioFieldInput extends MutationControl {
  issueKey: string;
  parentLinkKey?: string;
  teamIdOrName?: string;
  targetStart?: string;
  targetEnd?: string;
}

interface DependencyLinkInput extends MutationControl {
  blocksIssueKey: string;
  blockedIssueKey: string;
  linkType?: string;
}

interface AssetsWorkspaceResponse {
  values: Array<{ workspaceId: string }>;
}

interface AssetObjectSchema {
  id: string;
  name: string;
  objectSchemaKey?: string;
  status?: string;
  description?: string;
  objectCount?: number;
  objectTypeCount?: number;
  canManage?: boolean;
}

interface AssetObjectSchemaListResponse {
  values?: AssetObjectSchema[];
  objectschemas?: AssetObjectSchema[];
}

interface AssetObjectType {
  id: string;
  name: string;
  description?: string;
  objectSchemaId?: string;
  objectCount?: number;
  type?: number;
  inherited?: boolean;
  abstractObjectType?: boolean;
  parentObjectTypeId?: string;
}

interface AssetObjectTypeAttribute {
  id: string;
  name: string;
  label?: boolean;
  type?: number;
  defaultType?: { id?: number; name?: string };
  editable?: boolean;
  system?: boolean;
  minimumCardinality?: number;
  maximumCardinality?: number;
  referenceObjectTypeId?: string;
  options?: string;
}

interface AssetObject {
  id: string;
  label?: string;
  name?: string;
  objectKey?: string;
  globalId?: string;
  workspaceId?: string;
  objectType?: AssetObjectType;
  attributes?: AssetObjectAttribute[];
  created?: string;
  updated?: string;
}

interface AssetObjectAttribute {
  id?: string;
  objectId?: string;
  objectTypeAttributeId?: string;
  objectTypeAttribute?: AssetObjectTypeAttribute;
  objectAttributeValues?: AssetObjectAttributeValue[];
}

interface AssetObjectAttributeValue {
  value?: unknown;
  displayValue?: string;
  searchValue?: string;
  referencedType?: boolean;
  referencedObject?: AssetObject;
}

interface AssetObjectSearchResponse {
  values?: AssetObject[];
  objectEntries?: AssetObject[];
  startAt?: number;
  maxResults?: number;
  total?: number;
  isLast?: boolean;
}

interface AssetAttributeInput {
  objectTypeAttributeId?: string;
  attributeName?: string;
  name?: string;
  value?: unknown;
  values?: unknown[];
  objectAttributeValues?: Array<Record<string, unknown>>;
}

interface AssetMutationInput extends MutationControl {
  objectTypeId: string;
  label?: string;
  attributes: AssetAttributeInput[];
}

interface AssetUpdateInput extends MutationControl {
  objectId: string;
  objectTypeId?: string;
  attributes: AssetAttributeInput[];
}

interface AssetDeleteInput extends MutationControl {
  objectId: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const configPath =
  process.env.ATLASSIAN_MCP_TENANT_MODEL_PATH ??
  path.join(repoRoot, "config", "tenant-model.local.json");

function createClient(): JiraRestClient {
  const env = loadJiraEnv();
  return new JiraRestClient({
    baseUrl: env.JIRA_URL,
    authHeader: buildBasicAuthHeader(env.JIRA_USERNAME, env.JIRA_API_TOKEN),
  });
}

class AssetsRestClient {
  private readonly clients: HttpClient[];

  constructor(options: { workspaceId: string; authHeader: string }) {
    const directBaseUrl = `https://api.atlassian.com/jsm/assets/workspace/${options.workspaceId}/v1`;
    const cloudId = process.env.ATLASSIAN_CLOUD_ID;
    const baseUrls = cloudId
      ? [
          directBaseUrl,
          `https://api.atlassian.com/ex/jira/${cloudId}/jsm/assets/workspace/${options.workspaceId}/v1`,
        ]
      : [directBaseUrl];

    this.clients = baseUrls.map(
      (baseUrl) =>
        new HttpClient({
          baseUrl,
          defaultHeaders: {
            Authorization: options.authHeader,
          },
        }),
    );
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastError: unknown;
    for (const client of this.clients) {
      try {
        return await client.request<T>(path, {
          method,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (error) {
        lastError = error;
        if (!(error instanceof HttpError) || ![401, 403, 404].includes(error.status)) {
          throw error;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Assets request failed.");
  }
}

async function resolveAssetsWorkspaceId(client = createClient()): Promise<string> {
  const response = await client.get<AssetsWorkspaceResponse>("/rest/servicedeskapi/assets/workspace?limit=10");
  const workspaceId = response.values?.[0]?.workspaceId;
  if (!workspaceId) {
    throw new Error("No Jira Assets workspace is visible for the current user.");
  }
  return workspaceId;
}

async function createAssetsClient(): Promise<{ workspaceId: string; client: AssetsRestClient }> {
  const env = loadJiraEnv();
  const workspaceId = await resolveAssetsWorkspaceId(
    new JiraRestClient({
      baseUrl: env.JIRA_URL,
      authHeader: buildBasicAuthHeader(env.JIRA_USERNAME, env.JIRA_API_TOKEN),
    }),
  );
  return {
    workspaceId,
    client: new AssetsRestClient({
      workspaceId,
      authHeader: buildBasicAuthHeader(env.JIRA_USERNAME, env.JIRA_API_TOKEN),
    }),
  };
}

async function loadAllProjects(client: JiraRestClient): Promise<JiraProject[]> {
  const results: JiraProject[] = [];
  let startAt = 0;
  while (true) {
    const page = await client.get<JiraProjectSearchResponse>(
      `/rest/api/3/project/search?startAt=${startAt}&maxResults=50`,
    );
    results.push(...page.values);
    if (page.isLast) {
      break;
    }
    startAt += page.maxResults;
  }
  return results;
}

function fieldRefFromField(field?: JiraField | JiraMetaField): DiscoveredFieldRef | undefined {
  if (!field) {
    return undefined;
  }
  const allowedValues = "allowedValues" in field ? field.allowedValues : undefined;
  const resolvedId = field.id || field.key;
  if (!resolvedId) {
    return undefined;
  }
  return {
    id: resolvedId,
    name: field.name,
    clauseName: field.clauseNames?.[0],
    schema: field.schema,
    operations: "operations" in field ? field.operations : undefined,
    scope: field.scope,
    options:
      allowedValues
        ?.filter((value): value is { id: string; value: string } => Boolean(value.id && value.value))
        .map((value) => ({ id: value.id, value: value.value })) ?? undefined,
  };
}

function normalizeFieldName(value: string): string {
  return value.trim().toLowerCase();
}

function pickField(
  fields: JiraField[],
  predicate: (field: JiraField) => boolean,
): JiraField | undefined {
  return fields.find(predicate);
}

function pickProjectScopedField(
  fields: JiraField[],
  projectId: string,
  predicate: (field: JiraField) => boolean,
): JiraField | undefined {
  return fields.find(
    (field) =>
      field.scope?.type === "PROJECT" &&
      field.scope.project?.id === projectId &&
      predicate(field),
  );
}

function fieldLooksLikeOption(field?: JiraField): boolean {
  return field?.schema?.type === "option" || field?.schema?.items === "option";
}

async function latestIssueKeyForProject(client: JiraRestClient, projectKey: string): Promise<string | undefined> {
  const response = await client.post<SearchJqlResponse>("/rest/api/3/search/jql", {
    jql: `project = "${projectKey}" ORDER BY created DESC`,
    maxResults: 1,
    fields: ["summary"],
  });
  return response.issues[0]?.key;
}

async function loadIdeaEditMeta(
  client: JiraRestClient,
  project: JiraProject,
  ideaIssueTypeId: string,
): Promise<Record<string, JiraMetaField>> {
  const latestIssueKey = await latestIssueKeyForProject(client, project.key);
  if (latestIssueKey) {
    const response = await client.get<{ fields: Record<string, JiraMetaField> }>(
      `/rest/api/3/issue/${encodeURIComponent(latestIssueKey)}/editmeta`,
    );
    return response.fields;
  }

  try {
    const response = await client.get<{ fields: Record<string, JiraMetaField> }>(
      `/rest/api/3/issue/createmeta/${project.id}/issuetypes/${ideaIssueTypeId}`,
    );
    return response.fields;
  } catch {
    return {};
  }
}

function pickByNameHeuristics(projectFields: JiraField[], projectId: string, aliases: string[]): JiraField | undefined {
  return pickProjectScopedField(projectFields, projectId, (field) =>
    aliases.includes(normalizeFieldName(field.name)),
  );
}

function pickMetaByNameHeuristics(
  editMeta: Record<string, JiraMetaField>,
  aliases: string[],
  predicate: (field: JiraMetaField) => boolean = () => true,
): JiraMetaField | undefined {
  return Object.values(editMeta).find((field) =>
    aliases.includes(normalizeFieldName(field.name)) && predicate(field),
  );
}

function buildFieldValue(field: DiscoveredFieldRef | undefined, value: unknown): unknown {
  if (!field || value === undefined || value === null) {
    return undefined;
  }

  const schema = field.schema;
  if (!schema) {
    return value;
  }

  if (field.options && typeof value === "string") {
    const matched = field.options.find(
      (option) => normalizeFieldName(option.value) === normalizeFieldName(value),
    );
    if (matched) {
      return { id: matched.id };
    }
  }

  if (schema.system === "description") {
    return typeof value === "string" ? textToAdfDocument(value) : value;
  }

  if (schema.custom?.endsWith(":textarea")) {
    return typeof value === "string" ? textToAdfDocument(value) : value;
  }

  if (schema.custom === "com.atlassian.jira.plugin.system.customfieldtypes:goals") {
    const values = Array.isArray(value) ? value : [value];
    return values
      .filter((item) => item !== undefined && item !== null)
      .map((item) => (typeof item === "string" ? { id: item } : item));
  }

  if (schema.custom === "jira.polaris:atlassian-project") {
    return value;
  }

  if (schema.custom?.includes("connection")) {
    const values = Array.isArray(value) ? value : [value];
    return values
      .filter((item) => item !== undefined && item !== null)
      .map((item) => {
        if (typeof item !== "string") {
          return item;
        }
        return { key: item };
      });
  }

  if (schema.custom === "com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team") {
    if (typeof value !== "string") {
      return value;
    }
    const matched = field.options?.find(
      (option) => normalizeFieldName(option.value) === normalizeFieldName(value) || option.id === value,
    );
    return { id: matched?.id ?? value };
  }

  if (schema.custom === "com.atlassian.jpo:jpo-custom-field-parent") {
    return value;
  }

  if (schema.type === "date") {
    return value;
  }

  if (schema.type === "user") {
    return typeof value === "string" ? { accountId: value } : value;
  }

  if (schema.items === "user") {
    const values = Array.isArray(value) ? value : [value];
    return values
      .filter((item): item is string => typeof item === "string")
      .map((accountId) => ({ accountId }));
  }

  if (schema.type === "array" && schema.items === "option" && Array.isArray(value)) {
    return value.map((item) =>
      typeof item === "string"
        ? { id: field.options?.find((option) => normalizeFieldName(option.value) === normalizeFieldName(item))?.id ?? item }
        : item,
    );
  }

  return value;
}

function isPolarisField(field: JiraField | JiraMetaField): boolean {
  return Boolean(field.schema?.custom?.startsWith("jira.polaris:"));
}

function isConnectionField(field: JiraField | JiraMetaField): boolean {
  const normalizedName = normalizeFieldName(field.name);
  const custom = field.schema?.custom ?? "";
  return custom.includes("connection") || normalizedName.includes("connection");
}

function fieldBySchemaCustom(fields: JiraField[], custom: string): DiscoveredFieldRef | undefined {
  return fieldRefFromField(pickField(fields, (field) => field.schema?.custom === custom));
}

async function probePlansAccess(client: JiraRestClient): Promise<PlansAccessStatus> {
  const endpoint = "/rest/api/3/plans/plan";
  try {
    const response = await client.get<{
      total?: number;
      values?: unknown[];
    }>(`${endpoint}?maxResults=5`);
    return {
      status: "available",
      endpoint,
      planCount: response.total ?? response.values?.length ?? 0,
      sample: response.values ?? [],
    };
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 401) {
        return {
          status: "unauthorized",
          endpoint,
          message: "Jira Plans API returned 401 Unauthorized for the current token.",
        };
      }
      if (error.status === 403) {
        return {
          status: "forbidden",
          endpoint,
          message: "Jira Plans API requires Administer Jira permission for this endpoint.",
        };
      }
      return {
        status: "unavailable",
        endpoint,
        message: `Jira Plans API returned HTTP ${error.status}.`,
      };
    }
    return {
      status: "unavailable",
      endpoint,
      message: error instanceof Error ? error.message : "Jira Plans API probe failed.",
    };
  }
}

function buildPremiumCapabilities(input: {
  fields: JiraField[];
  jpdProjects: DiscoveredJpdProject[];
  plansAccess: PlansAccessStatus;
}): JiraPremiumCapabilities {
  const jpdPolarisFields = input.fields
    .filter((field) => isPolarisField(field))
    .map((field) => fieldRefFromField(field))
    .filter((field): field is DiscoveredFieldRef => Boolean(field));
  const jpdConnectionFields = input.fields
    .filter((field) => isPolarisField(field) && isConnectionField(field))
    .map((field) => fieldRefFromField(field))
    .filter((field): field is DiscoveredFieldRef => Boolean(field));

  return {
    discoveredAt: new Date().toISOString(),
    plansAccess: input.plansAccess,
    jpdIssueTypes: input.jpdProjects.map((project) => ({
      projectId: project.id,
      projectKey: project.key,
      projectName: project.name,
      issueTypes: project.issueTypes ?? [],
    })),
    jpdPolarisFields,
    jpdConnectionFields,
    advancedRoadmapsFields: {
      parentLinkField: fieldBySchemaCustom(input.fields, "com.atlassian.jpo:jpo-custom-field-parent"),
      teamField: fieldBySchemaCustom(
        input.fields,
        "com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team",
      ),
      targetStartField: fieldBySchemaCustom(input.fields, "com.atlassian.jpo:jpo-custom-field-baseline-start"),
      targetEndField: fieldBySchemaCustom(input.fields, "com.atlassian.jpo:jpo-custom-field-baseline-end"),
    },
  };
}

async function loadSchemaSnapshot(forceRefresh = false): Promise<JiraSchemaSnapshot> {
  const current = await readTenantModelConfig(configPath);
  const fromConfig = (current.jira ?? {}) as Partial<JiraSchemaSnapshot>;
  if (!forceRefresh && fromConfig.discoveredAt && Array.isArray(fromConfig.jpdProjects)) {
    return {
      discoveredAt: fromConfig.discoveredAt,
      globalFields: fromConfig.globalFields ?? {},
      jpdProjects: fromConfig.jpdProjects as DiscoveredJpdProject[],
      premiumCapabilities: fromConfig.premiumCapabilities,
    };
  }
  return discoverJiraSchema();
}

export async function discoverJiraSchema(): Promise<JiraSchemaSnapshot> {
  const client = createClient();
  const [fields, projects] = await Promise.all([
    client.get<JiraField[]>("/rest/api/3/field"),
    loadAllProjects(client),
  ]);

  const jpdProjects: DiscoveredJpdProject[] = [];
  for (const project of projects.filter((item: JiraProject) => item.projectTypeKey === "product_discovery")) {
    const projectDetail = await client.get<JiraProject>(
      `/rest/api/3/project/${encodeURIComponent(project.key)}`,
    );
    const issueTypes = projectDetail.issueTypes ?? [];
    const ideaIssueType = issueTypes.find((issueType: JiraIssueType) => issueType.name === "Idea");

    const projectFields = fields.filter(
      (field: JiraField) => field.scope?.type === "PROJECT" && field.scope.project?.id === project.id,
    );
    const editMeta = ideaIssueType ? await loadIdeaEditMeta(client, project, ideaIssueType.id) : {};
    const polarisFields = projectFields
      .filter((field) => isPolarisField(field))
      .map((field) => fieldRefFromField(field))
      .filter((field): field is DiscoveredFieldRef => Boolean(field));
    const connectionFields = Object.values(editMeta)
      .filter((field) => isConnectionField(field))
      .map((field) => fieldRefFromField(field))
      .filter((field): field is DiscoveredFieldRef => Boolean(field));

    const horizonAliases = ["roadmap", "horizon", "now/next/later", "now / next / later"];
    const horizonField =
      fieldRefFromField(
        pickMetaByNameHeuristics(editMeta, horizonAliases, (field) => fieldLooksLikeOption(field)),
      ) ||
      fieldRefFromField(
        pickByNameHeuristics(projectFields, project.id, horizonAliases),
      );
    const desiredOutcomeField = fieldRefFromField(
      pickByNameHeuristics(projectFields, project.id, ["desired outcome", "outcome", "desired outcomes"]),
    );
    const hypothesisField = fieldRefFromField(
      pickByNameHeuristics(projectFields, project.id, ["hypothesis", "hypotheses"]),
    );
    const businessOwnerField = fieldRefFromField(
      pickByNameHeuristics(projectFields, project.id, ["business owner"]),
    );
    const techOwnerField = fieldRefFromField(
      pickByNameHeuristics(projectFields, project.id, ["tech owner", "technical owner"]),
    );
    const adoptionOwnerField = fieldRefFromField(
      pickByNameHeuristics(projectFields, project.id, ["adoption owner"]),
    );

    if (horizonField?.options === undefined && horizonField) {
      const metaField = editMeta[horizonField.id];
      if (metaField?.allowedValues) {
        horizonField.options = metaField.allowedValues
          .filter((value): value is { id: string; value: string } => Boolean(value.id && value.value))
          .map((value) => ({ id: value.id, value: value.value }));
      }
    }

    jpdProjects.push({
      id: project.id,
      key: project.key,
      name: project.name,
      issueTypes,
      ideaIssueTypeId: ideaIssueType?.id,
      horizonField,
      desiredOutcomeField,
      hypothesisField,
      businessOwnerField,
      techOwnerField,
      adoptionOwnerField,
      premiumFields: {
        polarisFields,
        connectionFields,
      },
    });
  }

  const plansAccess = await probePlansAccess(client);
  const snapshot: JiraSchemaSnapshot = {
    discoveredAt: new Date().toISOString(),
    globalFields: {
      goalsField: fieldRefFromField(
        pickField(fields, (field) => field.schema?.custom === "com.atlassian.jira.plugin.system.customfieldtypes:goals"),
      ),
      atlassianProjectField: fieldRefFromField(
        pickField(fields, (field) => field.schema?.custom === "jira.polaris:atlassian-project"),
      ),
      atlassianProjectStatusField: fieldRefFromField(
        pickField(fields, (field) => field.schema?.custom === "jira.polaris:atlassian-project-status"),
      ),
      deliveryProgressField: fieldRefFromField(
        pickField(fields, (field) => field.schema?.custom === "jira.polaris:delivery-progress"),
      ),
      deliveryStatusField: fieldRefFromField(
        pickField(fields, (field) => field.schema?.custom === "jira.polaris:delivery-status"),
      ),
      primaryJpdIdeaKeyField: fieldRefFromField(
        pickField(fields, (field) => normalizeFieldName(field.name) === "primary jpd idea key"),
      ),
      parentLinkField: fieldBySchemaCustom(fields, "com.atlassian.jpo:jpo-custom-field-parent"),
      teamField: fieldBySchemaCustom(
        fields,
        "com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team",
      ),
      targetStartField: fieldBySchemaCustom(fields, "com.atlassian.jpo:jpo-custom-field-baseline-start"),
      targetEndField: fieldBySchemaCustom(fields, "com.atlassian.jpo:jpo-custom-field-baseline-end"),
    },
    jpdProjects,
  };
  snapshot.premiumCapabilities = buildPremiumCapabilities({ fields, jpdProjects, plansAccess });

  await updateTenantModelConfig(configPath, (current: Record<string, unknown>) => ({
    ...current,
    jira: snapshot,
  }));

  return snapshot;
}

export async function discoverPremiumCapabilities(): Promise<JiraPremiumCapabilities> {
  const snapshot = await discoverJiraSchema();
  if (!snapshot.premiumCapabilities) {
    throw new Error("Premium capability discovery did not produce a result.");
  }
  return snapshot.premiumCapabilities;
}

export async function healthCheck() {
  const client = createClient();
  const [schema, projects] = await Promise.all([
    loadSchemaSnapshot(),
    client.get<{ accountId: string; displayName: string }>("/rest/api/3/myself"),
  ]);
  return {
    ok: true,
    actor: projects,
    jpdSpaceCount: schema.jpdProjects.length,
    globalFields: schema.globalFields,
  };
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return "";
  }
  return `?${entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&")}`;
}

function redactAssetsPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactAssetsPayload);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "mediaJwtToken") {
      result[key] = "[redacted]";
    } else {
      result[key] = redactAssetsPayload(child);
    }
  }
  return result;
}

function normalizeAssetValue(value: AssetObjectAttributeValue) {
  return {
    value: value.value ?? null,
    displayValue: value.displayValue ?? null,
    searchValue: value.searchValue ?? null,
    referencedType: value.referencedType ?? false,
    referencedObject: value.referencedObject
      ? {
          id: value.referencedObject.id,
          objectKey: value.referencedObject.objectKey,
          label: value.referencedObject.label ?? value.referencedObject.name ?? null,
          objectType: value.referencedObject.objectType
            ? {
                id: value.referencedObject.objectType.id,
                name: value.referencedObject.objectType.name,
                objectSchemaId: value.referencedObject.objectType.objectSchemaId,
              }
            : null,
        }
      : null,
  };
}

function normalizeAssetAttribute(attribute: AssetObjectAttribute) {
  const definition = attribute.objectTypeAttribute;
  return {
    id: attribute.id ?? null,
    objectTypeAttributeId: attribute.objectTypeAttributeId ?? definition?.id ?? null,
    name: definition?.name ?? null,
    label: definition?.label ?? false,
    editable: definition?.editable ?? null,
    system: definition?.system ?? null,
    minimumCardinality: definition?.minimumCardinality ?? null,
    maximumCardinality: definition?.maximumCardinality ?? null,
    defaultType: definition?.defaultType ?? null,
    values: (attribute.objectAttributeValues ?? []).map(normalizeAssetValue),
  };
}

function normalizeAssetObject(object: AssetObject) {
  return {
    id: object.id,
    objectKey: object.objectKey ?? null,
    label: object.label ?? object.name ?? null,
    globalId: object.globalId ?? null,
    workspaceId: object.workspaceId ?? null,
    objectType: object.objectType
      ? {
          id: object.objectType.id,
          name: object.objectType.name,
          objectSchemaId: object.objectType.objectSchemaId,
        }
      : null,
    created: object.created ?? null,
    updated: object.updated ?? null,
    attributes: (object.attributes ?? []).map(normalizeAssetAttribute),
  };
}

function schemasFromResponse(response: AssetObjectSchemaListResponse | AssetObjectSchema[]): AssetObjectSchema[] {
  if (Array.isArray(response)) {
    return response;
  }
  return response.values ?? response.objectschemas ?? [];
}

function objectsFromSearchResponse(response: AssetObjectSearchResponse | AssetObject[]): AssetObject[] {
  if (Array.isArray(response)) {
    return response;
  }
  return response.values ?? response.objectEntries ?? [];
}

function quoteAql(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function pickLabelAttribute(attributes: AssetObjectTypeAttribute[]): AssetObjectTypeAttribute | undefined {
  return (
    attributes.find((attribute) => attribute.label && attribute.editable !== false) ??
    attributes.find((attribute) => normalizeFieldName(attribute.name) === "name" && attribute.editable !== false)
  );
}

function requiredEditableAttributes(attributes: AssetObjectTypeAttribute[]): AssetObjectTypeAttribute[] {
  return attributes.filter(
    (attribute) =>
      attribute.editable !== false &&
      !attribute.system &&
      (attribute.minimumCardinality ?? 0) > 0,
  );
}

function resolveAssetAttributeId(
  input: AssetAttributeInput,
  definitions: AssetObjectTypeAttribute[],
): string {
  if (input.objectTypeAttributeId) {
    return input.objectTypeAttributeId;
  }

  const name = input.attributeName ?? input.name;
  if (!name) {
    throw new Error("Asset attribute requires objectTypeAttributeId or attributeName.");
  }

  const match = definitions.find((definition) => normalizeFieldName(definition.name) === normalizeFieldName(name));
  if (!match) {
    throw new Error(`Asset attribute "${name}" does not exist on this object type.`);
  }
  if (match.editable === false || match.system) {
    throw new Error(`Asset attribute "${name}" is not value-editable.`);
  }
  return match.id;
}

function normalizeAssetAttributeInputValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function buildAssetAttributePayload(
  inputAttributes: AssetAttributeInput[],
  definitions: AssetObjectTypeAttribute[],
): Array<{ objectTypeAttributeId: string; objectAttributeValues: Array<Record<string, unknown>> }> {
  return inputAttributes.map((attribute) => {
    const values = attribute.objectAttributeValues ?? (attribute.values ?? [attribute.value]).map(normalizeAssetAttributeInputValue);
    return {
      objectTypeAttributeId: resolveAssetAttributeId(attribute, definitions),
      objectAttributeValues: values.filter((value) => value.value !== undefined || Object.keys(value).length > 0),
    };
  });
}

function assertRequiredAssetAttributesPresent(
  payloadAttributes: Array<{ objectTypeAttributeId: string }>,
  definitions: AssetObjectTypeAttribute[],
): void {
  const supplied = new Set(payloadAttributes.map((attribute) => attribute.objectTypeAttributeId));
  const missing = requiredEditableAttributes(definitions).filter((definition) => !supplied.has(definition.id));
  if (missing.length > 0) {
    throw new Error(
      `Missing required Assets attributes: ${missing.map((attribute) => `${attribute.name} (${attribute.id})`).join(", ")}.`,
    );
  }
}

async function loadAssetObjectTypeAttributes(
  client: AssetsRestClient,
  objectTypeId: string,
): Promise<AssetObjectTypeAttribute[]> {
  return client.get<AssetObjectTypeAttribute[]>(
    `/objecttype/${encodeURIComponent(objectTypeId)}/attributes?onlyValueEditable=false&includeChildren=false`,
  );
}

async function searchExistingAssetByLabel(input: {
  client: AssetsRestClient;
  objectType: AssetObjectType;
  labelAttribute?: AssetObjectTypeAttribute;
  label?: string;
}): Promise<ReturnType<typeof normalizeAssetObject> | undefined> {
  if (!input.label || !input.labelAttribute) {
    return undefined;
  }

  const response = await input.client.post<AssetObjectSearchResponse>(
    "/object/aql?startAt=0&maxResults=25&includeAttributes=true",
    {
      qlQuery: `objectType = ${quoteAql(input.objectType.name)} AND ${quoteAql(input.labelAttribute.name)} = ${quoteAql(input.label)}`,
    },
  );
  const match = objectsFromSearchResponse(response).find(
    (object) => normalizeFieldName(object.label ?? object.name ?? "") === normalizeFieldName(input.label ?? ""),
  );
  return match ? normalizeAssetObject(redactAssetsPayload(match) as AssetObject) : undefined;
}

export async function assetsHealthCheck() {
  const jiraClient = createClient();
  const actor = await jiraClient.get<{ accountId: string; displayName: string }>("/rest/api/3/myself");
  const workspaceId = await resolveAssetsWorkspaceId(jiraClient);
  const { client } = await createAssetsClient();
  const schemaResponse = await client.get<AssetObjectSchemaListResponse>(
    "/objectschema/list?startAt=0&maxResults=50&includeCounts=true",
  );
  const schemas = schemasFromResponse(schemaResponse).map((schema) => ({
    id: schema.id,
    key: schema.objectSchemaKey ?? null,
    name: schema.name,
    objectCount: schema.objectCount ?? null,
    objectTypeCount: schema.objectTypeCount ?? null,
    canManage: schema.canManage ?? null,
  }));

  return {
    ok: true,
    actor,
    workspaceId,
    schemaCount: schemas.length,
    schemas,
  };
}

export async function listAssetSchemas(input: { maxResults?: number; includeCounts?: boolean } = {}) {
  const { workspaceId, client } = await createAssetsClient();
  const response = await client.get<AssetObjectSchemaListResponse>(
    `/objectschema/list${buildQuery({
      startAt: 0,
      maxResults: input.maxResults ?? 50,
      includeCounts: input.includeCounts ?? true,
    })}`,
  );
  return {
    workspaceId,
    items: schemasFromResponse(response).map((schema) => ({
      id: schema.id,
      key: schema.objectSchemaKey ?? null,
      name: schema.name,
      status: schema.status ?? null,
      description: schema.description ?? null,
      objectCount: schema.objectCount ?? null,
      objectTypeCount: schema.objectTypeCount ?? null,
      canManage: schema.canManage ?? null,
    })),
  };
}

export async function listAssetObjectTypes(input: { objectSchemaId: string; flat?: boolean }) {
  const { workspaceId, client } = await createAssetsClient();
  const endpoint = input.flat === false
    ? `/objectschema/${encodeURIComponent(input.objectSchemaId)}/objecttypes`
    : `/objectschema/${encodeURIComponent(input.objectSchemaId)}/objecttypes/flat`;
  const response = await client.get<AssetObjectType[]>(endpoint);
  return {
    workspaceId,
    objectSchemaId: input.objectSchemaId,
    items: response.map((objectType) => ({
      id: objectType.id,
      name: objectType.name,
      description: objectType.description ?? null,
      objectSchemaId: objectType.objectSchemaId ?? input.objectSchemaId,
      objectCount: objectType.objectCount ?? null,
      type: objectType.type ?? null,
      inherited: objectType.inherited ?? null,
      abstractObjectType: objectType.abstractObjectType ?? null,
      parentObjectTypeId: objectType.parentObjectTypeId ?? null,
    })),
  };
}

export async function getAssetObjectType(input: { objectTypeId: string }) {
  const { workspaceId, client } = await createAssetsClient();
  const objectType = await client.get<AssetObjectType>(`/objecttype/${encodeURIComponent(input.objectTypeId)}`);
  return {
    workspaceId,
    item: redactAssetsPayload(objectType),
  };
}

export async function listAssetObjectTypeAttributes(input: {
  objectTypeId: string;
  onlyValueEditable?: boolean;
  includeChildren?: boolean;
}) {
  const { workspaceId, client } = await createAssetsClient();
  const attributes = await client.get<AssetObjectTypeAttribute[]>(
    `/objecttype/${encodeURIComponent(input.objectTypeId)}/attributes${buildQuery({
      onlyValueEditable: input.onlyValueEditable,
      includeChildren: input.includeChildren ?? true,
      orderByName: true,
    })}`,
  );
  return {
    workspaceId,
    objectTypeId: input.objectTypeId,
    items: attributes.map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      label: attribute.label ?? false,
      type: attribute.type ?? null,
      defaultType: attribute.defaultType ?? null,
      editable: attribute.editable ?? null,
      system: attribute.system ?? null,
      minimumCardinality: attribute.minimumCardinality ?? null,
      maximumCardinality: attribute.maximumCardinality ?? null,
      referenceObjectTypeId: attribute.referenceObjectTypeId ?? null,
      options: attribute.options ?? null,
    })),
  };
}

export async function searchAssetObjects(input: {
  aql: string;
  startAt?: number;
  maxResults?: number;
  includeAttributes?: boolean;
}) {
  const { workspaceId, client } = await createAssetsClient();
  const response = await client.post<AssetObjectSearchResponse>(
    `/object/aql${buildQuery({
      startAt: input.startAt ?? 0,
      maxResults: input.maxResults ?? 25,
      includeAttributes: input.includeAttributes ?? true,
    })}`,
    { qlQuery: input.aql },
  );
  return {
    workspaceId,
    startAt: response.startAt ?? input.startAt ?? 0,
    maxResults: response.maxResults ?? input.maxResults ?? 25,
    total: response.total ?? null,
    isLast: response.isLast ?? null,
    items: objectsFromSearchResponse(redactAssetsPayload(response) as AssetObjectSearchResponse).map(normalizeAssetObject),
  };
}

export async function getAssetObject(input: { objectId: string }) {
  const { workspaceId, client } = await createAssetsClient();
  const object = await client.get<AssetObject>(`/object/${encodeURIComponent(input.objectId)}`);
  return {
    workspaceId,
    item: normalizeAssetObject(redactAssetsPayload(object) as AssetObject),
  };
}

export async function getAssetObjectAttributes(input: { objectId: string }) {
  const { workspaceId, client } = await createAssetsClient();
  const attributes = await client.get<AssetObjectAttribute[]>(
    `/object/${encodeURIComponent(input.objectId)}/attributes`,
  );
  return {
    workspaceId,
    objectId: input.objectId,
    items: (redactAssetsPayload(attributes) as AssetObjectAttribute[]).map(normalizeAssetAttribute),
  };
}

export async function createAssetObject(input: AssetMutationInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const { workspaceId, client } = await createAssetsClient();
  const [objectType, attributeDefinitions] = await Promise.all([
    client.get<AssetObjectType>(`/objecttype/${encodeURIComponent(input.objectTypeId)}`),
    loadAssetObjectTypeAttributes(client, input.objectTypeId),
  ]);
  const labelAttribute = pickLabelAttribute(attributeDefinitions);
  const requestedAttributes = [...input.attributes];
  if (input.label && labelAttribute && !requestedAttributes.some((attribute) =>
    (attribute.objectTypeAttributeId && attribute.objectTypeAttributeId === labelAttribute.id) ||
    normalizeFieldName(attribute.attributeName ?? attribute.name ?? "") === normalizeFieldName(labelAttribute.name)
  )) {
    requestedAttributes.push({ objectTypeAttributeId: labelAttribute.id, value: input.label });
  }
  const attributes = buildAssetAttributePayload(requestedAttributes, attributeDefinitions);
  assertRequiredAssetAttributesPresent(attributes, attributeDefinitions);

  const payload = {
    objectTypeId: input.objectTypeId,
    attributes,
  };
  const preview = buildAuditResult(
    {
      intent: "Create Assets object",
      target: input.label ?? objectType.name,
      warnings: [],
      steps: [
        {
          kind: "rest",
          description: "Create an Assets object.",
          endpoint: "/object/create",
          input: payload,
        },
      ],
      rollbackHint: "Delete the created Assets object if the pilot object should be removed.",
      result: {
        workspaceId,
        objectType: {
          id: objectType.id,
          name: objectType.name,
          objectSchemaId: objectType.objectSchemaId ?? null,
        },
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "assets.create_object",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: { name: input.label },
    fingerprintInput: payload,
    preview,
    apply: async () => {
      const existing = input.idempotencyKey
        ? await searchExistingAssetByLabel({ client, objectType, labelAttribute, label: input.label })
        : undefined;
      let created = existing;
      let appliedMutation = false;
      if (!created) {
        const response = await client.post<AssetObject>("/object/create", payload);
        created = normalizeAssetObject(redactAssetsPayload(response) as AssetObject);
        appliedMutation = true;
      }
      return {
        ...buildAuditResult(
          {
            intent: preview.intent,
            target: created.objectKey ?? created.id,
            warnings: existing ? ["Reused an existing pilot Assets object matched by exact label."] : [],
            steps: preview.steps,
            rollbackHint: preview.rollbackHint,
            result: {
              workspaceId,
              item: created,
            },
          },
          mode,
          appliedMutation,
        ),
        deduplicated: Boolean(existing && !appliedMutation),
      };
    },
  });
}

export async function updateAssetObject(input: AssetUpdateInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const { workspaceId, client } = await createAssetsClient();
  const before = await getAssetObject({ objectId: input.objectId });
  const currentObjectTypeId =
    input.objectTypeId ?? before.item.objectType?.id;
  if (!currentObjectTypeId) {
    throw new Error(`Unable to resolve objectTypeId for Assets object ${input.objectId}.`);
  }
  const attributeDefinitions = await loadAssetObjectTypeAttributes(client, currentObjectTypeId);
  const payload = {
    objectTypeId: currentObjectTypeId,
    attributes: buildAssetAttributePayload(input.attributes, attributeDefinitions),
  };
  const preview = buildAuditResult(
    {
      intent: "Update Assets object",
      target: before.item.objectKey ?? input.objectId,
      warnings: [],
      steps: [
        {
          kind: "rest",
          description: "Update editable attributes on an Assets object.",
          endpoint: `/object/${input.objectId}`,
          input: payload,
          before,
        },
      ],
      rollbackHint: "Re-run update_asset_object with previous attribute values from the audit before snapshot.",
      result: {
        before,
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "assets.update_object",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: { existingName: before.item.label },
    fingerprintInput: { objectId: input.objectId, payload },
    preview,
    apply: async () => {
      await client.put<AssetObject>(`/object/${encodeURIComponent(input.objectId)}`, payload);
      const after = await getAssetObject({ objectId: input.objectId });
      return buildAuditResult(
        {
          intent: preview.intent,
          target: preview.target,
          warnings: [],
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result: {
            workspaceId,
            before: before.item,
            after: after.item,
          },
        },
        mode,
        true,
      );
    },
  });
}

export async function deleteAssetObject(input: AssetDeleteInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const { workspaceId, client } = await createAssetsClient();
  const before = await getAssetObject({ objectId: input.objectId });
  const preview = buildAuditResult(
    {
      intent: "Delete Assets object",
      target: before.item.objectKey ?? input.objectId,
      warnings: [],
      steps: [
        {
          kind: "rest",
          description: "Delete an Assets object.",
          endpoint: `/object/${input.objectId}`,
          before,
        },
      ],
      rollbackHint: "Recreate the object from the audit before snapshot if rollback is required.",
      result: {
        before,
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "assets.delete_object",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: { existingName: before.item.label },
    fingerprintInput: { objectId: input.objectId },
    preview,
    apply: async () => {
      await client.delete<void>(`/object/${encodeURIComponent(input.objectId)}`);
      return buildAuditResult(
        {
          intent: preview.intent,
          target: preview.target,
          warnings: [],
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result: {
            workspaceId,
            deleted: before.item,
          },
        },
        mode,
        true,
      );
    },
  });
}

export async function searchSpaces(input: { searchString?: string }) {
  const schema = await loadSchemaSnapshot();
  const needle = normalizeFieldName(input.searchString ?? "");
  const items = schema.jpdProjects.filter((project) =>
    needle.length === 0
      ? true
      : normalizeFieldName(`${project.key} ${project.name}`).includes(needle),
  );
  return { items };
}

export async function listJpdIssueTypes(input: { projectKey?: string }) {
  const schema = await loadSchemaSnapshot();
  const projects = input.projectKey
    ? schema.jpdProjects.filter((project) => project.key === input.projectKey)
    : schema.jpdProjects;
  return {
    items: projects.map((project) => ({
      projectId: project.id,
      projectKey: project.key,
      projectName: project.name,
      issueTypes: project.issueTypes ?? [],
    })),
  };
}

export async function searchJpdItems(input: {
  projectKeys?: string[];
  issueTypeNames?: string[];
  issueTypeIds?: string[];
  statuses?: string[];
  searchText?: string;
  atlassianProjectId?: string;
  atlassianProjectIds?: string[];
  batchAtlassianProjectId?: string;
  batchAtlassianProjectIds?: string[];
  maxResults?: number;
  nextPageToken?: string;
}) {
  const schema = await loadSchemaSnapshot();
  const projects =
    input.projectKeys && input.projectKeys.length > 0
      ? schema.jpdProjects.filter((project) => input.projectKeys?.includes(project.key))
      : schema.jpdProjects;

  const projectClauses = projects.flatMap((project) => {
    const issueTypes = project.issueTypes ?? [];
    const filteredTypes = issueTypes.filter((issueType) => {
      const nameMatch = !input.issueTypeNames?.length || input.issueTypeNames.includes(issueType.name);
      const idMatch = !input.issueTypeIds?.length || input.issueTypeIds.includes(issueType.id);
      return nameMatch && idMatch;
    });
    const selectedTypes =
      input.issueTypeNames?.length || input.issueTypeIds?.length ? filteredTypes : issueTypes;
    if (selectedTypes.length === 0) {
      return [];
    }
    const parts = [
      `project = ${quoteJql(project.key)}`,
      `issuetype in (${selectedTypes.map((issueType) => quoteJql(issueType.name)).join(", ")})`,
    ];
    if (input.statuses?.length) {
      parts.push(`status in (${input.statuses.map(quoteJql).join(", ")})`);
    }
    return [`(${parts.join(" AND ")})`];
  });

  if (projectClauses.length === 0) {
    return { nextPageToken: null, items: [] };
  }

  const jqlParts = [`(${projectClauses.join(" OR ")})`];
  if (input.searchText) {
    jqlParts.push(`summary ~ ${quoteJql(input.searchText)}`);
  }
  const batchAtlassianProjectIds = unique(
    [
      input.atlassianProjectId,
      input.batchAtlassianProjectId,
      ...(input.atlassianProjectIds ?? []),
      ...(input.batchAtlassianProjectIds ?? []),
    ].filter((value): value is string => Boolean(value)),
  );
  if (batchAtlassianProjectIds.length > 0) {
    const atlassianProjectField = schema.globalFields.atlassianProjectField;
    if (!atlassianProjectField) {
      throw new Error("Jira schema is missing the Atlassian project field required for batch filtering.");
    }
    const fieldJql = `cf[${atlassianProjectField.id.replace("customfield_", "")}]`;
    const valueJql =
      batchAtlassianProjectIds.length === 1
        ? `= ${quoteJql(batchAtlassianProjectIds[0] ?? "")}`
        : `in (${batchAtlassianProjectIds.map(quoteJql).join(", ")})`;
    jqlParts.push(`${fieldJql} ${valueJql}`);
  }

  const response = await createClient().post<SearchJqlResponse>("/rest/api/3/search/jql", {
    jql: jqlParts.join(" AND "),
    maxResults: input.maxResults ?? 20,
    nextPageToken: input.nextPageToken,
    fields: unique(projects.flatMap((project) => fieldIdsForProject(project, schema))),
  });

  return {
    nextPageToken: response.nextPageToken ?? null,
    items: response.issues.map((issue) => {
      const projectKey = ((issue.fields.project as { key?: string } | undefined)?.key ?? "") as string;
      return normalizeIssue(issue, schema, issueProjectMapping(schema, projectKey));
    }),
  };
}

export async function getJpdItem(input: { issueKey?: string; issueId?: string }) {
  const issueKeyOrId = input.issueKey ?? input.issueId;
  if (!issueKeyOrId) {
    throw new Error("Expected issueKey or issueId.");
  }
  return fetchIssue(issueKeyOrId);
}

export async function discoverJpdConnections(input: { projectKey?: string }) {
  const schema = await loadSchemaSnapshot(true);
  const projects = input.projectKey
    ? schema.jpdProjects.filter((project) => project.key === input.projectKey)
    : schema.jpdProjects;
  return {
    globalConnectionFields: schema.premiumCapabilities?.jpdConnectionFields ?? [],
    projects: projects.map((project) => ({
      projectKey: project.key,
      projectName: project.name,
      connectionFields: project.premiumFields?.connectionFields ?? [],
      polarisFields: project.premiumFields?.polarisFields ?? [],
    })),
  };
}

function quoteJql(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function issueProjectMapping(schema: JiraSchemaSnapshot, projectKey: string): DiscoveredJpdProject | undefined {
  return schema.jpdProjects.find((project) => project.key === projectKey);
}

function fieldIdsForProject(project?: DiscoveredJpdProject, schema?: JiraSchemaSnapshot): string[] {
  return unique(
    [
      "summary",
      "description",
      "status",
      "issuetype",
      "project",
      "issuelinks",
      schema?.globalFields.goalsField?.id,
      schema?.globalFields.atlassianProjectField?.id,
      schema?.globalFields.atlassianProjectStatusField?.id,
      schema?.globalFields.deliveryProgressField?.id,
      schema?.globalFields.deliveryStatusField?.id,
      schema?.globalFields.primaryJpdIdeaKeyField?.id,
      project?.horizonField?.id,
      project?.desiredOutcomeField?.id,
      project?.hypothesisField?.id,
      project?.businessOwnerField?.id,
      project?.techOwnerField?.id,
      project?.adoptionOwnerField?.id,
      ...(project?.premiumFields?.polarisFields ?? []).map((field) => field.id),
      ...(project?.premiumFields?.connectionFields ?? []).map((field) => field.id),
      schema?.globalFields.parentLinkField?.id,
      schema?.globalFields.teamField?.id,
      schema?.globalFields.targetStartField?.id,
      schema?.globalFields.targetEndField?.id,
    ].filter((value): value is string => Boolean(value)),
  );
}

function normalizeIssue(issue: JiraIssue, schema: JiraSchemaSnapshot, project: DiscoveredJpdProject | undefined) {
  const fields = issue.fields;
  const globalFields = schema.globalFields;
  const projectField = (field?: DiscoveredFieldRef) => (field ? fields[field.id] : undefined);
  return {
    id: issue.id,
    key: issue.key,
    summary: fields.summary ?? null,
    description: fields.description ?? null,
    status: fields.status ?? null,
    issueType: fields.issuetype ?? null,
    project: fields.project ?? null,
    goals: globalFields.goalsField ? fields[globalFields.goalsField.id] ?? null : null,
    atlassianProject: globalFields.atlassianProjectField
      ? fields[globalFields.atlassianProjectField.id] ?? null
      : null,
    atlassianProjectStatus: globalFields.atlassianProjectStatusField
      ? fields[globalFields.atlassianProjectStatusField.id] ?? null
      : null,
    horizon: projectField(project?.horizonField) ?? null,
    desiredOutcome: projectField(project?.desiredOutcomeField) ?? null,
    hypothesis: projectField(project?.hypothesisField) ?? null,
    businessOwner: projectField(project?.businessOwnerField) ?? null,
    techOwner: projectField(project?.techOwnerField) ?? null,
    adoptionOwner: projectField(project?.adoptionOwnerField) ?? null,
    deliveryProgress: globalFields.deliveryProgressField
      ? fields[globalFields.deliveryProgressField.id] ?? null
      : null,
    deliveryStatus: globalFields.deliveryStatusField
      ? fields[globalFields.deliveryStatusField.id] ?? null
      : null,
    primaryJpdIdeaKey: globalFields.primaryJpdIdeaKeyField
      ? fields[globalFields.primaryJpdIdeaKeyField.id] ?? null
      : null,
    parentLink: globalFields.parentLinkField ? fields[globalFields.parentLinkField.id] ?? null : null,
    team: globalFields.teamField ? fields[globalFields.teamField.id] ?? null : null,
    targetStart: globalFields.targetStartField ? fields[globalFields.targetStartField.id] ?? null : null,
    targetEnd: globalFields.targetEndField ? fields[globalFields.targetEndField.id] ?? null : null,
    issueLinks: fields.issuelinks ?? [],
    rawFields: fields,
  };
}

type NormalizedIssue = ReturnType<typeof normalizeIssue>;

function projectKeyFromIssue(issue: NormalizedIssue): string | undefined {
  const project = issue.project;
  if (!project || typeof project !== "object") {
    return undefined;
  }
  const key = (project as { key?: unknown }).key;
  return typeof key === "string" ? key : undefined;
}

function goalIdsFromIssueField(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item && typeof item === "object" && "id" in item) {
        return String((item as { id?: unknown }).id ?? "");
      }
      return "";
    })
    .filter((item) => item.length > 0);
}

function goalsReadbackWarnings(issue: NormalizedIssue, expectedGoalIds: string[]): string[] {
  const actualGoalIds = new Set(goalIdsFromIssueField(issue.goals));
  const missingGoalIds = expectedGoalIds.filter((goalId) => !actualGoalIds.has(goalId));
  if (missingGoalIds.length === 0) {
    return [];
  }
  return [
    `Jira REST accepted the Goals field write, but read-back did not contain ${missingGoalIds.join(", ")}. This matches Atlassian JRACLOUD-97866: the Goals custom field currently cannot be reliably set through /rest/api/3/issue.`,
  ];
}

async function fetchIssue(issueKeyOrId: string, schema?: JiraSchemaSnapshot): Promise<ReturnType<typeof normalizeIssue>> {
  const snapshot = schema ?? (await loadSchemaSnapshot());
  const client = createClient();
  const base = await client.get<JiraIssue>(
    `/rest/api/3/issue/${encodeURIComponent(issueKeyOrId)}?fields=summary,project`,
  );
  const projectKey = ((base.fields.project as { key?: string } | undefined)?.key ?? "") as string;
  const project = issueProjectMapping(snapshot, projectKey);
  const full = await client.get<JiraIssue>(
    `/rest/api/3/issue/${encodeURIComponent(issueKeyOrId)}?fields=${encodeURIComponent(fieldIdsForProject(project, snapshot).join(","))}`,
  );
  return normalizeIssue(full, snapshot, project);
}

async function transitionIssueIfNeeded(issueKey: string, statusName: string | undefined): Promise<boolean> {
  if (!statusName) {
    return false;
  }

  const client = createClient();
  const issue = await client.get<JiraIssue>(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status`,
  );
  const currentStatus = (issue.fields.status as { name?: string } | undefined)?.name;
  if (currentStatus && normalizeFieldName(currentStatus) === normalizeFieldName(statusName)) {
    return false;
  }

  const transitions = await client.get<{
    transitions: Array<{ id: string; name: string }>;
  }>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`);

  const target = transitions.transitions.find(
    (transition: { id: string; name: string }) =>
      normalizeFieldName(transition.name) === normalizeFieldName(statusName),
  );
  if (!target) {
    throw new Error(`Transition "${statusName}" is not available for ${issueKey}.`);
  }

  await client.post(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    transition: { id: target.id },
  });
  return true;
}

async function resolveIdeaIssueTypeId(projectKey: string): Promise<string> {
  const client = createClient();
  const project = await client.get<JiraProject>(`/rest/api/3/project/${encodeURIComponent(projectKey)}`);
  const issueType = project.issueTypes?.find((value: JiraIssueType) => value.name === "Idea");
  if (!issueType) {
    throw new Error(`Project ${projectKey} does not expose an Idea issue type.`);
  }
  return issueType.id;
}

async function resolveEpicIssueTypeId(projectKey: string): Promise<string> {
  const client = createClient();
  const project = await client.get<JiraProject>(`/rest/api/3/project/${encodeURIComponent(projectKey)}`);
  const issueType = project.issueTypes?.find((value: JiraIssueType) => value.name === "Epic");
  if (!issueType) {
    throw new Error(`Project ${projectKey} does not expose an Epic issue type.`);
  }
  return issueType.id;
}

function normalizeMetaFields(fields?: Record<string, JiraMetaField> | JiraMetaField[]): Record<string, JiraMetaField> {
  const result: Record<string, JiraMetaField> = {};
  const values = Array.isArray(fields) ? fields : Object.values(fields ?? {});
  for (const field of values) {
    for (const key of [field.id, field.key, field.fieldId, field.schema?.system].filter(
      (value): value is string => Boolean(value),
    )) {
      result[key] = field;
    }
  }
  return result;
}

async function loadCreateMetaFields(projectKey: string, issueTypeId: string): Promise<Record<string, JiraMetaField>> {
  const client = createClient();
  const project = await client.get<JiraProject>(`/rest/api/3/project/${encodeURIComponent(projectKey)}`);
  const response = await client.get<{ fields?: Record<string, JiraMetaField> | JiraMetaField[] }>(
    `/rest/api/3/issue/createmeta/${project.id}/issuetypes/${issueTypeId}`,
  );
  return normalizeMetaFields(response.fields);
}

async function loadIssueEditMeta(issueKey: string): Promise<Record<string, JiraMetaField>> {
  const response = await createClient().get<{ fields: Record<string, JiraMetaField> }>(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/editmeta`,
  );
  return normalizeMetaFields(response.fields);
}

function filterFieldsForCreateMeta(
  fields: Record<string, unknown>,
  createMetaFields: Record<string, JiraMetaField>,
): { fields: Record<string, unknown>; skippedFields: string[] } {
  const filtered: Record<string, unknown> = {};
  const skippedFields: string[] = [];
  for (const [fieldId, value] of Object.entries(fields)) {
    if (createMetaFields[fieldId]) {
      filtered[fieldId] = value;
    } else {
      skippedFields.push(fieldId);
    }
  }
  return { fields: filtered, skippedFields };
}

function buildIdeaFields(
  schema: JiraSchemaSnapshot,
  project: DiscoveredJpdProject,
  input: Omit<IdeaMutationInput, "projectKey" | "mode" | "idempotencyKey" | "changeReason" | "status">,
  resolvedOwners: { businessOwnerId?: string; techOwnerId?: string; adoptionOwnerId?: string },
) {
  const global = schema.globalFields;
  const fields: Record<string, unknown> = {
    summary: input.summary,
  };
  if (input.description) {
    fields.description = textToAdfDocument(input.description);
  }
  if (project.horizonField && input.horizon) {
    fields[project.horizonField.id] = buildFieldValue(project.horizonField, input.horizon);
  }
  if (project.desiredOutcomeField && input.desiredOutcome) {
    fields[project.desiredOutcomeField.id] = buildFieldValue(project.desiredOutcomeField, input.desiredOutcome);
  }
  if (project.hypothesisField && input.hypothesis) {
    fields[project.hypothesisField.id] = buildFieldValue(project.hypothesisField, input.hypothesis);
  }
  if (project.businessOwnerField && resolvedOwners.businessOwnerId) {
    fields[project.businessOwnerField.id] = buildFieldValue(project.businessOwnerField, resolvedOwners.businessOwnerId);
  }
  if (project.techOwnerField && resolvedOwners.techOwnerId) {
    fields[project.techOwnerField.id] = buildFieldValue(project.techOwnerField, resolvedOwners.techOwnerId);
  }
  if (project.adoptionOwnerField && resolvedOwners.adoptionOwnerId) {
    fields[project.adoptionOwnerField.id] = buildFieldValue(project.adoptionOwnerField, resolvedOwners.adoptionOwnerId);
  }
  if (global.goalsField && input.primaryBusinessGoalId) {
    fields[global.goalsField.id] = buildFieldValue(global.goalsField, [
      input.primaryBusinessGoalId,
      ...(input.adoptionGoalId ? [input.adoptionGoalId] : []),
    ]);
  }
  if (global.atlassianProjectField && input.atlassianProjectId) {
    fields[global.atlassianProjectField.id] = buildFieldValue(global.atlassianProjectField, input.atlassianProjectId);
  }
  return fields;
}

function buildEpicFields(
  schema: JiraSchemaSnapshot,
  input: Omit<EpicMutationInput, "projectKey" | "mode" | "idempotencyKey" | "changeReason" | "status">,
) {
  const fields: Record<string, unknown> = {
    summary: input.summary,
  };
  if (input.description) {
    fields.description = textToAdfDocument(input.description);
  }
  if (schema.globalFields.goalsField && input.goalIds?.length) {
    fields[schema.globalFields.goalsField.id] = buildFieldValue(
      schema.globalFields.goalsField,
      input.goalIds,
    );
  }
  if (schema.globalFields.primaryJpdIdeaKeyField && input.primaryJpdIdeaKey) {
    fields[schema.globalFields.primaryJpdIdeaKeyField.id] = input.primaryJpdIdeaKey;
  }
  return fields;
}

function assertIdeaCreateModel(schema: JiraSchemaSnapshot, input: IdeaMutationInput): void {
  if (!input.primaryBusinessGoalId) {
    throw new Error("JPD idea requires primaryBusinessGoalId in the V1 model.");
  }
  if (!input.atlassianProjectId) {
    throw new Error("JPD idea requires exactly one atlassianProjectId in the V1 model.");
  }
  if (!schema.globalFields.goalsField) {
    throw new Error("Jira schema is missing the Goals field required by the V1 model.");
  }
  if (!schema.globalFields.atlassianProjectField) {
    throw new Error("Jira schema is missing the Atlassian project field required by the V1 model.");
  }
}

async function findIssueByExactSummary(input: {
  client: JiraRestClient;
  schema: JiraSchemaSnapshot;
  projectKey: string;
  issueType: "Idea" | "Epic";
  summary: string;
}) {
  const searchNeedle = input.summary.startsWith(DEFAULT_PILOT_PREFIX) ? "MCPTEST" : input.summary;
  const response = await input.client.post<SearchJqlResponse>("/rest/api/3/search/jql", {
    jql: [
      `project = ${quoteJql(input.projectKey)}`,
      `issuetype = ${quoteJql(input.issueType)}`,
      `summary ~ ${quoteJql(searchNeedle)}`,
    ].join(" AND ") + " ORDER BY created DESC",
    maxResults: 50,
    fields: ["summary", "project"],
  });
  const match = response.issues.find((issue) => issue.fields.summary === input.summary);
  return match ? fetchIssue(match.key, input.schema) : undefined;
}

export async function searchIdeas(input: {
  projectKeys?: string[];
  statuses?: string[];
  horizon?: string;
  linkedGoalId?: string;
  atlassianProjectId?: string;
  searchText?: string;
  maxResults?: number;
  nextPageToken?: string;
}) {
  const schema = await loadSchemaSnapshot();
  const projects =
    input.projectKeys && input.projectKeys.length > 0
      ? schema.jpdProjects.filter((project) => input.projectKeys?.includes(project.key))
      : schema.jpdProjects;

  const projectClauses = projects.map((project) => {
    const parts = [`project = ${quoteJql(project.key)}`, "issuetype = Idea"];
    if (input.statuses?.length) {
      parts.push(`status in (${input.statuses.map(quoteJql).join(", ")})`);
    }
    if (input.horizon && project.horizonField) {
      parts.push(`cf[${project.horizonField.id.replace("customfield_", "")}] = ${quoteJql(input.horizon)}`);
    }
    return `(${parts.join(" AND ")})`;
  });

  const jqlParts = [`(${projectClauses.join(" OR ")})`];
  if (input.linkedGoalId && schema.globalFields.goalsField) {
    jqlParts.push(
      `cf[${schema.globalFields.goalsField.id.replace("customfield_", "")}] = ${quoteJql(input.linkedGoalId)}`,
    );
  }
  if (input.atlassianProjectId && schema.globalFields.atlassianProjectField) {
    jqlParts.push(
      `cf[${schema.globalFields.atlassianProjectField.id.replace("customfield_", "")}] = ${quoteJql(input.atlassianProjectId)}`,
    );
  }
  if (input.searchText) {
    jqlParts.push(`summary ~ ${quoteJql(input.searchText)}`);
  }

  const client = createClient();
  const response = await client.post<SearchJqlResponse>("/rest/api/3/search/jql", {
    jql: jqlParts.join(" AND "),
    maxResults: input.maxResults ?? 20,
    nextPageToken: input.nextPageToken,
    fields: unique(
      projects.flatMap((project) => fieldIdsForProject(project, schema)),
    ),
  });

  return {
    nextPageToken: response.nextPageToken ?? null,
    items: response.issues.map((issue: JiraIssue) => {
      const projectKey = ((issue.fields.project as { key?: string } | undefined)?.key ?? "") as string;
      return normalizeIssue(issue, schema, issueProjectMapping(schema, projectKey));
    }),
  };
}

export async function getIdea(input: { issueKey?: string; issueId?: string }) {
  const issueKeyOrId = input.issueKey ?? input.issueId;
  if (!issueKeyOrId) {
    throw new Error("Expected issueKey or issueId.");
  }
  return fetchIssue(issueKeyOrId);
}

export async function createIdea(input: IdeaMutationInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const schema = await loadSchemaSnapshot();
  const project = issueProjectMapping(schema, input.projectKey);
  if (!project) {
    throw new Error(`Unknown JPD space "${input.projectKey}". Run discover_jira_schema first.`);
  }
  if (!project.ideaIssueTypeId) {
    throw new Error(`JPD space "${input.projectKey}" does not expose an Idea issue type.`);
  }
  assertIdeaCreateModel(schema, input);

  const client = createClient();
  const resolvedOwners = {
    businessOwnerId: input.businessOwnerId
      ? await resolveAccountId(input.businessOwnerId, client)
      : undefined,
    techOwnerId: input.techOwnerId ? await resolveAccountId(input.techOwnerId, client) : undefined,
    adoptionOwnerId: input.adoptionOwnerId
      ? await resolveAccountId(input.adoptionOwnerId, client)
      : undefined,
  };
  const fields = buildIdeaFields(schema, project, input, resolvedOwners);
  const createPayload = {
    fields: {
      project: { key: input.projectKey },
      issuetype: { id: project.ideaIssueTypeId },
      ...fields,
    },
  };

  const previewSteps: AuditStep[] = [
    {
      kind: "rest" as const,
      description: "Create a JPD idea as a standard Jira issue of type Idea.",
      endpoint: "/rest/api/3/issue",
      input: createPayload,
    },
  ];
  if (input.status) {
    previewSteps.push({
      kind: "rest" as const,
      description: "Transition the idea to the requested status.",
      endpoint: "/rest/api/3/issue/{key}/transitions",
      input: { status: input.status },
    });
  }

  const preview = buildAuditResult(
    {
      intent: "Create JPD idea",
      target: input.summary,
      warnings: [],
      steps: previewSteps,
      rollbackHint: "Delete the created idea from Jira Product Discovery if the pilot object should be removed.",
      result: {
        projectKey: input.projectKey,
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "jira.create_idea",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      name: input.summary,
      refs: [input.projectKey],
    },
    fingerprintInput: createPayload,
    preview,
    apply: async () => {
      const existing = input.idempotencyKey
        ? await findIssueByExactSummary({
            client,
            schema,
            projectKey: input.projectKey,
            issueType: "Idea",
            summary: input.summary,
          })
        : undefined;
      let issueKey = existing?.key;
      let appliedMutation = false;

      if (!issueKey) {
        const created = await client.post<{ key: string; id: string }>("/rest/api/3/issue", createPayload);
        issueKey = created.key;
        appliedMutation = true;
      }

      const transitioned = await transitionIssueIfNeeded(issueKey, input.status);
      appliedMutation = appliedMutation || transitioned;
      const after = await getIdea({ issueKey });
      const warnings = [
        ...(existing ? ["Reused an existing pilot idea matched by exact summary during idempotent create."] : []),
        ...goalsReadbackWarnings(
          after,
          [input.primaryBusinessGoalId, input.adoptionGoalId].filter((value): value is string => Boolean(value)),
        ),
      ];
      return {
        ...buildAuditResult(
          {
            intent: preview.intent,
            target: issueKey,
            warnings,
            steps: preview.steps,
            rollbackHint: preview.rollbackHint,
            result: after,
          },
          mode,
          appliedMutation,
        ),
        deduplicated: Boolean(existing && !appliedMutation),
      };
    },
  });
}

export async function updateIdea(input: IdeaUpdateInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const current = await getIdea(input);
  const schema = await loadSchemaSnapshot();
  const projectKey = ((current.project as { key?: string } | undefined)?.key ?? "") as string;
  const project = issueProjectMapping(schema, projectKey);
  if (!project) {
    throw new Error(`Idea ${current.key} is not in a discovered JPD project.`);
  }
  const client = createClient();
  const resolvedOwners = {
    businessOwnerId: input.businessOwnerId
      ? await resolveAccountId(input.businessOwnerId, client)
      : undefined,
    techOwnerId: input.techOwnerId ? await resolveAccountId(input.techOwnerId, client) : undefined,
    adoptionOwnerId: input.adoptionOwnerId
      ? await resolveAccountId(input.adoptionOwnerId, client)
      : undefined,
  };

  const fields: Record<string, unknown> = {};
  if (input.summary) {
    fields.summary = input.summary;
  }
  if (input.description) {
    fields.description = textToAdfDocument(input.description);
  }
  if (project.horizonField && input.horizon) {
    fields[project.horizonField.id] = buildFieldValue(project.horizonField, input.horizon);
  }
  if (project.desiredOutcomeField && input.desiredOutcome) {
    fields[project.desiredOutcomeField.id] = buildFieldValue(project.desiredOutcomeField, input.desiredOutcome);
  }
  if (project.hypothesisField && input.hypothesis) {
    fields[project.hypothesisField.id] = buildFieldValue(project.hypothesisField, input.hypothesis);
  }
  if (project.businessOwnerField && resolvedOwners.businessOwnerId) {
    fields[project.businessOwnerField.id] = buildFieldValue(project.businessOwnerField, resolvedOwners.businessOwnerId);
  }
  if (project.techOwnerField && resolvedOwners.techOwnerId) {
    fields[project.techOwnerField.id] = buildFieldValue(project.techOwnerField, resolvedOwners.techOwnerId);
  }
  if (project.adoptionOwnerField && resolvedOwners.adoptionOwnerId) {
    fields[project.adoptionOwnerField.id] = buildFieldValue(project.adoptionOwnerField, resolvedOwners.adoptionOwnerId);
  }

  const previewSteps: AuditStep[] = [
    {
      kind: "rest" as const,
      description: "Update JPD idea fields.",
      endpoint: `/rest/api/3/issue/${current.key}`,
      input: { fields },
      before: current,
    },
  ];
  if (input.status) {
    previewSteps.push({
      kind: "rest" as const,
      description: "Transition the idea to the requested status.",
      endpoint: `/rest/api/3/issue/${current.key}/transitions`,
      input: { status: input.status },
    });
  }

  const preview = buildAuditResult(
    {
      intent: "Update JPD idea",
      target: current.key,
      warnings: [],
      steps: previewSteps,
      rollbackHint: "Use Jira issue history or transition the idea back if rollback is needed.",
      result: {
        before: current,
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "jira.update_idea",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      existingName: String(current.summary ?? ""),
      refs: [current.key, projectKeyFromIssue(current)].filter((value): value is string => Boolean(value)),
    },
    fingerprintInput: { key: current.key, fields, status: input.status },
    preview,
    apply: async () => {
      if (Object.keys(fields).length > 0) {
        await client.put(`/rest/api/3/issue/${encodeURIComponent(current.key)}`, { fields });
      }
      await transitionIssueIfNeeded(current.key, input.status);
      const after = await getIdea({ issueKey: current.key });
      return buildAuditResult(
        {
          intent: preview.intent,
          target: current.key,
          warnings: [],
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result: after,
        },
        mode,
        true,
      );
    },
  });
}

export async function setIdeaLinks(input: IdeaLinkInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const schema = await loadSchemaSnapshot();
  const current = await getIdea(input);
  if (!schema.globalFields.goalsField || !schema.globalFields.atlassianProjectField) {
    throw new Error("Jira schema is missing Goals or Atlassian project field mapping.");
  }

  const fields = {
    [schema.globalFields.goalsField.id]: buildFieldValue(schema.globalFields.goalsField, [
      input.primaryBusinessGoalId,
      ...(input.adoptionGoalId ? [input.adoptionGoalId] : []),
    ]),
    [schema.globalFields.atlassianProjectField.id]: buildFieldValue(
      schema.globalFields.atlassianProjectField,
      input.atlassianProjectId,
    ),
  };

  const preview = buildAuditResult(
    {
      intent: "Set JPD idea links",
      target: current.key,
      warnings: [],
      steps: [
        {
          kind: "rest",
          description: "Set primary business goal, optional adoption goal, and exactly one Atlassian Project on the idea.",
          endpoint: `/rest/api/3/issue/${current.key}`,
          input: { fields },
          before: current,
        },
      ],
      rollbackHint: "Re-run set_idea_links with the previous goal/project values if rollback is needed.",
      result: {
        before: current,
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "jira.set_idea_links",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      existingName: String(current.summary ?? ""),
      refs: [current.key, projectKeyFromIssue(current)].filter((value): value is string => Boolean(value)),
    },
    fingerprintInput: { issueKey: current.key, fields },
    preview,
    apply: async () => {
      await createClient().put(`/rest/api/3/issue/${encodeURIComponent(current.key)}`, { fields });
      const after = await getIdea({ issueKey: current.key });
      const warnings = goalsReadbackWarnings(
        after,
        [input.primaryBusinessGoalId, input.adoptionGoalId].filter((value): value is string => Boolean(value)),
      );
      return buildAuditResult(
        {
          intent: preview.intent,
          target: current.key,
          warnings,
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result: after,
        },
        mode,
        true,
      );
    },
  });
}

function findEditableFieldByIdOrName(
  editMeta: Record<string, JiraMetaField>,
  input: { fieldId?: string; fieldName?: string },
): JiraMetaField | undefined {
  const normalizedName = input.fieldName ? normalizeFieldName(input.fieldName) : undefined;
  return Object.values(editMeta).find((field) => {
    const ids = [field.id, field.key, field.fieldId].filter((value): value is string => Boolean(value));
    return (
      (input.fieldId ? ids.includes(input.fieldId) : false) ||
      (normalizedName ? normalizeFieldName(field.name) === normalizedName : false)
    );
  });
}

function hasEditOperation(field: JiraMetaField, operation: "set" | "add"): boolean {
  return field.operations?.includes(operation) ?? false;
}

function fieldValueContainsTargets(value: unknown, targetIssueKeys: string[]): boolean {
  const serialized = JSON.stringify(value ?? "");
  return targetIssueKeys.every((issueKey) => serialized.includes(issueKey));
}

export async function setJpdConnection(input: JpdConnectionInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const replace = input.replace ?? true;
  if (!input.connectionFieldId && !input.connectionFieldName) {
    throw new Error("Expected connectionFieldId or connectionFieldName.");
  }
  if (input.targetIssueKeys.length === 0) {
    throw new Error("Expected at least one targetIssueKey.");
  }

  const current = await getJpdItem({ issueKey: input.issueKey });
  const editMeta = await loadIssueEditMeta(current.key);
  const metaField = findEditableFieldByIdOrName(editMeta, {
    fieldId: input.connectionFieldId,
    fieldName: input.connectionFieldName,
  });
  if (!metaField) {
    const availableConnectionFields = Object.values(editMeta)
      .filter((field) => isConnectionField(field))
      .map((field) => ({ id: field.id, key: field.key, name: field.name, operations: field.operations }));
    throw new Error(
      `Connection field is not editable on ${current.key}. Available connection-like fields: ${JSON.stringify(availableConnectionFields)}.`,
    );
  }
  if (replace && !hasEditOperation(metaField, "set")) {
    throw new Error(`Field "${metaField.name}" does not support the set operation required by replace=true.`);
  }
  if (!replace && !hasEditOperation(metaField, "add")) {
    throw new Error(`Field "${metaField.name}" does not support the add operation required by replace=false.`);
  }

  const fieldRef = fieldRefFromField(metaField);
  const normalizedValue = buildFieldValue(fieldRef, input.targetIssueKeys);
  const payload = replace
    ? { fields: { [fieldRef?.id ?? metaField.id]: normalizedValue } }
    : {
        update: {
          [fieldRef?.id ?? metaField.id]: (Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue]).map(
            (value) => ({ add: value }),
          ),
        },
      };

  const preview = buildAuditResult(
    {
      intent: "Set JPD connection field",
      target: current.key,
      warnings: [
        "JPD connection field payloads are tenant-configured. Apply mode validates editmeta before write and read-back after write.",
      ],
      steps: [
        {
          kind: "rest",
          description: replace ? "Replace the JPD connection field value." : "Add target issues to the JPD connection field.",
          endpoint: `/rest/api/3/issue/${current.key}`,
          input: payload,
          before: current,
        },
      ],
      rollbackHint: "Re-run set_jpd_connection with the previous connection targets, or revert from Jira issue history.",
      result: {
        before: current,
        field: fieldRef,
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "jira.set_jpd_connection",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      existingName: String(current.summary ?? ""),
      refs: [current.key, projectKeyFromIssue(current)].filter((value): value is string => Boolean(value)),
    },
    fingerprintInput: { issueKey: current.key, field: fieldRef?.id ?? metaField.id, targetIssueKeys: input.targetIssueKeys, replace },
    preview,
    apply: async () => {
      await createClient().put(`/rest/api/3/issue/${encodeURIComponent(current.key)}`, payload);
      const after = await getJpdItem({ issueKey: current.key });
      const readBack = fieldRef ? after.rawFields[fieldRef.id] : undefined;
      if (!fieldValueContainsTargets(readBack, input.targetIssueKeys)) {
        throw new Error(`Jira accepted the connection update, but read-back did not confirm all targets on ${current.key}.`);
      }
      return buildAuditResult(
        {
          intent: preview.intent,
          target: current.key,
          warnings: [],
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result: after,
        },
        mode,
        true,
      );
    },
  });
}

export async function searchEpics(input: {
  projectKeys?: string[];
  statuses?: string[];
  searchText?: string;
  maxResults?: number;
  nextPageToken?: string;
}) {
  const schema = await loadSchemaSnapshot();
  const jqlParts = ["issuetype = Epic"];
  if (input.projectKeys?.length) {
    jqlParts.push(`project in (${input.projectKeys.map(quoteJql).join(", ")})`);
  }
  if (input.statuses?.length) {
    jqlParts.push(`status in (${input.statuses.map(quoteJql).join(", ")})`);
  }
  if (input.searchText) {
    jqlParts.push(`summary ~ ${quoteJql(input.searchText)}`);
  }
  const fields = unique([
    "summary",
    "description",
    "status",
    "issuetype",
    "project",
    schema.globalFields.goalsField?.id,
    schema.globalFields.primaryJpdIdeaKeyField?.id,
    "issuelinks",
  ].filter((value): value is string => Boolean(value)));

  const response = await createClient().post<SearchJqlResponse>("/rest/api/3/search/jql", {
    jql: jqlParts.join(" AND "),
    maxResults: input.maxResults ?? 20,
    nextPageToken: input.nextPageToken,
    fields,
  });

  return {
    nextPageToken: response.nextPageToken ?? null,
    items: response.issues.map((issue: JiraIssue) => normalizeIssue(issue, schema, undefined)),
  };
}

export async function getEpic(input: { issueKey?: string; issueId?: string }) {
  const issueKeyOrId = input.issueKey ?? input.issueId;
  if (!issueKeyOrId) {
    throw new Error("Expected issueKey or issueId.");
  }
  const schema = await loadSchemaSnapshot();
  const client = createClient();
  const issue = await client.get<JiraIssue>(
    `/rest/api/3/issue/${encodeURIComponent(issueKeyOrId)}?fields=${encodeURIComponent(
      unique([
        "summary",
        "description",
        "status",
        "issuetype",
        "project",
        "issuelinks",
        schema.globalFields.goalsField?.id,
        schema.globalFields.primaryJpdIdeaKeyField?.id,
      ].filter((value): value is string => Boolean(value))).join(","),
    )}`,
  );
  return normalizeIssue(issue, schema, undefined);
}

export async function plansHealthCheck(): Promise<PlansAccessStatus> {
  return probePlansAccess(createClient());
}

export async function listPlans(input: {
  includeArchived?: boolean;
  includeTrashed?: boolean;
  maxResults?: number;
  cursor?: string;
}) {
  const query = buildQuery({
    includeArchived: input.includeArchived,
    includeTrashed: input.includeTrashed,
    maxResults: input.maxResults ?? 20,
    cursor: input.cursor,
  });
  try {
    const response = await createClient().get<unknown>(`/rest/api/3/plans/plan${query}`);
    return {
      status: "available",
      response,
    };
  } catch (error) {
    if (error instanceof HttpError && [401, 403].includes(error.status)) {
      return {
        status: error.status === 401 ? "unauthorized" : "forbidden",
        message:
          error.status === 403
            ? "Jira Plans API requires Administer Jira permission for this endpoint."
            : "Jira Plans API returned 401 Unauthorized for the current token.",
      };
    }
    throw error;
  }
}

export async function getPlan(input: { planId: string | number }) {
  try {
    return {
      status: "available",
      response: await createClient().get<unknown>(`/rest/api/3/plans/plan/${encodeURIComponent(String(input.planId))}`),
    };
  } catch (error) {
    if (error instanceof HttpError && [401, 403].includes(error.status)) {
      return {
        status: error.status === 401 ? "unauthorized" : "forbidden",
        message:
          error.status === 403
            ? "Jira Plans API requires Administer Jira permission for this endpoint."
            : "Jira Plans API returned 401 Unauthorized for the current token.",
      };
    }
    throw error;
  }
}

export async function createPlan(input: PlanCreateInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const payload = {
    name: input.name,
    issueSources: input.issueSources,
    scheduling: input.scheduling,
    leadAccountId: input.leadAccountId,
    permissions: input.permissions,
    customFields: input.customFields,
    exclusionRules: input.exclusionRules,
    crossProjectReleases: input.crossProjectReleases,
  };
  const preview = buildAuditResult(
    {
      intent: "Create Jira Plan",
      target: input.name,
      warnings: ["Jira Plans create/update APIs require Administer Jira permission."],
      steps: [
        {
          kind: "rest",
          description: "Create a Jira Plan through the Jira Plans API.",
          endpoint: "/rest/api/3/plans/plan",
          input: payload,
        },
      ],
      rollbackHint: "Archive or delete the created Jira Plan from Jira Plans if rollback is needed.",
      result: { name: input.name },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "jira.create_plan",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: { name: input.name },
    fingerprintInput: payload,
    preview,
    apply: async () => {
      const result = await createClient().post<unknown>("/rest/api/3/plans/plan", payload);
      return buildAuditResult(
        {
          intent: preview.intent,
          target: input.name,
          warnings: [],
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result,
        },
        mode,
        true,
      );
    },
  });
}

export async function updatePlan(input: PlanUpdateInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const preview = buildAuditResult(
    {
      intent: "Update Jira Plan",
      target: String(input.planId),
      warnings: ["Jira Plans create/update APIs require Administer Jira permission."],
      steps: [
        {
          kind: "rest",
          description: "Patch a Jira Plan through the Jira Plans API.",
          endpoint: `/rest/api/3/plans/plan/${input.planId}`,
          input: input.patch,
        },
      ],
      rollbackHint: "Use Jira Plan history/configuration to reverse the patch if needed.",
      result: { planId: input.planId },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "jira.update_plan",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: { refs: [String(input.planId)] },
    fingerprintInput: { planId: input.planId, patch: input.patch },
    preview,
    apply: async () => {
      const result = await createClient().put<unknown>(
        `/rest/api/3/plans/plan/${encodeURIComponent(String(input.planId))}`,
        input.patch,
      );
      return buildAuditResult(
        {
          intent: preview.intent,
          target: String(input.planId),
          warnings: [],
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result,
        },
        mode,
        true,
      );
    },
  });
}

export async function createEpic(input: EpicMutationInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const schema = await loadSchemaSnapshot();
  const epicIssueTypeId = await resolveEpicIssueTypeId(input.projectKey);
  const createMetaFields = await loadCreateMetaFields(input.projectKey, epicIssueTypeId);
  const builtFields = buildEpicFields(schema, input);
  const { fields, skippedFields } = filterFieldsForCreateMeta(builtFields, createMetaFields);
  const payload = {
    fields: {
      project: { key: input.projectKey },
      issuetype: { id: epicIssueTypeId },
      ...fields,
    },
  };

  const previewSteps: AuditStep[] = [
    {
      kind: "rest" as const,
      description: "Create a Jira Epic.",
      endpoint: "/rest/api/3/issue",
      input: payload,
    },
  ];
  if (input.status) {
    previewSteps.push({
      kind: "rest" as const,
      description: "Transition the epic to the requested status.",
      endpoint: "/rest/api/3/issue/{key}/transitions",
      input: { status: input.status },
    });
  }

  const preview = buildAuditResult(
    {
      intent: "Create Jira Epic",
      target: input.summary,
      warnings: [
        ...(schema.globalFields.primaryJpdIdeaKeyField
          ? []
          : ["Primary JPD Idea Key helper field is not configured in this tenant, so that part of the linkage will be skipped."]),
        ...skippedFields.map((fieldId) => `Field "${fieldId}" is not on the Epic create screen for ${input.projectKey} and was skipped.`),
      ],
      steps: previewSteps,
      rollbackHint: "Delete the created Epic in Jira Software if it should be removed.",
      result: {
        projectKey: input.projectKey,
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "jira.create_epic",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      name: input.summary,
      refs: [input.projectKey],
    },
    fingerprintInput: payload,
    preview,
    apply: async () => {
      const client = createClient();
      const existing = input.idempotencyKey
        ? await findIssueByExactSummary({
            client,
            schema,
            projectKey: input.projectKey,
            issueType: "Epic",
            summary: input.summary,
          })
        : undefined;
      let issueKey = existing?.key;
      let appliedMutation = false;

      if (!issueKey) {
        const created = await client.post<{ key: string; id: string }>("/rest/api/3/issue", payload);
        issueKey = created.key;
        appliedMutation = true;
      }

      const transitioned = await transitionIssueIfNeeded(issueKey, input.status);
      appliedMutation = appliedMutation || transitioned;
      const after = await getEpic({ issueKey });
      return {
        ...buildAuditResult(
          {
            intent: preview.intent,
            target: issueKey,
            warnings: existing
              ? [...preview.warnings, "Reused an existing pilot Epic matched by exact summary during idempotent create."]
              : preview.warnings,
            steps: preview.steps,
            rollbackHint: preview.rollbackHint,
            result: after,
          },
          mode,
          appliedMutation,
        ),
        deduplicated: Boolean(existing && !appliedMutation),
      };
    },
  });
}

export async function updateEpic(input: EpicUpdateInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const schema = await loadSchemaSnapshot();
  const current = await getEpic(input);
  const fields: Record<string, unknown> = {};
  if (input.summary) {
    fields.summary = input.summary;
  }
  if (input.description) {
    fields.description = textToAdfDocument(input.description);
  }
  if (schema.globalFields.goalsField && input.goalIds) {
    fields[schema.globalFields.goalsField.id] = buildFieldValue(
      schema.globalFields.goalsField,
      input.goalIds,
    );
  }
  if (schema.globalFields.primaryJpdIdeaKeyField && input.primaryJpdIdeaKey) {
    fields[schema.globalFields.primaryJpdIdeaKeyField.id] = input.primaryJpdIdeaKey;
  }

  const previewSteps: AuditStep[] = [
    {
      kind: "rest" as const,
      description: "Update Epic fields.",
      endpoint: `/rest/api/3/issue/${current.key}`,
      input: { fields },
      before: current,
    },
  ];
  if (input.status) {
    previewSteps.push({
      kind: "rest" as const,
      description: "Transition the Epic to the requested status.",
      endpoint: `/rest/api/3/issue/${current.key}/transitions`,
      input: { status: input.status },
    });
  }

  const preview = buildAuditResult(
    {
      intent: "Update Jira Epic",
      target: current.key,
      warnings: [],
      steps: previewSteps,
      rollbackHint: "Use Jira history or transition back if rollback is needed.",
      result: {
        before: current,
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "jira.update_epic",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      existingName: String(current.summary ?? ""),
      refs: [current.key, projectKeyFromIssue(current)].filter((value): value is string => Boolean(value)),
    },
    fingerprintInput: { key: current.key, fields, status: input.status },
    preview,
    apply: async () => {
      if (Object.keys(fields).length > 0) {
        await createClient().put(`/rest/api/3/issue/${encodeURIComponent(current.key)}`, { fields });
      }
      await transitionIssueIfNeeded(current.key, input.status);
      const after = await getEpic({ issueKey: current.key });
      return buildAuditResult(
        {
          intent: preview.intent,
          target: current.key,
          warnings: [],
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result: after,
        },
        mode,
        true,
      );
    },
  });
}

function fieldJqlClause(field: DiscoveredFieldRef): string {
  return field.id.startsWith("customfield_") ? `cf[${field.id.replace("customfield_", "")}]` : quoteJql(field.name);
}

function portfolioFieldIds(schema: JiraSchemaSnapshot): string[] {
  return unique(
    [
      "summary",
      "description",
      "status",
      "issuetype",
      "project",
      "issuelinks",
      schema.globalFields.parentLinkField?.id,
      schema.globalFields.teamField?.id,
      schema.globalFields.targetStartField?.id,
      schema.globalFields.targetEndField?.id,
      schema.globalFields.goalsField?.id,
      schema.globalFields.primaryJpdIdeaKeyField?.id,
    ].filter((value): value is string => Boolean(value)),
  );
}

export async function searchPortfolioItems(input: {
  projectKeys?: string[];
  issueTypes?: string[];
  parentLink?: string;
  team?: string;
  targetStartFrom?: string;
  targetEndTo?: string;
  statuses?: string[];
  searchText?: string;
  maxResults?: number;
  nextPageToken?: string;
}) {
  const schema = await loadSchemaSnapshot();
  const jqlParts: string[] = [];
  if (input.projectKeys?.length) {
    jqlParts.push(`project in (${input.projectKeys.map(quoteJql).join(", ")})`);
  }
  if (input.issueTypes?.length) {
    jqlParts.push(`issuetype in (${input.issueTypes.map(quoteJql).join(", ")})`);
  }
  if (input.statuses?.length) {
    jqlParts.push(`status in (${input.statuses.map(quoteJql).join(", ")})`);
  }
  if (input.parentLink && schema.globalFields.parentLinkField) {
    jqlParts.push(`${fieldJqlClause(schema.globalFields.parentLinkField)} = ${quoteJql(input.parentLink)}`);
  }
  if (input.team && schema.globalFields.teamField) {
    jqlParts.push(`${fieldJqlClause(schema.globalFields.teamField)} = ${quoteJql(input.team)}`);
  }
  if (input.targetStartFrom && schema.globalFields.targetStartField) {
    jqlParts.push(`${fieldJqlClause(schema.globalFields.targetStartField)} >= ${quoteJql(input.targetStartFrom)}`);
  }
  if (input.targetEndTo && schema.globalFields.targetEndField) {
    jqlParts.push(`${fieldJqlClause(schema.globalFields.targetEndField)} <= ${quoteJql(input.targetEndTo)}`);
  }
  if (input.searchText) {
    jqlParts.push(`summary ~ ${quoteJql(input.searchText)}`);
  }

  const response = await createClient().post<SearchJqlResponse>("/rest/api/3/search/jql", {
    jql: (jqlParts.length > 0 ? jqlParts : ["order by updated DESC"]).join(" AND "),
    maxResults: input.maxResults ?? 20,
    nextPageToken: input.nextPageToken,
    fields: portfolioFieldIds(schema),
  });

  return {
    nextPageToken: response.nextPageToken ?? null,
    items: response.issues.map((issue) => normalizeIssue(issue, schema, undefined)),
  };
}

function assertEditableField(editMeta: Record<string, JiraMetaField>, field: DiscoveredFieldRef, issueKey: string): void {
  const metaField = editMeta[field.id];
  if (!metaField || !hasEditOperation(metaField, "set")) {
    throw new Error(`Field "${field.name}" is not editable with set operation on ${issueKey}.`);
  }
}

export async function setPortfolioFields(input: PortfolioFieldInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const schema = await loadSchemaSnapshot();
  const current = await fetchIssue(input.issueKey, schema);
  const editMeta = await loadIssueEditMeta(current.key);
  const fields: Record<string, unknown> = {};

  if (input.parentLinkKey) {
    if (!schema.globalFields.parentLinkField) {
      throw new Error("Parent Link field was not discovered. Run discover_premium_capabilities first.");
    }
    assertEditableField(editMeta, schema.globalFields.parentLinkField, current.key);
    fields[schema.globalFields.parentLinkField.id] = buildFieldValue(schema.globalFields.parentLinkField, input.parentLinkKey);
  }
  if (input.teamIdOrName) {
    if (!schema.globalFields.teamField) {
      throw new Error("Team field was not discovered. Run discover_premium_capabilities first.");
    }
    assertEditableField(editMeta, schema.globalFields.teamField, current.key);
    fields[schema.globalFields.teamField.id] = buildFieldValue(schema.globalFields.teamField, input.teamIdOrName);
  }
  if (input.targetStart) {
    if (!schema.globalFields.targetStartField) {
      throw new Error("Target start field was not discovered. Run discover_premium_capabilities first.");
    }
    assertEditableField(editMeta, schema.globalFields.targetStartField, current.key);
    fields[schema.globalFields.targetStartField.id] = buildFieldValue(schema.globalFields.targetStartField, input.targetStart);
  }
  if (input.targetEnd) {
    if (!schema.globalFields.targetEndField) {
      throw new Error("Target end field was not discovered. Run discover_premium_capabilities first.");
    }
    assertEditableField(editMeta, schema.globalFields.targetEndField, current.key);
    fields[schema.globalFields.targetEndField.id] = buildFieldValue(schema.globalFields.targetEndField, input.targetEnd);
  }
  if (Object.keys(fields).length === 0) {
    throw new Error("Expected at least one portfolio field to set.");
  }

  const preview = buildAuditResult(
    {
      intent: "Set Jira portfolio fields",
      target: current.key,
      warnings: [],
      steps: [
        {
          kind: "rest",
          description: "Update Advanced Roadmaps / Jira Premium fields on an issue.",
          endpoint: `/rest/api/3/issue/${current.key}`,
          input: { fields },
          before: current,
        },
      ],
      rollbackHint: "Use Jira issue history or re-run set_portfolio_fields with previous field values.",
      result: { before: current },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "jira.set_portfolio_fields",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      existingName: String(current.summary ?? ""),
      refs: [current.key, projectKeyFromIssue(current)].filter((value): value is string => Boolean(value)),
    },
    fingerprintInput: { issueKey: current.key, fields },
    preview,
    apply: async () => {
      await createClient().put(`/rest/api/3/issue/${encodeURIComponent(current.key)}`, { fields });
      const after = await fetchIssue(current.key, schema);
      return buildAuditResult(
        {
          intent: preview.intent,
          target: current.key,
          warnings: [],
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result: after,
        },
        mode,
        true,
      );
    },
  });
}

async function resolveIssueLinkTypeName(): Promise<string> {
  const response = await loadIssueLinkTypes();
  return (
    response.issueLinkTypes.find((item: { name: string }) => item.name === "Relates")?.name ??
    response.issueLinkTypes[0]?.name ??
    "Relates"
  );
}

async function loadIssueLinkTypes(): Promise<{ issueLinkTypes: IssueLinkType[] }> {
  return createClient().get<{ issueLinkTypes: IssueLinkType[] }>("/rest/api/3/issueLinkType");
}

async function resolveIssueLinkTypeByName(linkTypeName: string): Promise<IssueLinkType> {
  const response = await loadIssueLinkTypes();
  const normalized = normalizeFieldName(linkTypeName);
  const match = response.issueLinkTypes.find((item) => normalizeFieldName(item.name) === normalized);
  if (!match) {
    throw new Error(
      `Issue link type "${linkTypeName}" is not available. Available types: ${response.issueLinkTypes.map((item) => item.name).join(", ")}.`,
    );
  }
  return match;
}

function hasIssueLinkTo(issue: ReturnType<typeof normalizeIssue>, otherIssueKey: string): boolean {
  const links = Array.isArray(issue.issueLinks) ? issue.issueLinks : [];
  return links.some((link) => {
    if (!link || typeof link !== "object") {
      return false;
    }
    const candidate = link as {
      inwardIssue?: { key?: string };
      outwardIssue?: { key?: string };
    };
    return candidate.inwardIssue?.key === otherIssueKey || candidate.outwardIssue?.key === otherIssueKey;
  });
}

function hasIssueLinkToWithType(
  issue: ReturnType<typeof normalizeIssue>,
  otherIssueKey: string,
  linkTypeName: string,
): boolean {
  const links = Array.isArray(issue.issueLinks) ? issue.issueLinks : [];
  return links.some((link) => {
    if (!link || typeof link !== "object") {
      return false;
    }
    const candidate = link as {
      type?: { name?: string };
      inwardIssue?: { key?: string };
      outwardIssue?: { key?: string };
    };
    return (
      normalizeFieldName(candidate.type?.name ?? "") === normalizeFieldName(linkTypeName) &&
      (candidate.inwardIssue?.key === otherIssueKey || candidate.outwardIssue?.key === otherIssueKey)
    );
  });
}

export async function linkDependency(input: DependencyLinkInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const linkType = await resolveIssueLinkTypeByName(input.linkType ?? "Blocks");
  const blocker = await fetchIssue(input.blocksIssueKey);
  const blocked = await fetchIssue(input.blockedIssueKey);
  const linkAlreadyExists =
    hasIssueLinkToWithType(blocker, blocked.key, linkType.name) ||
    hasIssueLinkToWithType(blocked, blocker.key, linkType.name);
  const payload = {
    type: { name: linkType.name },
    inwardIssue: { key: blocked.key },
    outwardIssue: { key: blocker.key },
  };

  const preview = buildAuditResult(
    {
      intent: "Link Jira dependency",
      target: `${blocker.key} blocks ${blocked.key}`,
      warnings: linkAlreadyExists ? ["The dependency issue link already exists, so link creation will be skipped."] : [],
      steps: linkAlreadyExists
        ? []
        : [
            {
              kind: "rest" as const,
              description: "Create a Jira issue link for a delivery dependency.",
              endpoint: "/rest/api/3/issueLink",
              input: payload,
            },
          ],
      rollbackHint: "Delete the Jira issue link if rollback is needed.",
      result: { blocker, blocked, linkType },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "jira.link_dependency",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      refs: [blocker.key, blocked.key, projectKeyFromIssue(blocker), projectKeyFromIssue(blocked)].filter(
        (value): value is string => Boolean(value),
      ),
    },
    fingerprintInput: payload,
    preview,
    apply: async () => {
      if (!linkAlreadyExists) {
        await createClient().post("/rest/api/3/issueLink", payload);
      }
      const afterBlocker = await fetchIssue(blocker.key);
      const afterBlocked = await fetchIssue(blocked.key);
      return {
        ...buildAuditResult(
          {
            intent: preview.intent,
            target: preview.target,
            warnings: preview.warnings,
            steps: preview.steps,
            rollbackHint: preview.rollbackHint,
            result: {
              blocker: afterBlocker,
              blocked: afterBlocked,
              linkType,
            },
          },
          mode,
          !linkAlreadyExists,
        ),
        deduplicated: linkAlreadyExists,
      };
    },
  });
}

export async function linkIdeaEpic(input: IdeaEpicLinkInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const schema = await loadSchemaSnapshot();
  const idea = await getIdea({ issueKey: input.ideaKey });
  const epic = await getEpic({ issueKey: input.epicKey });
  const linkTypeName = await resolveIssueLinkTypeName();
  const linkAlreadyExists = hasIssueLinkTo(idea, epic.key) || hasIssueLinkTo(epic, idea.key);
  const desiredHelperValue = input.primaryJpdIdeaKey ?? idea.key;
  const currentHelperValue = typeof epic.primaryJpdIdeaKey === "string" ? epic.primaryJpdIdeaKey : undefined;
  const epicHelperUpdate =
    schema.globalFields.primaryJpdIdeaKeyField &&
    desiredHelperValue &&
    currentHelperValue !== desiredHelperValue
      ? {
          fields: {
            [schema.globalFields.primaryJpdIdeaKeyField.id]: desiredHelperValue,
          },
        }
      : undefined;
  const linkStep: AuditStep[] = linkAlreadyExists
    ? []
    : [
        {
          kind: "rest",
          description: "Create an issue link between the JPD idea and the Epic.",
          endpoint: "/rest/api/3/issueLink",
          input: {
            type: { name: linkTypeName },
            inwardIssue: { key: idea.key },
            outwardIssue: { key: epic.key },
          },
        },
      ];

  const preview = buildAuditResult(
    {
      intent: "Link JPD idea to Jira Epic",
      target: `${idea.key} <-> ${epic.key}`,
      warnings: [
        ...(linkAlreadyExists ? ["The Jira issue link already exists, so link creation will be skipped."] : []),
        "Delivery linkage is implemented through Jira issue links plus the optional helper field. If your tenant relies on an additional proprietary JPD linkage, a UI confirmation may still be needed.",
      ],
      steps: [
        ...linkStep,
        ...(epicHelperUpdate
          ? [
              {
                kind: "rest" as const,
                description: "Set the helper field on the Epic for explicit traceability.",
                endpoint: `/rest/api/3/issue/${epic.key}`,
                input: epicHelperUpdate,
              },
            ]
          : []),
      ],
      rollbackHint: "Delete the Jira issue link and clear the helper field if rollback is needed.",
      result: {
        idea,
        epic,
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "jira.link_idea_epic",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      existingName: String(idea.summary ?? ""),
      refs: [idea.key, epic.key, projectKeyFromIssue(idea), projectKeyFromIssue(epic)].filter((value): value is string =>
        Boolean(value),
      ),
    },
    fingerprintInput: { ideaKey: idea.key, epicKey: epic.key, helper: epicHelperUpdate },
    preview,
    apply: async () => {
      let appliedMutation = false;
      if (!linkAlreadyExists) {
        await createClient().post("/rest/api/3/issueLink", {
          type: { name: linkTypeName },
          inwardIssue: { key: idea.key },
          outwardIssue: { key: epic.key },
        });
        appliedMutation = true;
      }
      if (epicHelperUpdate) {
        await createClient().put(`/rest/api/3/issue/${encodeURIComponent(epic.key)}`, epicHelperUpdate);
        appliedMutation = true;
      }
      const after = {
        idea: await getIdea({ issueKey: idea.key }),
        epic: await getEpic({ issueKey: epic.key }),
      };
      return {
        ...buildAuditResult(
          {
            intent: preview.intent,
            target: preview.target,
            warnings: preview.warnings,
            steps: preview.steps,
            rollbackHint: preview.rollbackHint,
            result: after,
          },
          mode,
          appliedMutation,
        ),
        deduplicated: linkAlreadyExists && !appliedMutation,
      };
    },
  });
}
