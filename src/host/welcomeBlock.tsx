/** The first-open state is the photograph alone, with a tint block on failure. */
import { useState } from "react";
import { Image, View } from "react-native";
import { modes, radius, type ThemeMode } from "../theme/design";

function tryRequireAsset(load: () => unknown): number | undefined {
  try {
    const value = load();
    return typeof value === "number" ? value : undefined;
  } catch {
    return undefined;
  }
}

const EMPTY_STATE_RASTER = tryRequireAsset(() => require("../../assets/brand/light/empty-state.jpg"));

export function WelcomeBlock({ mode }: { mode: ThemeMode }) {
  const colors = modes[mode];
  const [artFailed, setArtFailed] = useState(false);
  const showArt = EMPTY_STATE_RASTER !== undefined && !artFailed;

  return (
    <View
      testID="chat.welcome"
      style={{
        width: "100%",
        aspectRatio: 4 / 3,
        borderRadius: radius.image,
        overflow: "hidden",
        backgroundColor: colors.tint,
      }}
    >
      {showArt ? (
        <Image
          source={EMPTY_STATE_RASTER}
          resizeMode="cover"
          accessible={false}
          importantForAccessibility="no"
          onError={() => setArtFailed(true)}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%" }}
        />
      ) : null}
    </View>
  );
}
