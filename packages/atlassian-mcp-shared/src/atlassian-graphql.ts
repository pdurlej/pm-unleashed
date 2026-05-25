import { HttpClient } from "./http.js";

export interface GraphqlClientOptions {
  siteUrl: string;
  authHeader: string;
}

export class AtlassianGraphqlClient {
  readonly http: HttpClient;

  constructor(options: GraphqlClientOptions) {
    this.http = new HttpClient({
      baseUrl: `${options.siteUrl.replace(/\/$/, "")}/gateway/api/graphql`,
      defaultHeaders: {
        Authorization: options.authHeader,
      },
    });
  }

  async execute<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const payload = await this.http.post<{
      data?: T;
      errors?: Array<{ message?: string }>;
    }>("", { query, variables });

    if (payload.errors && payload.errors.length > 0) {
      throw new Error(payload.errors.map((error) => error.message ?? "Unknown GraphQL error").join("; "));
    }

    if (!payload.data) {
      throw new Error("GraphQL response did not include a data payload.");
    }

    return payload.data;
  }
}

export function buildBasicAuthHeader(username: string, token: string): string {
  return `Basic ${Buffer.from(`${username}:${token}`, "utf8").toString("base64")}`;
}
