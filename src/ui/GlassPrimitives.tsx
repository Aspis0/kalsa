import React from "react";
import { Text, TextInput, View } from "react-native";

import { useLabTheme } from "./labTheme";

export function Section({ children, title }: { children: React.ReactNode; title: string }) {
  const { styles } = useLabTheme();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function GlassPanel({ children, style }: { children: React.ReactNode; style?: object }) {
  const { styles } = useLabTheme();
  return (
    <View style={[styles.glassPanel, style]}>
      <View pointerEvents="none" style={styles.glassClip}>
        <View style={styles.glassTint} />
        <View style={styles.glassSurfaceSheen} />
        <View style={styles.glassSideSheen} />
        <View style={styles.glassInnerShadow} />
        <View style={styles.glassHairline} />
        <View style={styles.glassDepthEdge} />
      </View>
      {children}
    </View>
  );
}

export function GlassInput(props: React.ComponentProps<typeof TextInput>) {
  const { colors, styles } = useLabTheme();
  const { style, ...rest } = props;
  return (
    <View style={[styles.inputShell, style]}>
      <View pointerEvents="none" style={styles.inputClip}>
        <View style={styles.inputTint} />
        <View style={styles.inputHairline} />
      </View>
      <TextInput
        {...rest}
        cursorColor={colors.accent}
        placeholderTextColor={colors.quiet}
        scrollEnabled={props.multiline ? false : props.scrollEnabled}
        selectionColor={colors.accent}
        style={[styles.input, style]}
        underlineColorAndroid="transparent"
      />
    </View>
  );
}
