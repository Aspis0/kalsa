/**
 * The root render-error boundary: without one, a throw during render took the
 * whole React tree down to a blank window, and the global `ErrorUtils` handler
 * (`logReport/collector.ts`) can only RECORD that — it cannot put a screen
 * back. This catches the throw, records it through the same `js_error` path,
 * and shows a plain recoverable screen whose one action remounts the subtree.
 *
 * A class because React has no hook form for error boundaries. The fallback
 * cannot use the app's theme (`ThemeContext` is one of the things below this
 * boundary), so it reads the system colour scheme and uses two plain pairs.
 *
 * The key IS the recovery: changing it unmounts the crashed subtree and mounts
 * a fresh one, so no state from the failed render survives — a relaunch
 * without the process.
 */
import React from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import { useLocale } from "../i18n";
import { recordJsError } from "../logReport/collector";

type FallbackPalette = {
  background: string;
  ink: string;
  muted: string;
  button: string;
  buttonInk: string;
};

const LIGHT: FallbackPalette = {
  background: "#f2f2f7",
  ink: "#111111",
  muted: "#55555c",
  button: "#111111",
  buttonInk: "#ffffff",
};

const DARK: FallbackPalette = {
  background: "#111114",
  ink: "#f5f5f7",
  muted: "#a1a1a8",
  button: "#f5f5f7",
  buttonInk: "#111114",
};

type AppErrorBoundaryProps = { children: React.ReactNode };
type AppErrorBoundaryState = { attempt: number; failed: boolean };

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { attempt: 0, failed: false };

  static getDerivedStateFromError(): Partial<AppErrorBoundaryState> {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    recordJsError(error);
  }

  private readonly reload = (): void => {
    this.setState((prev) => ({ attempt: prev.attempt + 1, failed: false }));
  };

  render(): React.ReactNode {
    if (this.state.failed) return <BoundaryFallback onReload={this.reload} />;
    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  }
}

function BoundaryFallback({ onReload }: { onReload: () => void }): React.ReactElement {
  const { t } = useLocale();
  const palette = useColorScheme() === "dark" ? DARK : LIGHT;
  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <Text style={[styles.title, { color: palette.ink }]}>{t("errorBoundary.title")}</Text>
      <Text style={[styles.body, { color: palette.muted }]}>{t("errorBoundary.body")}</Text>
      <Pressable
        accessibilityRole="button"
        testID="errorBoundary.reload"
        onPress={onReload}
        style={[styles.button, { backgroundColor: palette.button }]}
      >
        <Text style={[styles.buttonLabel, { color: palette.buttonInk }]}>
          {t("errorBoundary.reload")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: "600", textAlign: "center" },
  body: { fontSize: 15, textAlign: "center" },
  button: { marginTop: 8, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
});
