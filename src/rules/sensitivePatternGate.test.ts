import { containsSensitivePattern } from "./sensitivePatternGate";

describe("containsSensitivePattern", () => {
  test.each([
    "4111111111111111",
    "DE89370400440532013000 bic",
    "my iban is DE89370400440532013000",
    "transfer to DE89370400440532013000",
    "credit card IT60X0542811101000000123456",
    "my codice fiscale is RSSMRA85M01A001R",
    "codice fiscale: RSSMRA85M01A001R",
    "codRSSMRA85M01A001R",
    "1234567812345678 meeting 4111111111111111",
    "4111  1111  1111  1111",
    "4111\n1111\n1111\n1111",
    "my password is hunter2",
    "pin: 1234",
    "my hiv status results",
    "I have diabetes",
    "my address is via Roma 12",
    "I live at 123 Main Street",
    "email me at alex@example.com",
    "45.4642, 9.1900",
  ])("blocks sensitive text: %s", (text) => {
    expect(containsSensitivePattern(text)).toBe(true);
  });

  test.each([
    "",
    "weather in Milano",
    "anxiety meditation",
    "diabetes diet plan",
    "allergy medicine for kids",
    "street food tour 2024",
    "wall street 1987",
    "via app store pricing",
    "road trip 10 days italy",
    "token ring network history",
    "pin a message in discord",
    "secret menu mcdonalds",
    "cf. Smith 1999",
    "1234567812345678",
    "2024.05.12.001",
  ])("allows ordinary query: %s", (text) => {
    expect(containsSensitivePattern(text)).toBe(false);
  });

  test("allows a non-string value defensively", () => {
    expect(containsSensitivePattern(null as unknown as string)).toBe(false);
  });
});
