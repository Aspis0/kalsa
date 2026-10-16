import { containsPrivateData } from "./entityContainment.js";

const FACT = "The user's cat is named Leopoldo and lives in Torino";

describe("containsPrivateData", () => {
  test.each([
    ["an identifier", "SECRET_QUERY_XYZ_LEOPOLDO"],
    ["an accent variant", "Leopóldo cat breed"],
    ["a camelCase identifier", "leopoldoCatBreed"],
  ])("blocks a query that exposes the fact name through %s", (_kind, query) => {
    expect(containsPrivateData(query, FACT)).toBe(true);
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
