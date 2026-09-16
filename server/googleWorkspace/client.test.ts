import { describe, expect, it, vi } from "vitest";
import { createGoogleWorkspaceClient } from "./client.js";
import type { GoogleWorkspaceTokenProvider } from "./auth.js";

function tokenProvider(token = "test-access-token"): GoogleWorkspaceTokenProvider {
  return { getAccessToken: vi.fn(async () => token) };
}

async function collectPages<T>(pages: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const page of pages) collected.push(page);
  return collected;
}

describe("Google Workspace GET-only client", () => {
  it("sends an authorized GET request", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const provider = tokenProvider();
    const client = createGoogleWorkspaceClient(provider, { fetch: fetcher });

    await expect(client.getJson<{ items: unknown[] }>(new URL("https://admin.googleapis.com/admin/directory/v1/users"))).resolves.toEqual({
      items: [],
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://admin.googleapis.com/admin/directory/v1/users",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: "Bearer test-access-token" }),
      }),
    );
  });

  it("converts token-provider failures into a safe typed error", async () => {
    const credentialSecret = "private-credential-must-not-leak";
    const provider: GoogleWorkspaceTokenProvider = {
      getAccessToken: async () => {
        throw new Error(credentialSecret);
      },
    };
    const fetcher = vi.fn<typeof fetch>();
    const client = createGoogleWorkspaceClient(provider, { fetch: fetcher });

    await client.getJson(new URL("https://admin.googleapis.com/admin/directory/v1/users")).then(
      () => {
        throw new Error("Expected token acquisition to fail");
      },
      (error: unknown) => {
        const serializedError = [String(error), JSON.stringify(error), ...Object.values(error as object)].join(" ");
        expect(error).toMatchObject({ code: "request_failed", status: undefined });
        expect(serializedError).not.toContain(credentialSecret);
      },
    );

    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    "http://admin.googleapis.com/admin/directory/v1/users",
    "https://example.com/admin/directory/v1/users",
    "https://person:password@admin.googleapis.com/admin/directory/v1/users",
    "https://admin.googleapis.com:444/admin/directory/v1/users",
    "https://admin.googleapis.com/admin/directory/v1/users#fragment",
  ])("rejects unsafe URL %s before acquiring a token", async (unsafeUrl) => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = tokenProvider();
    const client = createGoogleWorkspaceClient(provider, { fetch: fetcher });

    await expect(client.getJson(new URL(unsafeUrl))).rejects.toThrow("invalid_url");

    expect(provider.getAccessToken).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("paginates with a cloned URL without repeating or mutating the caller URL", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: ["first"], nextPageToken: "second-page" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: ["second"], nextPageToken: "" }), { status: 200 }));
    const client = createGoogleWorkspaceClient(tokenProvider(), { fetch: fetcher });
    const originalUrl = new URL("https://alertcenter.googleapis.com/v1beta1/alerts?customerId=C01234567&maxResults=10");

    await expect(collectPages(client.paginate<{ items: string[]; nextPageToken?: string }>(originalUrl))).resolves.toEqual([
      { items: ["first"], nextPageToken: "second-page" },
      { items: ["second"], nextPageToken: "" },
    ]);

    expect(originalUrl.toString()).toBe("https://alertcenter.googleapis.com/v1beta1/alerts?customerId=C01234567&maxResults=10");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://alertcenter.googleapis.com/v1beta1/alerts?customerId=C01234567&maxResults=10",
      "https://alertcenter.googleapis.com/v1beta1/alerts?customerId=C01234567&maxResults=10&pageToken=second-page",
    ]);
  });

  it("uses the configured page-token query key", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ nextPageToken: "continuation" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    const client = createGoogleWorkspaceClient(tokenProvider(), { fetch: fetcher });

    await collectPages(client.paginate(new URL("https://admin.googleapis.com/admin/reports/v1/activity/users/all/apps/login"), {
      pageTokenQueryKey: "cursor",
    }));

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://admin.googleapis.com/admin/reports/v1/activity/users/all/apps/login",
      "https://admin.googleapis.com/admin/reports/v1/activity/users/all/apps/login?cursor=continuation",
    ]);
  });

  it("stops a repeated next-page token before it can request the same page again", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: ["first"], nextPageToken: "repeat" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: ["second"], nextPageToken: "repeat" }), { status: 200 }));
    const client = createGoogleWorkspaceClient(tokenProvider(), { fetch: fetcher });
    const iterator = client.paginate<{ items: string[]; nextPageToken: string }>(
      new URL("https://alertcenter.googleapis.com/v1beta1/alerts"),
    )[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ value: { items: ["first"], nextPageToken: "repeat" }, done: false });
    await expect(iterator.next()).resolves.toMatchObject({ value: { items: ["second"], nextPageToken: "repeat" }, done: false });
    await expect(iterator.next()).rejects.toMatchObject({ code: "pagination_cycle", status: undefined });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([429, 500, 502, 503, 504])("retries retryable HTTP status %i with exponential backoff", async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "temporary" }), { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: ["retried"] }), { status: 200 }));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const client = createGoogleWorkspaceClient(tokenProvider(), { fetch: fetcher, sleep });

    await expect(client.getJson<{ items: string[] }>(new URL("https://admin.googleapis.com/admin/directory/v1/users"))).resolves.toEqual({
      items: ["retried"],
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("makes no more than three total attempts for a retryable upstream response", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "temporary" }), { status: 503 }));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const client = createGoogleWorkspaceClient(tokenProvider(), { fetch: fetcher, sleep });

    await expect(client.getJson(new URL("https://admin.googleapis.com/admin/directory/v1/users"))).rejects.toMatchObject({
      code: "upstream_error",
      status: 503,
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1_000], [2_000]]);
  });

  it("honors an integer-seconds Retry-After response header", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "7" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const client = createGoogleWorkspaceClient(tokenProvider(), { fetch: fetcher, sleep });

    await client.getJson(new URL("https://admin.googleapis.com/admin/directory/v1/users"));

    expect(sleep).toHaveBeenCalledWith(7_000);
  });

  it("caps an excessive Retry-After delay", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "3600" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const client = createGoogleWorkspaceClient(tokenProvider(), { fetch: fetcher, sleep });

    await client.getJson(new URL("https://admin.googleapis.com/admin/directory/v1/users"));

    expect(sleep).toHaveBeenCalledWith(8_000);
  });

  it("honors an HTTP-date Retry-After response header using the injected clock", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503, headers: { "retry-after": "Wed, 16 Sep 2026 12:00:04 GMT" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const client = createGoogleWorkspaceClient(tokenProvider(), {
      fetch: fetcher,
      sleep,
      now: () => new Date("2026-09-16T12:00:00.000Z"),
    });

    await client.getJson(new URL("https://admin.googleapis.com/admin/directory/v1/users"));

    expect(sleep).toHaveBeenCalledWith(4_000);
  });

  it("converts retry-delay failures into a safe typed error", async () => {
    const retryDelaySecret = "sleep-failure-must-not-leak";
    const client = createGoogleWorkspaceClient(tokenProvider(), {
      fetch: async () => new Response(JSON.stringify({ error: "temporary" }), { status: 429 }),
      sleep: async () => {
        throw new Error(retryDelaySecret);
      },
    });

    await client.getJson(new URL("https://admin.googleapis.com/admin/directory/v1/users")).then(
      () => {
        throw new Error("Expected retry delay to fail");
      },
      (error: unknown) => {
        expect(error).toMatchObject({ code: "request_failed", status: undefined });
        expect([String(error), JSON.stringify(error), ...Object.values(error as object)].join(" ")).not.toContain(
          retryDelaySecret,
        );
      },
    );
  });

  it.each([400, 401, 403])("does not retry non-retryable HTTP status %i", async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "not retryable" }), { status }));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const client = createGoogleWorkspaceClient(tokenProvider(), { fetch: fetcher, sleep });

    await expect(client.getJson(new URL("https://admin.googleapis.com/admin/directory/v1/users"))).rejects.toMatchObject({
      code: "upstream_error",
      status,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry malformed JSON", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("{invalid", { status: 200 }));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const client = createGoogleWorkspaceClient(tokenProvider(), { fetch: fetcher, sleep });

    await expect(client.getJson(new URL("https://admin.googleapis.com/admin/directory/v1/users"))).rejects.toMatchObject({
      code: "invalid_response",
      status: 200,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([null, { nextPageToken: 42 }])("does not retry an invalid pagination payload %#", async (invalidPage) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(invalidPage), { status: 200 }));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const client = createGoogleWorkspaceClient(tokenProvider(), { fetch: fetcher, sleep });
    const iterator = client.paginate<unknown>(new URL("https://alertcenter.googleapis.com/v1beta1/alerts"))[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ value: invalidPage, done: false });
    await expect(iterator.next()).rejects.toMatchObject({ code: "invalid_response", status: 200 });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry an aborted request", async () => {
    const abortError = new Error("request aborted");
    abortError.name = "AbortError";
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw abortError;
    });
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const client = createGoogleWorkspaceClient(tokenProvider(), { fetch: fetcher, sleep });

    await expect(client.getJson(new URL("https://admin.googleapis.com/admin/directory/v1/users"))).rejects.toMatchObject({
      code: "request_failed",
      status: undefined,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("redacts the bearer token, query values, and upstream body from errors", async () => {
    const bearerToken = "bearer-token-must-not-leak";
    const queryValue = "customer-secret-must-not-leak";
    const upstreamBody = JSON.stringify({ bodySecret: "upstream-body-must-not-leak", bearerToken, queryValue });
    const client = createGoogleWorkspaceClient(tokenProvider(bearerToken), {
      fetch: async () => new Response(upstreamBody, { status: 403 }),
    });

    await client.getJson(new URL(`https://admin.googleapis.com/admin/directory/v1/users?customer=${queryValue}`)).then(
      () => {
        throw new Error("Expected Google request to fail");
      },
      (error: unknown) => {
        const safeError = error as Error;
        const serializedError = [safeError.message, JSON.stringify(safeError), ...Object.values(safeError)].join(" ");

        expect(safeError).toMatchObject({ code: "upstream_error", status: 403 });
        for (const sensitiveValue of [bearerToken, queryValue, upstreamBody, "upstream-body-must-not-leak"]) {
          expect(serializedError).not.toContain(sensitiveValue);
        }
      },
    );
  });
});
