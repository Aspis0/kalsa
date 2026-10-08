import { miniappDisplayTitle } from "./miniappTitle";

describe("miniappDisplayTitle", () => {
  test("an unnamed calculator is named in the interface's language", () => {
    expect(miniappDisplayTitle({ kind: "quick_calculator", title: "" }, "Calcolatrice")).toBe("Calcolatrice");
  });

  test("a calculator's own title wins over the name", () => {
    expect(miniappDisplayTitle({ kind: "quick_calculator", title: "Mutuo" }, "Calcolatrice")).toBe("Mutuo");
  });

  test("other miniapps show the title they have, never the calculator's name", () => {
    expect(miniappDisplayTitle({ kind: "compare_data", title: "Piani" }, "Calcolatrice")).toBe("Piani");
    expect(miniappDisplayTitle({ kind: "checklist", title: "" }, "Calcolatrice")).toBe("");
  });
});
