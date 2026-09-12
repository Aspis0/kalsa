import {
  applyBakedUserTails,
  commitBakedLastUser,
  shouldDiscardUnprefixedHeal,
  type BakedUserTail,
} from "./memoryFactsTail";

const u = (content: string) => ({ role: "user" as const, content });
const a = (content: string) => ({ role: "assistant" as const, content });

describe("applyBakedUserTails keepers", () => {
  test("empty consecutive run still prefixes a prev user via keepers", () => {
    const baked: BakedUserTail[] = [
      { bare: "u2", prefixed: "P2\nu2" },
      { bare: "u1", prefixed: "P1\nu1" },
    ];
    const { messages, matched, firstPrevUnprefixed } = applyBakedUserTails(
      [u("u1"), a("x"), u("u2"), a("y"), u("now")],
      baked,
    );
    expect(firstPrevUnprefixed).toBe(false);
    expect(messages[0]?.content).toBe("P1\nu1");
    expect(messages[2]?.content).toBe("P2\nu2");
    expect(messages[4]?.content).toBe("now");
    expect(matched.map((t) => t.bare)).toEqual(["u1", "u2"]);
  });

  test("length-1 bake sticks to the previous last user, not the first", () => {
    const baked: BakedUserTail[] = [{ bare: "u2", prefixed: "P\nu2" }];
    const { messages, firstPrevUnprefixed } = applyBakedUserTails(
      [u("u1"), a("x"), u("u2"), a("y"), u("now")],
      baked,
    );
    expect(messages[0]?.content).toBe("u1");
    expect(messages[2]?.content).toBe("P\nu2");
    expect(firstPrevUnprefixed).toBe(true);
  });

  test("empty rematch keys never prefix the first user", () => {
    const baked: BakedUserTail[] = [{ bare: "", prefixed: "P\n" }];
    const { messages } = applyBakedUserTails(
      [u(""), a("x"), u(""), a("y"), u("now")],
      baked,
    );
    expect(messages[0]?.content).toBe("");
    expect(messages[2]?.content).toBe("");
  });

  test("firstPrevUnprefixed when baked has only a later user", () => {
    const baked: BakedUserTail[] = [{ bare: "tea", prefixed: "FACTS\n\ntea" }];
    const { messages, firstPrevUnprefixed, matched } = applyBakedUserTails(
      [u("hello"), a("x"), u("tea"), a("y"), u("now")],
      baked,
    );
    expect(firstPrevUnprefixed).toBe(true);
    expect(messages[0]?.content).toBe("hello");
    expect(messages[2]?.content).toBe("FACTS\n\ntea");
    expect(matched.map((t) => t.bare)).toEqual(["hello", "tea"]);
  });
});

describe("commitBakedLastUser", () => {
  test("keeps earlier tail when rematch run is empty", () => {
    const earlier: BakedUserTail = { bare: "hello", prefixed: "FACTS\n\nhello" };
    const next = commitBakedLastUser([], "now", "P\n\nnow", [earlier]);
    expect(next).toEqual([
      earlier,
      { bare: "now", prefixed: "P\n\nnow" },
    ]);
  });

  test("identity tails stop a restore-discard loop", () => {
    const history = [u("hello"), a("x"), u("tea"), a("y"), u("now")];
    const baked: BakedUserTail[] = [{ bare: "tea", prefixed: "FACTS\n\ntea" }];
    const first = applyBakedUserTails(history, baked);
    expect(first.firstPrevUnprefixed).toBe(true);
    const committed = commitBakedLastUser(
      first.matched,
      "now",
      "P\n\nnow",
    );
    expect(committed).toEqual([
      { bare: "hello", prefixed: "hello" },
      { bare: "tea", prefixed: "FACTS\n\ntea" },
      { bare: "now", prefixed: "P\n\nnow" },
    ]);
    const second = applyBakedUserTails(history, committed);
    expect(second.firstPrevUnprefixed).toBe(false);
    expect(second.messages[0]?.content).toBe("hello");
  });

  test("identity tails do not rewrite original message content", () => {
    const history = [u("hello "), a("x"), u("tea"), a("y"), u("now")];
    const baked: BakedUserTail[] = [{ bare: "tea", prefixed: "FACTS\n\ntea" }];
    const first = applyBakedUserTails(history, baked);
    expect(first.firstPrevUnprefixed).toBe(true);
    const committed = commitBakedLastUser(first.matched, "now", "P\n\nnow");
    const second = applyBakedUserTails(history, committed);
    expect(second.firstPrevUnprefixed).toBe(false);
    expect(second.messages[0]?.content).toBe("hello ");
  });

  test("send2 after commit with extra last user is not firstPrevUnprefixed", () => {
    const baked: BakedUserTail[] = [{ bare: "u4", prefixed: "P\nu4" }];
    const hist1 = [
      u("u1"), a("a"), u("u2"), a("b"), u("u3"), a("c"), u("u4"), a("d"), u("now"),
    ];
    const first = applyBakedUserTails(hist1, baked);
    expect(first.firstPrevUnprefixed).toBe(true);
    const committed = commitBakedLastUser(first.matched, "now", "Pnow");
    const hist2 = [...hist1, a("ok"), u("next")];
    const second = applyBakedUserTails(hist2, committed);
    expect(second.firstPrevUnprefixed).toBe(false);
  });
});

describe("shouldDiscardUnprefixedHeal", () => {
  test("one heal per hold", () => {
    expect(
      shouldDiscardUnprefixedHeal({
        firstPrevUnprefixed: true,
        kvHoldsChatSession: true,
        alreadyHealed: false,
      }),
    ).toBe(true);
    expect(
      shouldDiscardUnprefixedHeal({
        firstPrevUnprefixed: true,
        kvHoldsChatSession: true,
        alreadyHealed: true,
      }),
    ).toBe(false);
    expect(
      shouldDiscardUnprefixedHeal({
        firstPrevUnprefixed: true,
        kvHoldsChatSession: false,
        alreadyHealed: false,
      }),
    ).toBe(false);
  });
});
