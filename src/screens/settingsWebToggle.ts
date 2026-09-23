export type SettingsWebToggleProps = {
  checked: boolean;
  onPress: () => void;
};

export function settingsWebToggleProps(
  enabled: boolean | undefined,
  onToggle: (() => void) | undefined,
): SettingsWebToggleProps | null {
  if (!onToggle) return null;
  return { checked: enabled ?? false, onPress: onToggle };
}
