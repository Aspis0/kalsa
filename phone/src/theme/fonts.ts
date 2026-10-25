import { IBMPlexMono_400Regular, IBMPlexMono_700Bold } from "@expo-google-fonts/ibm-plex-mono";
import {
  Inter_400Regular,
  Inter_400Regular_Italic,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  SourceSerif4_400Regular,
  SourceSerif4_400Regular_Italic,
  SourceSerif4_600SemiBold,
} from "@expo-google-fonts/source-serif-4";
import { useFonts, type FontSource } from "expo-font";

import { type LoadedFace } from "./typeData";

// Single hook to gate App.tsx render until all custom fonts are ready.
// Returns [loaded, error]: on font error the app renders with system fonts
// instead of a permanent blank screen.
// Faces: Inter (interface, with its own italic), Source Serif 4 (the answer),
// IBM Plex Mono (code and figures). SourceSerif4_400Regular_Italic is loaded
// but named by no family — the UI italic is Inter's own (typography.ts). It
// stays for the italic of the serif answer body, which still needs a token.
// Every face here is an asset the boot gate waits for before first paint.
//
// The map is typed `Record<LoadedFace, FontSource>`, where LoadedFace comes
// from typeData.ts: a face added or dropped here without updating that list is
// a compile error, which is what makes typography.test.ts's "every named face
// is loaded" assertion about THIS loader and not about a copy of it.
const AGORA_FACES: Record<LoadedFace, FontSource> = {
  Inter_400Regular,
  Inter_400Regular_Italic,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  SourceSerif4_400Regular,
  SourceSerif4_400Regular_Italic,
  SourceSerif4_600SemiBold,
  IBMPlexMono_400Regular,
  IBMPlexMono_700Bold,
};

export function useAgoraFonts(): [boolean, Error | null] {
  return useFonts(AGORA_FACES);
}
