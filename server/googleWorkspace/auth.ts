import { importPKCS8, SignJWT } from "jose";
import type { JWTPayload } from "jose";
import { GOOGLE_WORKSPACE_SCOPES } from "./config.js";
import type { GoogleWorkspaceConfig } from "./config.js";

const GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWT_BEARER_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const ASSERTION_LIFETIME_SECONDS = 60 * 60;
const TOKEN_RENEWAL_WINDOW_MILLISECONDS = 60 * 1000;

interface GoogleWorkspaceAssertionClaims extends JWTPayload {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string;
  readonly scope: string;
  readonly iat: number;
  readonly exp: number;
}

interface CachedGoogleWorkspaceToken {
  readonly accessToken: string;
  readonly expiresAt: number;
}

interface GoogleTokenResponse {
  readonly access_token: string;
  readonly expires_in: number;
}

type GoogleWorkspaceAssertionSigner = (claims: GoogleWorkspaceAssertionClaims) => Promise<string>;

export type GoogleWorkspaceAuthenticationErrorCode =
  | "assertion_signing_failed"
  | "token_exchange_failed"
  | "invalid_token_response";

export class GoogleWorkspaceAuthenticationError extends Error {
  readonly code: GoogleWorkspaceAuthenticationErrorCode;
  readonly status: number | undefined;

  constructor(code: GoogleWorkspaceAuthenticationErrorCode, status?: number) {
    super(`Google Workspace authentication failed: ${code}`);
    this.name = "GoogleWorkspaceAuthenticationError";
    this.code = code;
    this.status = status;
  }
}

export interface GoogleWorkspaceTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface GoogleWorkspaceTokenProviderDependencies {
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly signAssertion?: GoogleWorkspaceAssertionSigner;
}

function createJoseAssertionSigner(privateKey: string): GoogleWorkspaceAssertionSigner {
  let signingKey: ReturnType<typeof importPKCS8> | undefined;

  return async (claims) => {
    signingKey ??= importPKCS8(privateKey, "RS256");
    return new SignJWT(claims).setProtectedHeader({ alg: "RS256" }).sign(await signingKey);
  };
}

function createAssertionClaims(config: GoogleWorkspaceConfig, now: Date): GoogleWorkspaceAssertionClaims {
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  return {
    iss: config.serviceAccountEmail,
    sub: config.adminEmail,
    aud: GOOGLE_OAUTH_TOKEN_ENDPOINT,
    scope: GOOGLE_WORKSPACE_SCOPES.join(" "),
    iat: nowSeconds,
    exp: nowSeconds + ASSERTION_LIFETIME_SECONDS,
  };
}

function isGoogleTokenResponse(payload: unknown): payload is GoogleTokenResponse {
  if (typeof payload !== "object" || payload === null) return false;

  const candidate = payload as Partial<GoogleTokenResponse>;
  return (
    typeof candidate.access_token === "string" &&
    candidate.access_token.length > 0 &&
    typeof candidate.expires_in === "number"
  );
}

function calculateTokenExpiresAt(now: number, expiresInSeconds: number): number | undefined {
  if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0) return undefined;

  const expiresAt = now + expiresInSeconds * 1_000;
  return Number.isSafeInteger(expiresAt) ? expiresAt : undefined;
}

class CachedGoogleWorkspaceTokenProvider implements GoogleWorkspaceTokenProvider {
  #cache: CachedGoogleWorkspaceToken | undefined;
  #refresh: Promise<string> | undefined;
  #config: GoogleWorkspaceConfig;
  #fetcher: typeof fetch;
  #now: () => Date;
  #signAssertion: GoogleWorkspaceAssertionSigner;

  constructor(
    config: GoogleWorkspaceConfig,
    fetcher: typeof fetch,
    now: () => Date,
    signAssertion: GoogleWorkspaceAssertionSigner,
  ) {
    this.#config = config;
    this.#fetcher = fetcher;
    this.#now = now;
    this.#signAssertion = signAssertion;
  }

  getAccessToken(): Promise<string> {
    const now = this.#now().getTime();
    if (this.#cache && this.#cache.expiresAt - now >= TOKEN_RENEWAL_WINDOW_MILLISECONDS) {
      return Promise.resolve(this.#cache.accessToken);
    }

    if (!this.#refresh) {
      this.#refresh = this.refresh(now).then(
        (accessToken) => {
          this.#refresh = undefined;
          return accessToken;
        },
        (error: unknown) => {
          this.#refresh = undefined;
          throw error;
        },
      );
    }

    return this.#refresh;
  }

  private async refresh(now: number): Promise<string> {
    const claims = createAssertionClaims(this.#config, new Date(now));
    let assertion: string;
    try {
      assertion = await this.#signAssertion(claims);
    } catch {
      throw new GoogleWorkspaceAuthenticationError("assertion_signing_failed");
    }

    let response: Response;
    try {
      response = await this.#fetcher(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT_TYPE, assertion }).toString(),
      });
    } catch {
      throw new GoogleWorkspaceAuthenticationError("token_exchange_failed");
    }

    if (!response.ok) {
      throw new GoogleWorkspaceAuthenticationError("token_exchange_failed", response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new GoogleWorkspaceAuthenticationError("invalid_token_response", response.status);
    }

    if (!isGoogleTokenResponse(payload)) {
      throw new GoogleWorkspaceAuthenticationError("invalid_token_response", response.status);
    }

    const expiresAt = calculateTokenExpiresAt(now, payload.expires_in);
    if (expiresAt === undefined) {
      throw new GoogleWorkspaceAuthenticationError("invalid_token_response", response.status);
    }

    this.#cache = {
      accessToken: payload.access_token,
      expiresAt,
    };
    return payload.access_token;
  }
}

export function createGoogleWorkspaceTokenProvider(
  config: GoogleWorkspaceConfig,
  dependencies: GoogleWorkspaceTokenProviderDependencies = {},
): GoogleWorkspaceTokenProvider {
  return new CachedGoogleWorkspaceTokenProvider(
    config,
    dependencies.fetch ?? globalThis.fetch,
    dependencies.now ?? (() => new Date()),
    dependencies.signAssertion ?? createJoseAssertionSigner(config.privateKey),
  );
}
