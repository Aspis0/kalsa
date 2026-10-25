/**
 * The root render-error boundary: without one, a throw during render took the
 * whole React tree down to a blank window, and the global `ErrorUtils` handler
 * (`logReport/collector.ts`) can only RECORD that — it cannot put a screen
 * back. This is App.tsx's OUTERMOST element, so a throw inside any provider
 * below it is caught too.
 *
 * A class because React has no hook form for error boundaries. The fallback
 * cannot read the locale from `LocaleProvider` (that context is one of the
 * things below this boundary), so it reads the same stored preference the
 * provider reads, with the same normalization rule, and speaks the default
 * catalog until that read lands. It cannot use the app's theme either, so it
 * reads the system colour scheme and uses two plain pairs.
 *
 * The key IS the recovery: changing it unmounts the crashed subtree and mounts
 * a fresh one, so no state from the failed render survives — a relaunch
 * without the process.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import {
  DEFAULT_LOCALE,
  LOCALE_KEY,
  parseLocale,
  translate,
  type Locale,
} from "../i18n";
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

/** The locale the fallback speaks: the stored preference the provider would
 *  have resolved, read without the provider because the provider is below this
 *  boundary. A storage failure is not an error of its own — the default
 *  catalog is already showing. */
function useStoredLocale(): Locale {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    let mounted = true;
    try {
      AsyncStorage.getItem(LOCALE_KEY)
        .then((raw) => {
          if (mounted) setLocale(parseLocale(raw));
        })
        .catch(() => undefined);
    } catch {
      // storage unavailable: keep the default
    }
    return () => {
      mounted = false;
    };
  }, []);
  return locale;
}

function BoundaryFallback({ onReload }: { onReload: () => void }): React.ReactElement {
  const locale = useStoredLocale();
  const palette = useColorScheme() === "dark" ? DARK : LIGHT;
  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <Text style={[styles.title, { color: palette.ink }]}>
        {translate(locale, "errorBoundary.title")}
      </Text>
      <Text style={[styles.body, { color: palette.muted }]}>
        {translate(locale, "errorBoundary.body")}
      </Text>
      <Pressable
        accessibilityRole="button"
        testID="errorBoundary.reload"
        onPress={onReload}
        style={[styles.button, { backgroundColor: palette.button }]}
      >
        <Text style={[styles.buttonLabel, { color: palette.buttonInk }]}>
          {translate(locale, "errorBoundary.reload")}
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
