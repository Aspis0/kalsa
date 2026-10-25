/**
 * The recap line under an answer (PHONE-CHAT-PROTOCOL §3.2): drawn as it is, in the
 * stop line's quiet tone, and placed under the answer and before the card and sources.
 */
import { readFileSync } from "fs";
import { join } from "path";

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

jest.mock("react-native", () => ({ Text: "Text" }));

import React from "react";

import { RecapLine } from "./RecapLine";

describe("the recap line", () => {
  test("draws its text as it is, under the answer's id, in the stop line's style", () => {
    const styles = { stopLine: { color: "grey" } } as never;
    const line = RecapLine({ id: "m1", styles, text: "Kalsa ha: aperto httpbin.org" }) as React.ReactElement<{
      children: string;
      style: unknown;
      testID: string;
    }>;
    expect(line.props.testID).toBe("transcript.recap.m1");
    expect(line.props.children).toBe("Kalsa ha: aperto httpbin.org");
    expect(line.props.style).toEqual({ color: "grey" });
  });

  test("the row draws it under the whole answer, after the answer and before the next row", () => {
    const code = stripComments(readFileSync(join(__dirname, "TranscriptRow.tsx"), "utf8"));
    const answer = code.indexOf("<Answer");
    const recap = code.indexOf("<RecapLine");
    expect(answer).toBeGreaterThan(0);
    expect(recap).toBeGreaterThan(answer);
    expect(code.indexOf("</>", recap)).toBeGreaterThan(recap);
  });
});
