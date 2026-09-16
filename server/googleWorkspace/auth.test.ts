import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeJwt, decodeProtectedHeader, exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import {
  GoogleWorkspaceAuthenticationError,
  createGoogleWorkspaceTokenProvider,
} from "./auth.js";
import { GOOGLE_WORKSPACE_SCOPES } from "./config.js";
import type { GoogleWorkspaceConfig } from "./config.js";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const TEST_PRIVATE_KEY = "test-private-key";

function createConfig(privateKey = TEST_PRIVATE_KEY): GoogleWorkspaceConfig {
  return Object.freeze({
    serviceAccountEmail: "workspace-audit@example.iam.gserviceaccount.com",
    privateKey,
    adminEmail: "security-admin@example.com",
    customerId: "C01234567",
    domain: "example.com",
    scopes: GOOGLE_WORKSPACE_SCOPES,
  });
}

function tokenResponse(accessToken: string, expiresIn = 3_600): Response {
  return new Response(JSON.stringify({ access_token: accessToken, expires_in: expiresIn, token_type: "Bearer" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Google Workspace delegated token provider", () => {
  it("signs an RS256 assertion with the exact delegated subject, approved scopes, and time claims", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
    const pem = await exportPKCS8(privateKey);
    const fetcher = vi.fn<typeof fetch>(async () => tokenResponse("access-token"));

    const provider = createGoogleWorkspaceTokenProvider(createConfig(pem), {
      fetch: fetcher,
      now: () => new Date("2026-09-16T12:34:56.789Z"),
    });

    await provider.getAccessToken();

    const body = new URLSearchParams(String(fetcher.mock.calls[0]?.[1]?.body));
    const assertion = body.get("assertion");
    expect(assertion).not.toBeNull();
    expect(decodeProtectedHeader(assertion!)).toEqual({ alg: "RS256" });
    const expectedPayload = {
      iss: "workspace-audit@example.iam.gserviceaccount.com",
      sub: "security-admin@example.com",
      aud: TOKEN_ENDPOINT,
      scope:
        "https://www.googleapis.com/auth/apps.alerts https://www.googleapis.com/auth/admin.reports.audit.readonly https://www.googleapis.com/auth/admin.directory.user.readonly https://www.googleapis.com/auth/admin.directory.group.readonly https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly",
      iat: 1_789_562_096,
      exp: 1_789_565_696,
    };
    expect(decodeJwt(assertion!)).toEqual(expectedPayload);

    const verified = await jwtVerify(assertion!, publicKey, {
      algorithms: ["RS256"],
      issuer: expectedPayload.iss,
      subject: expectedPayload.sub,
      audience: expectedPayload.aud,
      currentDate: new Date("2026-09-16T12:34:56.789Z"),
    });
    expect(verified.protectedHeader).toEqual({ alg: "RS256" });
    expect(verified.payload).toEqual(expectedPayload);
  });

  it("exchanges a signed assertion only at the Google token endpoint using the JWT bearer form", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => tokenResponse("access-token"));
    const signer = vi.fn(async () => "signed-assertion");
    const provider = createGoogleWorkspaceTokenProvider(createConfig(), {
      fetch: fetcher,
      now: () => new Date("2026-09-16T12:34:56.000Z"),
      signAssertion: signer,
    });

    await expect(provider.getAccessToken()).resolves.toBe("access-token");

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(TOKEN_ENDPOINT);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(Array.from(new URLSearchParams(String(fetcher.mock.calls[0]?.[1]?.body)).entries())).toEqual([
      ["grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"],
      ["assertion", "signed-assertion"],
    ]);
  });

  it("reuses a cached token through the sixty-second boundary and renews it once fewer than sixty seconds remain", async () => {
    let now = new Date("2026-09-16T12:34:56.000Z").getTime();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("first-token", 120))
      .mockResolvedValueOnce(tokenResponse("second-token", 120));
    const signer = vi.fn(async () => "signed-assertion");
    const provider = createGoogleWorkspaceTokenProvider(createConfig(), {
      fetch: fetcher,
      now: () => new Date(now),
      signAssertion: signer,
    });

    await expect(provider.getAccessToken()).resolves.toBe("first-token");
    now += 60_000;
    await expect(provider.getAccessToken()).resolves.toBe("first-token");
    now += 1;
    await expect(provider.getAccessToken()).resolves.toBe("second-token");

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(signer).toHaveBeenCalledTimes(2);
  });

  it("deduplicates simultaneous cache refreshes into one assertion and token exchange", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetcher = vi.fn(async () => pendingResponse);
    const signer = vi.fn(async () => "signed-assertion");
    const provider = createGoogleWorkspaceTokenProvider(createConfig(), {
      fetch: fetcher,
      now: () => new Date("2026-09-16T12:34:56.000Z"),
      signAssertion: signer,
    });

    const first = provider.getAccessToken();
    const second = provider.getAccessToken();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    resolveResponse!(tokenResponse("shared-token"));

    await expect(Promise.all([first, second])).resolves.toEqual(["shared-token", "shared-token"]);
    expect(signer).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed success payloads with a safe typed error", async () => {
    const provider = createGoogleWorkspaceTokenProvider(createConfig(), {
      fetch: async () => new Response(JSON.stringify({ expires_in: 3_600 }), { status: 200 }),
      signAssertion: async () => "signed-assertion",
    });

    await expect(provider.getAccessToken()).rejects.toMatchObject({
      name: "GoogleWorkspaceAuthenticationError",
      code: "invalid_token_response",
      status: 200,
    });
  });

  it("rejects a finite but unsafe token TTL that would overflow the cached expiration", async () => {
    const provider = createGoogleWorkspaceTokenProvider(createConfig(), {
      fetch: async () => tokenResponse("access-token", Number.MAX_VALUE),
      now: () => new Date("2026-09-16T12:34:56.000Z"),
      signAssertion: async () => "signed-assertion",
    });

    await expect(provider.getAccessToken()).rejects.toMatchObject({
      name: "GoogleWorkspaceAuthenticationError",
      code: "invalid_token_response",
      status: 200,
    });
  });

  it("rejects a non-integer token TTL", async () => {
    const provider = createGoogleWorkspaceTokenProvider(createConfig(), {
      fetch: async () => tokenResponse("access-token", 1.5),
      signAssertion: async () => "signed-assertion",
    });

    await expect(provider.getAccessToken()).rejects.toMatchObject({
      name: "GoogleWorkspaceAuthenticationError",
      code: "invalid_token_response",
      status: 200,
    });
  });

  it("rejects a safe token TTL whose calculated cache expiration is not safe", async () => {
    const provider = createGoogleWorkspaceTokenProvider(createConfig(), {
      fetch: async () => tokenResponse("access-token", Number.MAX_SAFE_INTEGER),
      signAssertion: async () => "signed-assertion",
    });

    await expect(provider.getAccessToken()).rejects.toMatchObject({
      name: "GoogleWorkspaceAuthenticationError",
      code: "invalid_token_response",
      status: 200,
    });
  });

  it("returns a safe typed error for non-success exchanges without retaining upstream secrets", async () => {
    const config = createConfig();
    const assertion = "signed-assertion";
    const rejectedAccessToken = "rejected-access-token";
    const upstreamSecret = JSON.stringify({
      assertion,
      accessToken: rejectedAccessToken,
      serviceAccountEmail: config.serviceAccountEmail,
      privateKey: config.privateKey,
      adminEmail: config.adminEmail,
      customerId: config.customerId,
      domain: config.domain,
      scopes: config.scopes,
    });
    const provider = createGoogleWorkspaceTokenProvider(config, {
      fetch: async () => new Response(upstreamSecret, { status: 401 }),
      signAssertion: async () => assertion,
    });

    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(GoogleWorkspaceAuthenticationError);
    await provider.getAccessToken().catch((error: unknown) => {
      const safeError = error as GoogleWorkspaceAuthenticationError;
      expect(safeError.code).toBe("token_exchange_failed");
      expect(safeError.status).toBe(401);
      expect(safeError.message).not.toContain(upstreamSecret);
      expect(JSON.stringify(safeError)).not.toContain(upstreamSecret);
      expect(Object.values(safeError)).not.toContain(upstreamSecret);
      const serializedError = [safeError.message, JSON.stringify(safeError), ...Object.values(safeError)].join(" ");
      for (const sensitiveValue of [
        assertion,
        rejectedAccessToken,
        config.serviceAccountEmail,
        config.privateKey,
        config.adminEmail,
        config.customerId,
        config.domain,
        ...config.scopes,
      ]) {
        expect(serializedError).not.toContain(sensitiveValue);
      }
    });
  });

  it("does not expose configuration, signing material, or cache state on the provider object", () => {
    const provider = createGoogleWorkspaceTokenProvider(createConfig(), {
      fetch: async () => tokenResponse("access-token"),
      signAssertion: async () => "signed-assertion",
    });

    expect(Object.keys(provider)).toEqual([]);
    expect(JSON.stringify(provider)).not.toContain(TEST_PRIVATE_KEY);
  });
});
