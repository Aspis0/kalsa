import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { TranslateFn } from "../../i18n";

type QuizBlockData = {
  question?: string;
  options?: unknown;
  answerIndex?: unknown;
  explanation?: unknown;
  title?: unknown;
};

type Props = {
  block: QuizBlockData;
  styles: Record<string, any>;
  t: TranslateFn;
};

function toText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function normalizeOptions(raw: unknown): string[] {
  // Real options only — never invent synthetic "Option N" pads (user could pick a fake answer).
  const list = Array.isArray(raw) ? raw : [];
  return list.slice(0, 4).map((entry, index) => toText(entry, `Option ${index + 1}`));
}

/**
 * Only an explicit integer that addresses a REAL option is gradable.
 * Missing / non-integer / out-of-range → null (never default to 0).
 *
 * `optionCount` matters since options are no longer padded to 4: a payload with
 * two options and answerIndex 3 would otherwise read as gradable while pointing
 * at an option that does not exist, so the user could never be right.
 */
function normalizeAnswerIndex(raw: unknown, optionCount: number): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (typeof raw === "string" && !/^\s*-?\d+\s*$/.test(raw)) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 0 || n >= optionCount) return null;
  return n;
}

/**
 * Interactive multiple-choice quiz block.
 * Local state only: select → Check → feedback → Retry.
 * answerIndex is never shown until the user checks (and only when gradable).
 * When answerIndex is null, Check reports "answer not available" without grading.
 */
export function QuizBlockView({ block, styles, t }: Props) {
  const question = toText(block.question ?? block.title, t("quiz.questionFallback"));
  const options = normalizeOptions(block.options);
  const answerIndex = normalizeAnswerIndex(block.answerIndex, options.length);
  const explanation = toText(block.explanation, "");
  const gradable = answerIndex !== null;

  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);

  const isCorrect = checked && gradable && selected === answerIndex;
  const isWrong = checked && gradable && selected !== null && selected !== answerIndex;
  const notGradable = checked && !gradable;

  const onCheck = () => {
    if (selected === null) return;
    setChecked(true);
  };

  const onRetry = () => {
    setSelected(null);
    setChecked(false);
  };

  // Zero options: no selectable answers — show answer-not-available fallback (not a dead end UI).
  if (options.length === 0) {
    return (
      <View style={styles.miniappFallbackBlock}>
        {toText(block.title) ? (
          <Text style={styles.miniappBlockTitle}>{toText(block.title)}</Text>
        ) : null}
        <Text style={[styles.miniappFallbackText, { marginBottom: 10 }]}>{question}</Text>
        <Text style={styles.miniappFallbackText}>{t("quiz.notGradable")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.miniappFallbackBlock}>
      {toText(block.title) ? (
        <Text style={styles.miniappBlockTitle}>{toText(block.title)}</Text>
      ) : null}
      <Text style={[styles.miniappFallbackText, { marginBottom: 10 }]}>{question}</Text>

      <View
        accessibilityRole="radiogroup"
        style={{ gap: 8 }}
      >
        {options.map((label, index) => {
          const isSelected = selected === index;
          const showCorrect = checked && gradable && index === answerIndex;
          const showWrong = checked && gradable && isSelected && index !== answerIndex;

          // Explicit text (not color alone) for a11y when graded.
          const a11ySuffix = showCorrect
            ? ` — ${t("quiz.correct")}`
            : showWrong
              ? ` — ${t("quiz.wrong")}`
              : "";

          return (
            <Pressable
              accessibilityLabel={`${String.fromCharCode(65 + index)}. ${label}${a11ySuffix}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected, disabled: checked, selected: isSelected }}
              disabled={checked}
              key={`quiz-opt-${index}`}
              onPress={() => setSelected(index)}
              style={({ pressed }) => [
                styles.miniappQuizOption,
                // Keep selection tint after check when answer is not gradable
                // (old inline styles did; !checked alone dropped it).
                isSelected && (!checked || !gradable) ? styles.miniappQuizOptionSelected : null,
                showCorrect ? styles.miniappQuizOptionCorrect : null,
                showWrong ? styles.miniappQuizOptionWrong : null,
                pressed && !checked ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={styles.miniappFallbackText}>
                {String.fromCharCode(65 + index)}. {label}
                {showCorrect ? `  ${t("quiz.correct")}` : null}
                {showWrong ? `  ${t("quiz.wrong")}` : null}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.miniappActionRow, { marginTop: 12 }]}>
        {!checked ? (
          <Pressable
            accessibilityRole="button"
            disabled={selected === null}
            onPress={onCheck}
            style={({ pressed }) => [
              styles.miniappPrimaryAction,
              selected === null ? { opacity: 0.45 } : null,
              pressed && selected !== null ? styles.miniappPrimaryActionPressed : null,
            ]}
          >
            <Text style={styles.miniappPrimaryActionText}>{t("quiz.check")}</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [
              styles.miniappPrimaryAction,
              pressed ? styles.miniappPrimaryActionPressed : null,
            ]}
          >
            <Text style={styles.miniappPrimaryActionText}>{t("quiz.retry")}</Text>
          </Pressable>
        )}
      </View>

      {checked ? (
        <View
          accessibilityLiveRegion="polite"
          style={{ marginTop: 12, gap: 6 }}
        >
          {notGradable ? (
            <Text style={styles.miniappFallbackText}>
              {t("quiz.notGradable")}
            </Text>
          ) : (
            <>
              <Text
                accessibilityRole="text"
                style={[
                  styles.miniappFallbackText,
                  isCorrect ? styles.miniappQuizFeedbackCorrect : styles.miniappQuizFeedbackWrong,
                ]}
              >
                {isCorrect ? t("quiz.correct") : t("quiz.wrong")}
              </Text>
              {isWrong && answerIndex !== null ? (
                <Text style={styles.miniappFallbackText}>
                  {t("quiz.correctAnswer", { answer: options[answerIndex] })}
                </Text>
              ) : null}
              {explanation ? (
                <Text style={styles.miniappFallbackText}>
                  {t("quiz.explanation")}: {explanation}
                </Text>
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}
