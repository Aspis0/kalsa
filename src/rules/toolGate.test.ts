import { evaluateTurn } from "./evaluate";
import { TOOL_GATE_TABLE } from "./toolGate";

function blocksSearch(query: string): boolean {
  return evaluateTurn(
    { toolName: "web_search", input: { query, lastUserMessage: "", memoryFacts: [] } },
    TOOL_GATE_TABLE,
  ).blocked;
}

describe("TOOL_GATE_TABLE sensitive-pattern rule", () => {
  test.each([
    "1 234 567 890 price",
    "ISBN 978-0-306-40615-7",
    "ISBN 978-3-16-148410-0",
    "AB123456789 product details",
    "AB123456789",
    "AB-123456789",
    "SKU1234567890",
    "product code AB1234",
    "product code 123456",
    "SKU 1234567890",
    "iPhone model A123456789",
    "postal code 94105 restaurants",
    "ZIP code 10001",
    "ticket 123456789 tracking",
    "track order 123456789",
    "order number 123456789",
    "tracking 123456789",
    "error code 1234",
  ])("passes an ordinary search: %s", (query) => {
    expect(blocksSearch(query)).toBe(false);
  });

  test.each([
    "+39 347 123 4567",
    "tel 3471234567",
    "chiamami al 347-123-4567:",
    "(415) 555-2671",
    "verification code is: 493812",
    "confirmation number 493812",
    "493812 is your verification code",
    "OTP 4821",
  ])("blocks private data: %s", (query) => {
    expect(blocksSearch(query)).toBe(true);
  });

  test.each(["3471234567", "2026-10-16 14:30"])("passes an unlabelled number: %s", (query) => {
    expect(blocksSearch(query)).toBe(false);
  });
});
