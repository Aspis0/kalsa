import React from "react";
import { View } from "react-native";
import { ChevronLeft, ChevronRight, Check } from "lucide-react-native";
import { useLabTheme } from "../../ui/labTheme";
import { spacing } from "../tokens";
import { Button } from "./Button";

type Props = {
  onBack?: () => void;
  backLabel?: string;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  onDone?: () => void;
  doneLabel?: string;
  doneDisabled?: boolean;
};

// Sticky bottom action bar for wizard flows.
// Pass either onNext (intermediate steps) or onDone (final step).
export function WizardFooter({
  onBack,
  backLabel = "Back",
  onNext,
  nextLabel = "Next",
  nextDisabled = false,
  onDone,
  doneLabel = "Save",
  doneDisabled = false,
}: Props) {
  const { colors } = useLabTheme<any>();
  const primaryIsDone = Boolean(onDone) && !onNext;
  const primaryLabel = primaryIsDone ? doneLabel : nextLabel;
  const primaryPress = primaryIsDone ? onDone : onNext;
  const primaryDisabled = primaryIsDone ? doneDisabled : nextDisabled;
  const primaryTrailing = primaryIsDone ? (
    <Check color={colors.primaryText} size={16} strokeWidth={2.2} />
  ) : (
    <ChevronRight color={colors.primaryText} size={16} strokeWidth={2.2} />
  );

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderTopWidth: 1,
        borderTopColor: colors.line,
        backgroundColor: colors.shellElevated,
      }}
    >
      {onBack ? (
        <Button
          label={backLabel}
          variant="ghost"
          size="md"
          leadingIcon={<ChevronLeft color={colors.accent} size={16} strokeWidth={2.2} />}
          onPress={onBack}
        />
      ) : (
        <View />
      )}
      <View style={{ flex: 1 }} />
      {primaryPress ? (
        <Button
          label={primaryLabel}
          variant="primary"
          size="md"
          trailingIcon={primaryTrailing}
          disabled={primaryDisabled}
          onPress={primaryPress}
        />
      ) : null}
    </View>
  );
}
