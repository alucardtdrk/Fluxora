import { expect, it } from "vitest";
import { removeExpiredWorkspaceEvents } from "./retention.js";

it("removes at most 200 expired detailed events per cycle", async () => {
  const deleted: string[] = [];
  const removed = await removeExpiredWorkspaceEvents({ listExpired: async () => Array.from({ length: 250 }, (_, index) => `event-${index}`), deleteEvent: async (id) => { deleted.push(id); } });
  expect(removed).toBe(200);
  expect(deleted).toHaveLength(200);
});
