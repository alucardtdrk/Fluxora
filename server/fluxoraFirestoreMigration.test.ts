import { describe, expect, it } from "vitest";
import { getFluxoraCollectionPaths, isAllowedFluxoraLegacyCollection } from "./fluxoraFirestorePaths.js";

describe("Fluxora Firestore collection registry", () => {
  it("maps approved Workspace records below the Fluxora root", () => {
    expect(getFluxoraCollectionPaths("workspaceSecurityEvents")).toEqual({
      legacy: "fluxora_workspace_security_events",
      destination: "fluxora/data/workspace/security-events",
    });
  });

  it("rejects collections outside the explicit Fluxora allowlist", () => {
    expect(isAllowedFluxoraLegacyCollection("customers")).toBe(false);
  });
});
