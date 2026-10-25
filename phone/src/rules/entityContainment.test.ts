import { containsPrivateData } from "./entityContainment.js";

const FACT = "The user's cat is named Leopoldo and lives in Torino";

describe("containsPrivateData", () => {
  test.each([
    ["an identifier", "SECRET_QUERY_XYZ_LEOPOLDO"],
    ["an accent variant", "Leopóldo cat breed"],
  ])("blocks a query that exposes the fact name through %s", (_kind, query) => {
    expect(containsPrivateData(query, FACT)).toBe(true);
  });

  // Accepted limit: camelCase is not split, so the name stays inside one token.
  test("accepted limit: a camelCase identifier is not split", () => {
    expect(containsPrivateData("leopoldoCatBreed", FACT)).toBe(false);
  });

  // Hyphen and dot are not word breaks: "e-mail" stays one token and
  // "Example.com" is not "Example".
  test("does not block a mail app query for an e-mail fact", () => {
    expect(containsPrivateData("I need Mail app suggestions", "I use e-mail for work")).toBe(false);
  });

  test("does not block a mail client query for an eMail fact", () => {
    expect(containsPrivateData("I need Mail client suggestions", "I use eMail for work")).toBe(false);
  });

  test("does not block an Example search for an Example.com fact", () => {
    expect(containsPrivateData("I need Example search results", "I read Example.com")).toBe(false);
  });

  test("does not block an ISO timestamp that contains a stored year", () => {
    expect(containsPrivateData("2026-10-16T00:00:00.000Z", "My account number is 2026")).toBe(false);
  });

  // Accepted limit: inflected forms are not matched, only exact tokens.
  test("accepted limit: a plural of a fact name is not matched", () => {
    expect(containsPrivateData("Leopoldos cat breed", FACT)).toBe(false);
  });

  // Accepted limit: inflected forms are not matched, only exact tokens.
  test("accepted limit: an inflected fact word (diabete -> diabetico) is not matched", () => {
    expect(containsPrivateData("diabetico dieta", "Ho il diabete")).toBe(false);
  });

  // Blocking this would refuse a search the user asked for; a stored bank name
  // must not turn "banche" (banks) into a private-data hit.
  test("does not block a topic word that shares a stem with a fact word (banche vs Banca)", () => {
    expect(
      containsPrivateData("banche italiane", "Marco lavora alla Banca Intesa di Torino"),
    ).toBe(false);
  });

  test("does not block a 4-letter fact word inside a longer word (Roma vs Roman)", () => {
    expect(containsPrivateData("Roman history", "Vivo a Roma")).toBe(false);
  });

  test("does not block a name that is only a prefix of a longer word (Marco vs Marcolini)", () => {
    expect(containsPrivateData("Marcolini stock price", "Mi chiamo Marco")).toBe(false);
  });

  test("does not block a longer word that merely starts like a fact word (questo vs questione)", () => {
    expect(containsPrivateData("questione fiscale", "Non mi piace questo")).toBe(false);
  });

  test("does not block ordinary words that only overlap one fact word", () => {
    expect(containsPrivateData("weather in Milano", FACT)).toBe(false);
  });

  // Accepted limit: the fact is in Italian and the query in English. Word
  // matching does not translate, so this stays allowed.
  test("accepted limit: cross-language medical fact is not matched", () => {
    expect(
      containsPrivateData("peanut allergy treatment", "La mia allergia è alle arachidi"),
    ).toBe(false);
  });
});
