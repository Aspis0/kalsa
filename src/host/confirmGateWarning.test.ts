/**
 * The confirm sheet's low-memory sentence: the byte maths, the refusal it is
 * allowed to speak for (RAM only), and the honest fallback when the numbers
 * are somehow absent. Driven against BOTH shipped catalogues so a key that
 * leaves one, or placeholders that drift, fails here — the gate behind this
 * sentence is not importable (llama.rn), so this file is where its words are
 * held.
 */
import { makeT, en, it as italian } from "../i18n";
import { confirmGateWarning } from "./confirmGateWarning";

const t = makeT("en");
const tIt = makeT("it");

/** The capture's own pair: 1662 MiB charged against 1609 MiB available. */
const CHARGE_MIB = 1662;
const AVAILABLE_MIB = 1609;

function warn(
  overrides: Partial<Parameters<typeof confirmGateWarning>[0]> = {},
): string | null {
  return confirmGateWarning({
    gate: { allowed: false, reason: "blocked_ram", nonEvictableMiB: CHARGE_MIB },
    availableMemoryBytes: AVAILABLE_MIB * 1024 * 1024,
    modelName: "LFM2.5 2.6B",
    t,
    ...overrides,
  });
}

describe("a RAM refusal quotes what the load will cost against what is free", () => {
  it("converts the gate's MiB charge and the fresh sample to whole MB", () => {
    const sentence = warn();
    expect(sentence).toContain("LFM2.5 2.6B");
    // 1662 MiB = 1743 MB, 1609 MiB = 1687 MB — the two numbers must stay
    // distinguishable, which is exactly why this is not `formatBytes`
    // (both would round to "1.7 GB" and the sentence would say nothing).
    expect(sentence).toContain("1743 MB");
    expect(sentence).toContain("1687 MB");
    expect(sentence).not.toContain("{");
    expect(sentence).not.toContain("}");
  });

  it("says the download can proceed AND that the load will not, in both catalogues", () => {
    const enSentence = warn();
    const itSentence = warn({ t: tIt });
    expect(enSentence).toContain(en.download.confirmLowMemory.slice(0, 12));
    expect(itSentence).toContain(italian.download.confirmLowMemory.slice(0, 12));
    expect(itSentence).not.toBe(enSentence);
    // Both catalogues carry the same placeholders, so the numbers land in both.
    const placeholders = (value: string | null) =>
      (value?.match(/\{(\w+)\}/g) ?? []).sort();
    expect(placeholders(itSentence)).toEqual(placeholders(enSentence));
    expect(placeholders(enSentence)).toEqual([]);
  });
});

describe("the sentence is silent wherever it would be a lie or a duplicate", () => {
  it("never speaks for a verdict that is allowed, even labelled blocked_ram", () => {
    expect(
      warn({ gate: { allowed: true, reason: "blocked_ram", nonEvictableMiB: CHARGE_MIB } }),
    ).toBeNull();
  });

  it("never warns on tier/disk refusals — the sheet refuses those outright", () => {
    expect(warn({ gate: { allowed: false, reason: "blocked_tier", nonEvictableMiB: null } })).toBeNull();
    expect(warn({ gate: { allowed: false, reason: "blocked_disk", nonEvictableMiB: null } })).toBeNull();
    expect(warn({ gate: { allowed: false, reason: "unknown", nonEvictableMiB: null } })).toBeNull();
    expect(warn({ gate: { allowed: false, reason: "ok", nonEvictableMiB: null } })).toBeNull();
  });

  it("falls back to the plain reason when a number is missing — never a fabricated one", () => {
    expect(
      warn({ gate: { allowed: false, reason: "blocked_ram", nonEvictableMiB: null } }),
    ).toBe(en.models.blockedRam);
    expect(warn({ availableMemoryBytes: null })).toBe(en.models.blockedRam);
    expect(
      confirmGateWarning({
        gate: { allowed: false, reason: "blocked_ram", nonEvictableMiB: null },
        availableMemoryBytes: null,
        modelName: "LFM2.5 2.6B",
        t: tIt,
      }),
    ).toBe(italian.models.blockedRam);
  });
});
