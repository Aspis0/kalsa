import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

// Mostra le notifiche locali anche con l'app in foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

import { createStyles } from "./src/theme/createStyles";
import { palettes, type ThemeColors, type ThemeMode } from "./src/theme/palettes";
import { useAgoraFonts } from "./src/theme/fonts";
import { useResponsiveMetrics } from "./src/theme/responsiveMetrics";
import { THEME_STORAGE_KEY, normalizeThemeMode } from "./src/theme/themeStorage";
import {
  applyFontScale,
  DEFAULT_FONT_SCALE_ID,
  FONT_SCALE_KEY,
  fontScaleValue,
  normalizeFontScaleId,
  type FontScaleId,
} from "./src/theme/typography";
import { ThemeContext, useLabTheme } from "./src/ui/labTheme";
import { AppShell } from "./src/app/AppShell";
import { getDevModelsEnabled } from "./src/bench/benchConfig";
import { configureModelRegistry } from "./src/engine/ModelRegistry";
import { LocaleProvider, useLocale } from "./src/i18n";

type ThemeContextValue = {
  colors: ThemeColors;
  mode: ThemeMode;
  palette: (typeof palettes)[ThemeMode];
  setMode: (mode: ThemeMode) => void;
  styles: ReturnType<typeof createStyles>;
  /** Numeric multiplier applied to typography tokens (0.9 | 1 | 1.15 | 1.3). */
  fontScale: number;
  /** User-facing scale id from Settings (s/m/l/xl). */
  fontScaleId: FontScaleId;
  /** Persist + apply a new in-app font scale (independent of system font). */
  setFontScaleId: (id: FontScaleId) => void;
  /** Scaled typography tokens (same content as the live module export). */
  typography: ReturnType<typeof applyFontScale>;
};

function AppContent() {
  const { ready: localeReady } = useLocale();
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [fontScaleId, setFontScaleIdState] = useState<FontScaleId>(DEFAULT_FONT_SCALE_ID);
  const [fontScaleLoaded, setFontScaleLoaded] = useState(false);
  const [fontsLoaded, fontError] = useAgoraFonts();
  const palette = palettes[themeMode];
  const responsiveMetrics = useResponsiveMetrics();

  const changeThemeMode = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    AsyncStorage.setItem(THEME_STORAGE_KEY, mode).catch(() => undefined);
  }, []);

  const setFontScaleId = useCallback((id: FontScaleId) => {
    const next = normalizeFontScaleId(id);
    setFontScaleIdState(next);
    AsyncStorage.setItem(FONT_SCALE_KEY, next).catch(() => undefined);
  }, []);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((stored) => {
        if (mounted) setThemeMode(normalizeThemeMode(stored));
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setThemeLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(FONT_SCALE_KEY)
      .then((stored) => {
        if (mounted) setFontScaleIdState(normalizeFontScaleId(stored));
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setFontScaleLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const fontScale = fontScaleValue(fontScaleId);

  const themeValue = useMemo(() => {
    // Mutate live module export + return a fresh copy for context consumers.
    const scaledTypography = applyFontScale(fontScale);
    return {
      colors: palette.colors,
      mode: themeMode,
      palette,
      setMode: changeThemeMode,
      styles: createStyles(palette.colors, responsiveMetrics),
      fontScale,
      fontScaleId,
      setFontScaleId,
      typography: scaledTypography,
    };
  }, [
    changeThemeMode,
    fontScale,
    fontScaleId,
    palette,
    responsiveMetrics,
    setFontScaleId,
    themeMode,
  ]);

  // Wait for theme + font scale + locale storage before first paint (avoids EN/M flash).
  if (!themeLoaded || !fontScaleLoaded || !localeReady) return null;
  if (!fontsLoaded && !fontError) return null;

  // Errore font: renderizza comunque con i font di sistema (mai blank screen).

  return (
    <ThemeContext.Provider value={themeValue}>
      <ThemedApp />
    </ThemeContext.Provider>
  );
}

function ThemedApp() {
  const { colors, palette } = useLabTheme<ThemeContextValue>();
  return (
    <>
      <StatusBar barStyle={palette.statusBar} backgroundColor={colors.shell} />
      <ModelCatalogBoot />
    </>
  );
}

function ModelCatalogBoot() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    void getDevModelsEnabled()
      .then((enabled) => configureModelRegistry(enabled))
      .catch(() => configureModelRegistry(false))
      .finally(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return ready ? <AppShell /> : null;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* statusBar/navigationBarTranslucent: the lib's documented props for
            edge-to-edge windows; no-op on API>=35 where the provider forces
            them true. NOTE: they were expected to close the API<=34 nav-bar
            shortfall (~40px composer under-lift, source-traced to
            getCurrentKeyboardHeight subtracting navigationBars.bottom) but an
            emulator A/B (runs 31219016159 vs 31221427122, identical geometry)
            refuted that — API<=34 keeps the shortfall regardless. Kept because
            harmless and correct for the edge-to-edge window the lib enforces;
            the target device class (Android 15/16) computes the full IME
            height either way. */}
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <LocaleProvider>
            <AppContent />
          </LocaleProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
