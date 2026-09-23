import type { GoogleWorkspaceTokenProvider } from "./auth.js";

const ALLOWED_GOOGLE_WORKSPACE_HOSTS = new Set(["alertcenter.googleapis.com", "admin.googleapis.com"]);
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_REQUEST_ATTEMPTS = 3;
const INITIAL_BACKOFF_MILLISECONDS = 1_000;
const MAX_BACKOFF_MILLISECONDS = 8_000;
const REQUEST_TIMEOUT_MILLISECONDS = 15_000;

export type GoogleWorkspaceClientErrorCode = "invalid_url" | "request_failed" | "upstream_error" | "invalid_response" | "pagination_cycle";

export class GoogleWorkspaceClientError extends Error {
  readonly code: GoogleWorkspaceClientErrorCode;
  readonly status: number | undefined;

  constructor(code: GoogleWorkspaceClientErrorCode, status?: number) {
    super(`Google Workspace request failed: ${code}`);
    this.name = "GoogleWorkspaceClientError";
    this.code = code;
    this.status = status;
  }
}

export interface GoogleWorkspaceClient {
  getJson<T>(url: URL): Promise<T>;
  paginate<T>(url: URL, options?: GoogleWorkspacePaginationOptions): AsyncIterable<T>;
}

export interface GoogleWorkspaceClientDependencies {
  readonly fetch?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => Date;
  readonly requestTimeoutMilliseconds?: number;
}

export interface GoogleWorkspacePaginationOptions {
  readonly pageTokenQueryKey?: string;
  readonly startPageToken?: string;
  readonly maxPages?: number;
  readonly onPage?: (page: { readonly pageNumber: number; readonly nextPageToken?: string }) => void;
}

class ReadOnlyGoogleWorkspaceClient implements GoogleWorkspaceClient {
  #tokenProvider: GoogleWorkspaceTokenProvider;
  #fetcher: typeof fetch;
  #sleep: (milliseconds: number) => Promise<void>;
  #now: () => Date;
  #requestTimeoutMilliseconds: number;

  constructor(
    tokenProvider: GoogleWorkspaceTokenProvider,
    fetcher: typeof fetch,
    sleep: (milliseconds: number) => Promise<void>,
    now: () => Date,
    requestTimeoutMilliseconds: number,
  ) {
    this.#tokenProvider = tokenProvider;
    this.#fetcher = fetcher;
    this.#sleep = sleep;
    this.#now = now;
    this.#requestTimeoutMilliseconds = requestTimeoutMilliseconds;
  }

  async getJson<T>(url: URL): Promise<T> {
    return (await this.requestJson<T>(url)).payload;
  }

  private async requestJson<T>(url: URL): Promise<{ readonly payload: T; readonly status: number }> {
    validateGoogleWorkspaceUrl(url);
    let accessToken: string;
    try {
      accessToken = await this.#tokenProvider.getAccessToken();
    } catch {
      throw new GoogleWorkspaceClientError("request_failed");
    }

    for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetcher(url.toString(), {
          method: "GET",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "user-agent": "Fluxora Google Workspace Security Client",
          },
          signal: AbortSignal.timeout(this.#requestTimeoutMilliseconds),
        });
      } catch {
        throw new GoogleWorkspaceClientError("request_failed");
      }

      if (response.ok) {
        try {
          return { payload: (await response.json()) as T, status: response.status };
        } catch {
          throw new GoogleWorkspaceClientError("invalid_response", response.status);
        }
      }

      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_REQUEST_ATTEMPTS - 1) {
        try {
          await this.#sleep(getRetryDelayMilliseconds(response, attempt, this.#now()));
        } catch {
          throw new GoogleWorkspaceClientError("request_failed");
        }
        continue;
      }

      throw new GoogleWorkspaceClientError("upstream_error", response.status);
    }

    throw new GoogleWorkspaceClientError("request_failed");
  }

  async *paginate<T>(url: URL, options: GoogleWorkspacePaginationOptions = {}): AsyncIterable<T> {
    const pageUrl = new URL(url.toString());
    const pageTokenQueryKey = options.pageTokenQueryKey ?? "pageToken";
    const seenPageTokens = new Set<string>();
    const maxPages = Math.max(1, options.maxPages ?? Number.MAX_SAFE_INTEGER);
    let pageNumber = 0;
    if (options.startPageToken) pageUrl.searchParams.set(pageTokenQueryKey, options.startPageToken);

    while (pageNumber < maxPages) {
      const { payload: page, status } = await this.requestJson<T>(pageUrl);
      pageNumber += 1;
      yield page;

      const nextPageToken = getNextPageToken(page, status);
      options.onPage?.({ pageNumber, nextPageToken });
      if (nextPageToken === undefined) return;
      if (pageNumber >= maxPages) return;

      if (seenPageTokens.has(nextPageToken)) {
        throw new GoogleWorkspaceClientError("pagination_cycle");
      }
      seenPageTokens.add(nextPageToken);
      pageUrl.searchParams.set(pageTokenQueryKey, nextPageToken);
    }
  }
}

function validateGoogleWorkspaceUrl(url: URL): void {
  if (
    url.protocol !== "https:" ||
    !ALLOWED_GOOGLE_WORKSPACE_HOSTS.has(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.hash !== ""
  ) {
    throw new GoogleWorkspaceClientError("invalid_url");
  }
}

function getRetryDelayMilliseconds(response: Response, attempt: number, now: Date): number {
  const retryAfter = parseRetryAfterMilliseconds(response.headers.get("retry-after"), now);
  if (retryAfter !== undefined) return Math.min(retryAfter, MAX_BACKOFF_MILLISECONDS);

  return Math.min(INITIAL_BACKOFF_MILLISECONDS * 2 ** attempt, MAX_BACKOFF_MILLISECONDS);
}

function getNextPageToken(page: unknown, status: number): string | undefined {
  if (typeof page !== "object" || page === null || Array.isArray(page)) {
    throw new GoogleWorkspaceClientError("invalid_response", status);
  }

  const nextPageToken = (page as { nextPageToken?: unknown }).nextPageToken;
  if (nextPageToken === undefined || nextPageToken === null || nextPageToken === "") return undefined;
  if (typeof nextPageToken !== "string") throw new GoogleWorkspaceClientError("invalid_response", status);
  return nextPageToken;
}

function parseRetryAfterMilliseconds(retryAfter: string | null, now: Date): number | undefined {
  if (retryAfter === null) return undefined;

  if (/^\d+$/.test(retryAfter)) {
    const seconds = Number(retryAfter);
    if (Number.isSafeInteger(seconds) && seconds <= Math.floor(Number.MAX_SAFE_INTEGER / 1_000)) {
      return seconds * 1_000;
    }
    return undefined;
  }

  const retryAt = Date.parse(retryAfter);
  if (Number.isNaN(retryAt)) return undefined;
  return Math.max(0, retryAt - now.getTime());
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createGoogleWorkspaceClient(
  tokenProvider: GoogleWorkspaceTokenProvider,
  dependencies: GoogleWorkspaceClientDependencies = {},
): GoogleWorkspaceClient {
  return new ReadOnlyGoogleWorkspaceClient(
    tokenProvider,
    dependencies.fetch ?? globalThis.fetch,
    dependencies.sleep ?? defaultSleep,
    dependencies.now ?? (() => new Date()),
    dependencies.requestTimeoutMilliseconds ?? REQUEST_TIMEOUT_MILLISECONDS,
  );
}
