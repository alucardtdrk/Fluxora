import { expect, it } from "vitest";
import { isInternalRequestAuthorized } from "./internalAuth.js";

it("accepts an exact bearer cron secret and rejects malformed credentials", () => {
  expect(isInternalRequestAuthorized({ authorization: "Bearer test-secret" }, { CRON_SECRET: "test-secret" })).toBe(true);
  expect(isInternalRequestAuthorized({ authorization: "Bearer wrong" }, { CRON_SECRET: "test-secret" })).toBe(false);
  expect(isInternalRequestAuthorized({}, { CRON_SECRET: "test-secret" })).toBe(false);
});
