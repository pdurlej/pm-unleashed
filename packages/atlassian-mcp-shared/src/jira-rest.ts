import { HttpClient } from "./http.js";

export interface JiraRestClientOptions {
  baseUrl: string;
  authHeader: string;
}

export class JiraRestClient {
  readonly http: HttpClient;

  constructor(options: JiraRestClientOptions) {
    this.http = new HttpClient({
      baseUrl: options.baseUrl,
      defaultHeaders: {
        Authorization: options.authHeader,
      },
    });
  }

  async get<T>(path: string): Promise<T> {
    return this.http.get<T>(path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.http.post<T>(path, body);
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.http.put<T>(path, body);
  }
}
