import { Caveat_400Regular, Caveat_700Bold } from "@expo-google-fonts/caveat";
import { useFonts as useFraunces, Fraunces_500Medium, Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { JetBrainsMono_400Regular, JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono";

// Single hook to gate App.tsx render until all custom fonts are ready.
// Returns true when loaded; until then App renders null (existing pattern).
// Caveat is the handwriting font used by the Lab Book "notebook" identity.
export function useAgoraFonts(): boolean {
  const [loaded] = useFraunces({
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
  return loaded;
}
