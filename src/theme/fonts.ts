import { Caveat_400Regular, Caveat_700Bold } from "@expo-google-fonts/caveat";
import { useFonts as useFraunces, Fraunces_500Medium, Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { JetBrainsMono_400Regular, JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono";

// Single hook to gate App.tsx render until all custom fonts are ready.
// Returns [loaded, error]: on font error the app renders with system fonts
// instead of a permanent blank screen.
export function useAgoraFonts(): [boolean, Error | null] {
  return useFraunces({
    Caveat_400Regular,
    Caveat_700Bold,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_700Bold,
  });
}
