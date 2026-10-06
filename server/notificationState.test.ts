import { beforeEach, expect, it, vi } from "vitest";
import { getFirestoreDocument, isFirestoreConfigured, setFirestoreDocument } from "./firestore.js";
import { saveNotificationReadState } from "./notificationState.js";

vi.mock("./firestore.js", () => ({
  getFirestoreDocument: vi.fn(),
  isFirestoreConfigured: vi.fn(),
  setFirestoreDocument: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isFirestoreConfigured).mockReturnValue(true);
});

it("preserves previously read errors when reading new notifications", async () => {
  vi.mocked(getFirestoreDocument).mockResolvedValue({ seenErrorExecutionIds: ["old", "shared"] });
  const state = await saveNotificationReadState("user@example.com", ["new", "shared"]);
  expect(state.seenErrorExecutionIds).toEqual(["new", "shared", "old"]);
  expect(setFirestoreDocument).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
    seenErrorExecutionIds: ["new", "shared", "old"],
  }));
});

it("retains the newest 250 distinct errors", async () => {
  vi.mocked(getFirestoreDocument).mockResolvedValue({ seenErrorExecutionIds: Array.from({ length: 250 }, (_, index) => String(index)) });
  const state = await saveNotificationReadState("user@example.com", ["new"]);
  expect(state.seenErrorExecutionIds).toHaveLength(250);
  expect(state.seenErrorExecutionIds[0]).toBe("new");
  expect(state.seenErrorExecutionIds).not.toContain("249");
});
