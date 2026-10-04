/**
 * The pictures a user turn was sent with, under its capsule: thumbnails of
 * the very files the wire carried, so the person can see what the model was
 * given instead of a bubble that shows only the caption. Live-session only
 * (a reload empties attachment URIs, `historyMessages.ts`) and drawn only
 * where the host says pictures ride the wire — see `messageMapper.ts`.
 */
import { Image, View } from "react-native";

import { radius, space, spacing, type DesignColors } from "../../theme/design";
import type { TranscriptImage } from "./transcriptTypes";

/** The controller's own thumbnail box (`AiChatPage.tsx:4238+`). */
const THUMB_SIZE = 72;

export function UserImages({
  colors,
  images,
}: {
  colors: DesignColors;
  images: readonly TranscriptImage[];
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "flex-end",
        gap: space.xs,
        marginTop: spacing.xs,
      }}
      testID="transcript.userImages"
    >
      {images.map((image) => (
        <Image
          key={image.id}
          source={{ uri: image.uri }}
          resizeMode="cover"
          accessible
          accessibilityRole="image"
          accessibilityLabel={image.name}
          testID={`transcript.userImage.${image.id}`}
          style={{
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            borderRadius: radius.image,
            // A source that never loads still draws a framed box rather than
            // a hole in the band.
            backgroundColor: colors.surfaceMuted,
          }}
        />
      ))}
    </View>
  );
}
