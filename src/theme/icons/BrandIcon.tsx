/**
 * Kalsa composer chrome. Prefers a bundled raster when Metro can resolve it;
 * missing glyphs (or a failed decode) fall back to an accent disc + vector mark.
 * Hit target is 36pt to match the composer action row.
 *
 * Decorative only: parents own the accessibility label. The raster Image must
 * never become its own a11y node (it would steal "Send" / "Attach" / "Mic").
 */

import React, { useState } from "react";
import { Image, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import { useLabTheme } from "../../ui/labTheme";

export type BrandIconName =
  | "send-ready"
  | "send-idle"
  | "stop"
  | "attach"
  | "mic"
  | "new-chat"
  | "copy"
  | "share";

export type BrandIconTone = "accent" | "danger";

export type BrandIconProps = {
  name: BrandIconName;
  /** Visual + hit size. Default 36. */
  size?: number;
  /** Disc fill for the vector fallback (listening mic uses danger). */
  tone?: BrandIconTone;
};

const HIT = 36;
/** Accent disc from the Sage paper palette — used when no raster is present. */
const ACCENT = "#1F5F4E";
const CREAM = "#F4EFE4";
/**
 * Rasters are square plates with a sage paper margin around the disc.
 * Scale past 1 so the disc fills the circular clip.
 */
const DISC_SCALE = 1.28;

/** Metro still sees the require(); a throw (missing packager asset) must not kill chat. */
function tryRequire(load: () => unknown): number | undefined {
  try {
    const value = load();
    return typeof value === "number" ? value : undefined;
  } catch {
    return undefined;
  }
}

const LIGHT_RASTERS: Partial<Record<BrandIconName, number | undefined>> = {
  "send-ready": tryRequire(() => require("../../../assets/brand/light/send-ready.jpg")),
  "send-idle": tryRequire(() => require("../../../assets/brand/light/send-idle.jpg")),
  stop: tryRequire(() => require("../../../assets/brand/light/stop.jpg")),
  attach: tryRequire(() => require("../../../assets/brand/light/attach.jpg")),
  mic: tryRequire(() => require("../../../assets/brand/light/mic.jpg")),
  "new-chat": tryRequire(() => require("../../../assets/brand/light/new-chat.jpg")),
  copy: tryRequire(() => require("../../../assets/brand/light/copy.jpg")),
  share: tryRequire(() => require("../../../assets/brand/light/share.jpg")),
};

const DARK_RASTERS: Partial<Record<BrandIconName, number | undefined>> = {
  "send-ready": tryRequire(() => require("../../../assets/brand/dark/send-ready.jpg")),
};

function resolveRaster(
  name: BrandIconName,
  mode: string | undefined,
): number | undefined {
  // Dark must not serve light sage JPEGs — missing DARK_RASTERS fall back to vectors.
  if (mode === "dark") {
    return DARK_RASTERS[name];
  }
  return LIGHT_RASTERS[name];
}

function ChevronMark({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M5.2 15.6 L12 8.2 L18.8 15.6 L16.2 15.6 L12 11 L7.8 15.6 Z"
        fill={color}
      />
    </Svg>
  );
}

function SquareMark({ color, size }: { color: string; size: number }) {
  const inset = size * 0.3;
  const side = size - inset * 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Rect x={inset} y={inset} width={side} height={side} rx={2} fill={color} />
    </Svg>
  );
}

function PlusMark({ color, size }: { color: string; size: number }) {
  const stroke = Math.max(2, size * 0.1);
  const mid = size / 2;
  const arm = size * 0.22;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Path
        d={`M${mid} ${mid - arm} V${mid + arm} M${mid - arm} ${mid} H${mid + arm}`}
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function MicMark({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={9} y={4} width={6} height={10} rx={3} fill={color} />
      <Path
        d="M7 11.5 C7 14.5 9 16.5 12 16.5 C15 16.5 17 14.5 17 11.5"
        stroke={color}
        strokeWidth={1.8}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M12 16.5 V19.5 M9.5 19.5 H14.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function CopyMark({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect
        x={8}
        y={4}
        width={10}
        height={12}
        rx={2}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
      />
      <Rect
        x={5}
        y={8}
        width={10}
        height={12}
        rx={2}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
      />
    </Svg>
  );
}

function ShareMark({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M14 7 L19 12 L14 17"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M19 12 H9.5 C7 12 5.5 13.6 5.5 16 V18"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function VectorMark({
  name,
  color,
  size,
}: {
  name: BrandIconName;
  color: string;
  size: number;
}) {
  if (name === "stop") return <SquareMark color={color} size={size} />;
  if (name === "mic") return <MicMark color={color} size={size} />;
  if (name === "copy") return <CopyMark color={color} size={size} />;
  if (name === "share") return <ShareMark color={color} size={size} />;
  if (name === "attach" || name === "new-chat") {
    return <PlusMark color={color} size={size} />;
  }
  return <ChevronMark color={color} size={size} />;
}

const A11Y_HIDE = {
  accessible: false as const,
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants" as const,
};

export function BrandIcon({ name, size = HIT, tone = "accent" }: BrandIconProps) {
  const { colors, mode } = useLabTheme<any>();
  const raster = tone === "danger" ? undefined : resolveRaster(name, mode);
  const rasterKey = `${String(mode)}:${name}:${String(raster ?? "")}`;
  // Keyed by glyph: a failed send-ready decode must not poison send-idle.
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const showRaster = raster != null && failedKey !== rasterKey;

  const discFill =
    tone === "danger"
      ? (colors.bad as string | undefined) ?? "#B3261E"
      : (colors.accent as string | undefined) ?? ACCENT;
  const markColor = (colors.primaryText as string | undefined) ?? CREAM;
  const idleRing = (colors.muted as string | undefined) ?? "#58615B";
  const isIdle = name === "send-idle";

  if (showRaster) {
    const img = size * DISC_SCALE;
    const shift = -((DISC_SCALE - 1) * size) / 2;
    return (
      <View
        pointerEvents="none"
        {...A11Y_HIDE}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: "hidden",
        }}
      >
        <Image
          source={raster}
          style={{
            width: img,
            height: img,
            marginLeft: shift,
            marginTop: shift,
            borderRadius: img / 2,
          }}
          resizeMode="cover"
          resizeMethod="resize"
          accessible={false}
          importantForAccessibility="no"
          onError={() => setFailedKey(rasterKey)}
        />
      </View>
    );
  }

  return (
    <View
      pointerEvents="none"
      {...A11Y_HIDE}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: isIdle ? "transparent" : discFill,
        borderWidth: isIdle ? 2 : 0,
        borderColor: isIdle ? idleRing : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <VectorMark
        name={name}
        color={isIdle ? idleRing : markColor}
        size={Math.round(size * 0.58)}
      />
    </View>
  );
}
