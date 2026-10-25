import { sessionDiskDeficitBytes } from "./sessionDiskMath";

test("equality is still a refusal, so it is a one-byte deficit", () => {
  const required = 100;
  const free = 90;
  const evictable = required - free;

  expect(sessionDiskDeficitBytes(required, free)).toBe(evictable + 1);
  expect(sessionDiskDeficitBytes(required, required)).toBe(1);
});
