import { quizAnswer, recordQuizAnswer } from "../../lib/miniapp/state";
import type { Miniapp } from "../../lib/miniapp/types";
import { useLanguage } from "../../i18n/useLanguage";
import { asArray, asText } from "./values";

/**
 * A `quiz` block: pick an option, check, see right/wrong and the explanation.
 * Grading happens only when answerIndex addresses a real option; otherwise
 * Check says the answer is not available. The pick and its grade live in the
 * envelope's state, keyed by the block's position, so a reload shows the same
 * graded view the person left. Ported from the phone's QuizBlock.
 */

const MAX_OPTIONS = 4;

function answerIndexOf(raw: unknown, optionCount: number): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (typeof raw === "string" && !/^\s*-?\d+\s*$/.test(raw)) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 0 || n >= optionCount) return null;
  return n;
}

export function Quiz({
  miniapp,
  block,
  index,
  onState,
}: {
  miniapp: Miniapp;
  block: Record<string, unknown>;
  index: number;
  onState?: (state: Record<string, unknown>) => void;
}) {
  const { table } = useLanguage();
  const t = table.miniapp;
  const question = asText(block.question ?? block.title, t.question);
  const options = asArray(block.options, MAX_OPTIONS).map((option, at) =>
    asText(option, t.option(at + 1)),
  );
  const answerIndex = answerIndexOf(block.answerIndex, options.length);
  const explanation = asText(block.explanation, "");
  const gradable = answerIndex !== null;

  const stored = quizAnswer(miniapp.state, index);
  const selected = stored?.picked ?? null;
  const checked = stored?.checked ?? false;

  const record = (picked: number | null, graded: boolean): void =>
    onState?.(
      recordQuizAnswer(miniapp.state ?? {}, index, picked, graded, picked !== null && picked === answerIndex),
    );

  if (options.length === 0) {
    return (
      <div className="miniapp-block">
        {asText(block.title) ? (
          <p className="miniapp-block-title">{asText(block.title)}</p>
        ) : null}
        <p className="miniapp-question">{question}</p>
        <p className="miniapp-note">{t.answerNotAvailable}</p>
      </div>
    );
  }

  const correct = checked && gradable && selected === answerIndex;
  const wrong = checked && gradable && selected !== null && selected !== answerIndex;

  return (
    <div className="miniapp-block">
      {asText(block.title) ? (
        <p className="miniapp-block-title">{asText(block.title)}</p>
      ) : null}
      <p className="miniapp-question">{question}</p>
      <div className="miniapp-quiz-options" role="radiogroup" aria-label={question}>
        {options.map((label, at) => {
          const isSelected = selected === at;
          const showCorrect = checked && gradable && at === answerIndex;
          const showWrong = checked && gradable && isSelected && at !== answerIndex;
          const classes = [
            "miniapp-quiz-option",
            isSelected && (!checked || !gradable) ? "miniapp-quiz-selected" : "",
            showCorrect ? "miniapp-quiz-correct" : "",
            showWrong ? "miniapp-quiz-wrong" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              type="button"
              key={at}
              className={classes}
              aria-checked={isSelected}
              role="radio"
              disabled={checked}
              onClick={() => record(at, false)}
            >
              {String.fromCharCode(65 + at)}. {label}
              {showCorrect ? t.correctSuffix : showWrong ? t.wrongSuffix : ""}
            </button>
          );
        })}
      </div>
      <div className="miniapp-quiz-actions">
        {!checked ? (
          <button
            type="button"
            className="miniapp-button"
            disabled={selected === null}
            onClick={() => record(selected, true)}
          >
            {t.check}
          </button>
        ) : (
          <button type="button" className="miniapp-button" onClick={() => record(null, false)}>
            {t.retry}
          </button>
        )}
      </div>
      {checked ? (
        <div className="miniapp-quiz-feedback" aria-live="polite">
          {!gradable ? (
            <p className="miniapp-note">{t.answerNotAvailable}</p>
          ) : (
            <>
              <p className={correct ? "miniapp-quiz-right" : "miniapp-quiz-bad"}>
                {correct ? t.correct : t.wrong}
              </p>
              {wrong && answerIndex !== null ? (
                <p className="miniapp-note">{t.correctAnswer(options[answerIndex])}</p>
              ) : null}
              {explanation ? <p className="miniapp-note">{t.explanation(explanation)}</p> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
