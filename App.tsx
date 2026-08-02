import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
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
import { ThemeContext, useLabTheme } from "./src/ui/labTheme";
import { AppShell } from "./src/app/AppShell";

type ThemeContextValue = {
  colors: ThemeColors;
  mode: ThemeMode;
  palette: (typeof palettes)[ThemeMode];
  setMode: (mode: ThemeMode) => void;
  styles: ReturnType<typeof createStyles>;
};

function AppContent() {
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [themeLoaded, setThemeLoaded] = useState(false);
  const [fontsLoaded, fontError] = useAgoraFonts();
  const palette = palettes[themeMode];
  const responsiveMetrics = useResponsiveMetrics();

  const changeThemeMode = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    AsyncStorage.setItem(THEME_STORAGE_KEY, mode).catch(() => undefined);
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

  const themeValue = useMemo(
    () => ({
      colors: palette.colors,
      mode: themeMode,
      palette,
      setMode: changeThemeMode,
      styles: createStyles(palette.colors, responsiveMetrics),
    }),
    [changeThemeMode, palette, responsiveMetrics, themeMode],
  );

  if (!themeLoaded) return null;
  if (!fontsLoaded && !fontError) return null;

  // Errore font: renderizza comunque con i font di sistema (mai blank screen).

  return (
    <ThemeContext.Provider value={themeValue}>
      <ThemedApp />
    </ThemeContext.Provider>
  );
}

function ThemedApp() {
  const { colors } = useLabTheme<ThemeContextValue>();
  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={colors.shell} />
      <AppShell />
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppContent />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
