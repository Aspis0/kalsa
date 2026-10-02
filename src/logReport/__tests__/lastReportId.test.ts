/**
 * The session holder: a fresh session has no id, and one remembered id is
 * served back — the state a remounted panel relies on. One file, one module
 * instance, so the flow runs as a single test.
 */
import { lastReportId, rememberReportId } from "../lastReportId";

describe("the last report id holder", () => {
  it("starts empty, remembers a successful send's id, and serves it back", () => {
    expect(lastReportId()).toBeNull();

    rememberReportId("ABCD2345");
    expect(lastReportId()).toBe("ABCD2345");
  });
});
