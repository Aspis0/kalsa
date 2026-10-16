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
    "4155552671 reverse lookup",
    "415 555 2671",
    "333.123.4567",
    "+1 415-555-2671",
    "confirmation code 493812",
    "verification code 493812",
    "one-time code 493812",
    "codice 493812",
    "conferma 493812",
    "verifica 493812",
    "your code is 493812",
    "493812 is your verification code",
    "code: AB12CD",
    "verification code 4a7b9c8d",
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
    "2026-10-16",
    "2026-10-16 14:30",
    "2026.10.16.1",
    "1.2.3",
    "v1.2.3.4",
    "12.50 euro",
    "1234567.89 euro",
    "error code 404",
    "code review in 2026",
    "codice fiscale",
    "verification steps for gmail",
    "verifica documenti in comune",
  ])("allows ordinary query: %s", (text) => {
    expect(containsSensitivePattern(text)).toBe(false);
  });

  test("allows a non-string value defensively", () => {
    expect(containsSensitivePattern(null as unknown as string)).toBe(false);
  });
});
