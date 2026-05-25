export interface HttpClientOptions {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  retries?: number;
  retryDelayMs?: number;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
  }
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.retries = options.retries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 400;
  }

  async get<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: "GET" });
  }

  async post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    const requestInit: RequestInit = {
      ...init,
      method: "POST",
    };
    if (body !== undefined) {
      requestInit.body = JSON.stringify(body);
    }
    return this.request<T>(path, requestInit);
  }

  async put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    const requestInit: RequestInit = {
      ...init,
      method: "PUT",
    };
    if (body !== undefined) {
      requestInit.body = JSON.stringify(body);
    }
    return this.request<T>(path, requestInit);
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...this.defaultHeaders,
      ...(init?.headers ?? {}),
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await fetch(url, { ...init, headers });
        const contentType = response.headers.get("content-type") ?? "";
        const rawText = response.status === 204 ? "" : await response.text();
        const payload = rawText.length === 0
          ? undefined
          : contentType.includes("application/json")
            ? JSON.parse(rawText)
            : rawText;

        if (!response.ok) {
          throw new HttpError(
            `HTTP ${response.status} for ${new URL(url).pathname}`,
            response.status,
            payload,
          );
        }

        return payload as T;
      } catch (error) {
        lastError = error;
        if (
          attempt < this.retries &&
          error instanceof HttpError &&
          (error.status === 429 || error.status >= 500)
        ) {
          await delay(this.retryDelayMs * (attempt + 1));
          continue;
        }
        throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Request failed");
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
