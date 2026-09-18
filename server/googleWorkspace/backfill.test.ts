import { describe, expect, it } from "vitest";
import { planWorkspaceBackfillWindow } from "./backfill.js";

describe("Workspace backfill planner", () => {
  it("advances coverage by one bounded day", () => {
    expect(planWorkspaceBackfillWindow({
      targetStart: new Date("2026-06-20T00:00:00.000Z"),
      targetEnd: new Date("2026-09-18T00:00:00.000Z"),
      coveredThrough: new Date("2026-06-20T00:00:00.000Z"),
    })).toEqual({
      start: new Date("2026-06-20T00:00:00.000Z"),
      end: new Date("2026-06-21T00:00:00.000Z"),
      complete: false,
    });
  });

  it("clamps the final window and marks completed coverage", () => {
    expect(planWorkspaceBackfillWindow({
      targetStart: new Date("2026-06-20T00:00:00.000Z"),
      targetEnd: new Date("2026-06-20T12:00:00.000Z"),
      coveredThrough: new Date("2026-06-20T00:00:00.000Z"),
    })).toEqual({
      start: new Date("2026-06-20T00:00:00.000Z"),
      end: new Date("2026-06-20T12:00:00.000Z"),
      complete: true,
    });
  });
});
