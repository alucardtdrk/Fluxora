import { describe, expect, it } from "vitest";
import { getFluxoraCollectionPaths, isAllowedFluxoraLegacyCollection } from "./fluxoraFirestorePaths.js";
import { getFirestoreCollectionQueryPath, normalizeFirestorePath } from "./firestore.js";
import { migrateFluxoraCollection } from "./fluxoraFirestoreMigration.js";

describe("Fluxora Firestore collection registry", () => {
  it("maps approved Workspace records to a valid collection below the Fluxora root", () => {
    expect(getFluxoraCollectionPaths("workspaceSecurityEvents")).toEqual({
      legacy: "fluxora_workspace_security_events",
      destination: "fluxora/data/workspace-security-events",
    });
  });

  it("rejects collections outside the explicit Fluxora allowlist", () => {
    expect(isAllowedFluxoraLegacyCollection("customers")).toBe(false);
  });

  it("keeps valid nested Firestore paths and rejects malformed ones", () => {
    expect(normalizeFirestorePath("fluxora/data/workspace-security-events")).toBe("fluxora/data/workspace-security-events");
    expect(() => normalizeFirestorePath("fluxora//data")).toThrow("invalid Firestore path");
  });

  it("queries a nested Fluxora collection from its parent document", () => {
    expect(getFirestoreCollectionQueryPath("fluxora/data/workspace-security-events")).toEqual({
      endpoint: "/fluxora/data:runQuery",
      collectionId: "workspace-security-events",
    });
  });

  it("copies approved documents by the same ID without deletion", async () => {
    const documents = new Map<string, Record<string, unknown>>([
      ["fluxora_users/alice", { role: "admin" }],
      ["fluxora_users/bob", { role: "viewer" }],
    ]);
    const operations: string[] = [];
    const result = await migrateFluxoraCollection("users", {
      list: async (path) => [...documents.entries()]
        .filter(([key]) => key.startsWith(`${path}/`))
        .map(([key, data]) => ({ id: key.slice(path.length + 1), data })),
      upsert: async (path, id, data) => { operations.push("upsert"); documents.set(`${path}/${id}`, data); },
    });

    expect(result).toMatchObject({ key: "users", copied: 2, status: "complete" });
    expect(documents.get("fluxora/data/users/alice")).toEqual({ role: "admin" });
    expect(operations).toEqual(["upsert", "upsert"]);
  });
});
