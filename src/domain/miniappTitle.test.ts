import { miniappDisplayTitle, miniappFileStem } from "./miniappTitle";

const ITALIAN: Record<string, string> = {
  "renderer.calculator": "Calcolatrice",
  "renderer.kindCompareData": "Confronto",
  "renderer.kindReadingQuiz": "Quiz",
  "renderer.kindChecklist": "Checklist",
};
const italian = (key: string) => ITALIAN[key];

describe("miniappDisplayTitle", () => {
  test("an unnamed calculator is named in the interface's language", () => {
    expect(miniappDisplayTitle({ kind: "quick_calculator", title: "" }, italian)).toBe("Calcolatrice");
  });

  test("a calculator saved with the old English default is named in the interface's language", () => {
    expect(miniappDisplayTitle({ kind: "quick_calculator", title: "Calculator" }, italian)).toBe("Calcolatrice");
  });

  test("every kind's former English default is named in the interface's language", () => {
    expect(miniappDisplayTitle({ kind: "compare_data", title: "Comparison" }, italian)).toBe("Confronto");
    expect(miniappDisplayTitle({ kind: "reading_quiz", title: "Quiz" }, italian)).toBe("Quiz");
    expect(miniappDisplayTitle({ kind: "checklist", title: "Checklist" }, italian)).toBe("Checklist");
    expect(miniappDisplayTitle({ kind: "checklist", title: "" }, italian)).toBe("Checklist");
  });

  test("the generic default the normaliser wrote is no title either", () => {
    expect(miniappDisplayTitle({ kind: "compare_data", title: "Miniapp" }, italian)).toBe("Confronto");
  });

  test("a title the person gave wins, even one that is another kind's default", () => {
    expect(miniappDisplayTitle({ kind: "quick_calculator", title: "Mutuo" }, italian)).toBe("Mutuo");
    expect(miniappDisplayTitle({ kind: "quick_calculator", title: "Checklist" }, italian)).toBe("Checklist");
    expect(miniappDisplayTitle({ kind: "compare_data", title: "Piani" }, italian)).toBe("Piani");
  });

  test("a kind with no name shows the title it has", () => {
    expect(miniappDisplayTitle({ kind: "calculator", title: "" }, italian)).toBe("");
    expect(miniappDisplayTitle({ kind: "table", title: "Miniapp" }, italian)).toBe("Miniapp");
  });
});

describe("miniappFileStem", () => {
  test("a titled calculator is named by its kind and its title", () => {
    expect(miniappFileStem({ kind: "quick_calculator", title: "Mutuo" }, "Mutuo")).toBe("quick-calculator-mutuo");
  });

  test("an unnamed calculator is named once, by the interface's name, not by its kind twice", () => {
    expect(miniappFileStem({ kind: "quick_calculator", title: "" }, "Calcolatrice")).toBe("calcolatrice");
    expect(miniappFileStem({ kind: "quick_calculator", title: "Calculator" }, "Calculator")).toBe("calculator");
  });
});
