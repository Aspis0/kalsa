import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { type AnimatedStyle } from "react-native-reanimated";
import Svg, { ClipPath, Defs, LinearGradient as SvgGradient, Path, Stop } from "react-native-svg";
import {
  LEAF_CLIP_LEFT,
  LEAF_CLIP_RIGHT,
  LEAF_D,
  LEAF_FLAP_D,
  LEAF_FOLD_X,
  LEAF_FOLD_Y,
  LEAF_VB_H,
  LEAF_VB_W,
} from "./leafPath";

type Colors = {
  leafBody: string;
  leafBodyDeep: string;
  leafBack: string;
  leafStroke: string;
  leafShade: string;
};

type Props = {
  width: number;
  height: number;
  colors: Colors;
  flapStyle: AnimatedStyle<ViewStyle>;
  flapFrontStyle: AnimatedStyle<ViewStyle>;
  flapBackStyle: AnimatedStyle<ViewStyle>;
  creaseStyle: AnimatedStyle<ViewStyle>;
  shadeStyle: AnimatedStyle<ViewStyle>;
};

function LeafHalf({
  width,
  height,
  clipId,
  clip,
  gradId,
  d,
  top,
  bottom,
  stroke,
}: {
  width: number;
  height: number;
  clipId: string;
  clip: string;
  gradId: string;
  d: string;
  top: string;
  bottom: string;
  stroke: string;
}) {
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${LEAF_VB_W} ${LEAF_VB_H}`}
      // Non-uniform stretch vs 390×800 is accepted (same as the v11.1 stage).
      preserveAspectRatio="none"
      pointerEvents="none"
    >
      <Defs>
        <SvgGradient id={gradId} x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0" stopColor={top} />
          <Stop offset="1" stopColor={bottom} />
        </SvgGradient>
        <ClipPath id={clipId}>
          <Path d={clip} />
        </ClipPath>
      </Defs>
      <Path
        clipPath={`url(#${clipId})`}
        d={d}
        fill={`url(#${gradId})`}
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function LeafPaper({
  width,
  height,
  colors,
  flapStyle,
  flapFrontStyle,
  flapBackStyle,
  creaseStyle,
  shadeStyle,
}: Props) {
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const foldX = (LEAF_FOLD_X / LEAF_VB_W) * width;
  const foldY = (LEAF_FOLD_Y / LEAF_VB_H) * height;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LeafHalf
        width={width}
        height={height}
        clipId={`${uid}cL`}
        clip={LEAF_CLIP_LEFT}
        gradId={`${uid}gL`}
        d={LEAF_D}
        top={colors.leafBody}
        bottom={colors.leafBodyDeep}
        stroke={colors.leafStroke}
      />
      <Animated.View
        collapsable={false}
        style={[StyleSheet.absoluteFill, { transformOrigin: [foldX, foldY] }, flapStyle]}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, flapBackStyle]}>
          <LeafHalf
            width={width}
            height={height}
            clipId={`${uid}cB`}
            clip={LEAF_CLIP_RIGHT}
            gradId={`${uid}gB`}
            d={LEAF_FLAP_D}
            top={colors.leafBack}
            bottom={colors.leafBack}
            stroke={colors.leafStroke}
          />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, flapFrontStyle]}>
          <LeafHalf
            width={width}
            height={height}
            clipId={`${uid}cR`}
            clip={LEAF_CLIP_RIGHT}
            gradId={`${uid}gR`}
            d={LEAF_FLAP_D}
            top={colors.leafBody}
            bottom={colors.leafBodyDeep}
            stroke={colors.leafStroke}
          />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, shadeStyle]}>
          <LinearGradient
            colors={[colors.leafShade, "transparent"]}
            locations={[0, 0.55]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            left: foldX - 1.5,
            top: height * (70 / LEAF_VB_H),
            width: 3,
            height: height * (640 / LEAF_VB_H),
            borderRadius: 2,
            backgroundColor: colors.leafStroke,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.2,
            shadowRadius: 6,
            elevation: 3,
          },
          creaseStyle,
        ]}
      />
    </View>
  );
}
