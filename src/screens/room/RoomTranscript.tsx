/**
 * The room's transcript: what the room holds, what the reader's own phone
 * has not delivered yet, and the answer still being written — one list, in
 * seq order, with each writer named. A message on its way out carries the
 * two things the reader can tell it (retry, discard); a live turn carries
 * no clock, because the room holds no moment for it yet. Older words are
 * one tap away until the room has none: the window is what the reader
 * asked for, never the whole transcript.
 */
import { useRef } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useLocale } from "../../i18n";
import { families, radius, space, type DesignColors } from "../../theme/design";
import type { RoomQueueRow, RoomRow } from "../../room/roomFeed";
import { noteLine } from "./roomNotes";

type Props = {
  colors: DesignColors;
  rows: RoomRow[];
  pending: RoomQueueRow[];
  live: string | null;
  /** The AI member's own name; the room calls it Kalsa. */
  kalsaName: string;
  /** The room's turn is running: Kalsa is named before its first word.
   *  (The desktop's live row, whose dots are its own copy.) Absent where
   *  there is no live room to name — a removed one, or a failed read. */
  kalsaRunning?: boolean;
  /** The room holds entries older than this window; `onLoadOlder` asks for
   *  that page, and `loadingOlder` says it is on its way. */
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  /** Offered only where a retry could still post: never for a room this
   *  phone was removed from. */
  onRetry?: (clientMsgId: string) => void;
  onDiscard: (clientMsgId: string) => void;
};

function clock(seconds: number): string {
  const at = new Date(seconds * 1000);
  const hours = `${at.getHours()}`.padStart(2, "0");
  const minutes = `${at.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function RoomTranscript({
  colors,
  rows,
  pending,
  live,
  kalsaName,
  kalsaRunning = false,
  hasOlder = false,
  loadingOlder = false,
  onLoadOlder,
  onRetry,
  onDiscard,
}: Props) {
  const { t } = useLocale();
  const list = useRef<FlatList<RoomRow> | null>(null);
  // Scrolling to the end follows the newest words — but a page loaded ABOVE
  // the reader's place moves the floor down, and jumping to the bottom after
  // "load earlier" would undo the tap.
  const floor = rows[0]?.seq ?? null;
  const seenFloor = useRef<number | null>(null);
  if (rows.length === 0 && pending.length === 0 && live === null && !kalsaRunning) {
    return (
      <View style={{ flex: 1, padding: space.lg }}>
        <Text style={{ color: colors.ink3, fontFamily: families.sans, fontSize: 14 }}>
          {t("room.empty")}
        </Text>
      </View>
    );
  }
  return (
    <FlatList
      ref={list}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: space.sm }}
      data={rows}
      keyExtractor={(row) => `seq:${row.seq}`}
      onContentSizeChange={() => {
        const prepended = seenFloor.current !== null && floor !== null && floor < seenFloor.current;
        seenFloor.current = floor;
        if (!prepended) list.current?.scrollToEnd({ animated: false });
      }}
      renderItem={({ item }) => (
        <MessageRow colors={colors} row={item} kalsaName={kalsaName} />
      )}
      ListHeaderComponent={
        hasOlder && onLoadOlder ? (
          <Pressable
            testID="room.loadOlder"
            accessibilityRole="button"
            accessibilityLabel={t("room.loadEarlier")}
            disabled={loadingOlder}
            onPress={onLoadOlder}
            style={({ pressed }) => ({
              alignSelf: "center",
              marginTop: space.xs,
              paddingHorizontal: space.sm,
              paddingVertical: space.xxs,
              borderRadius: radius.chip,
              backgroundColor: pressed ? colors.tint : "transparent",
              opacity: loadingOlder ? 0.45 : 1,
            })}
          >
            <Text style={{ color: colors.brand, fontFamily: families.sansSemi, fontSize: 12.5 }}>
              {loadingOlder ? t("room.loadingEarlier") : t("room.loadEarlier")}
            </Text>
          </Pressable>
        ) : null
      }
      ListFooterComponent={
        <>
          {live !== null || kalsaRunning ? (
            <View style={{ marginTop: space.xs, maxWidth: "85%" }}>
              <Text style={{ color: colors.brand, fontFamily: families.sansSemi, fontSize: 12.5 }}>
                {kalsaName}
              </Text>
              <View
                style={{
                  backgroundColor: colors.tint,
                  borderColor: colors.brand,
                  borderLeftWidth: 2,
                  borderRadius: radius.row,
                  paddingHorizontal: space.sm,
                  paddingVertical: space.xs,
                }}
              >
                <Text style={{ color: colors.ink, fontFamily: families.sans, fontSize: 15, lineHeight: 21 }}>
                  {live ?? t("chat.thinking")}
                </Text>
              </View>
            </View>
          ) : null}
          {pending.map((item) => (
            <PendingRow
              key={item.clientMsgId}
              colors={colors}
              item={item}
              onRetry={onRetry}
              onDiscard={onDiscard}
            />
          ))}
        </>
      }
    />
  );
}

/** One message the room holds. */
function MessageRow({
  colors,
  row,
  kalsaName,
}: {
  colors: DesignColors;
  row: RoomRow;
  kalsaName: string;
}) {
  const { t } = useLocale();
  const name = row.name === "" ? t("room.defaultHostName") : row.name;
  return (
    <View
      testID={`room.row.${row.seq}`}
      style={{
        marginTop: space.xs,
        maxWidth: "85%",
        alignSelf: row.own ? "flex-end" : "flex-start",
        alignItems: row.own ? "flex-end" : "flex-start",
      }}
    >
      <Text
        style={{
          color: row.kalsa ? colors.brand : colors.ink3,
          fontFamily: families.sansSemi,
          fontSize: 12.5,
        }}
        numberOfLines={1}
      >
        {row.kalsa ? kalsaName : name}
        {row.former ? <Text style={{ color: colors.ink3 }}>{t("room.left")}</Text> : null}
      </Text>
      <View
        style={{
          backgroundColor: row.own ? colors.bubbleUser : colors.surfaceMuted,
          borderColor: row.kalsa ? colors.brand : colors.line,
          borderLeftWidth: row.kalsa ? 2 : 0,
          borderRadius: radius.row,
          paddingHorizontal: space.sm,
          paddingVertical: space.xs,
        }}
      >
        <Text style={{ color: colors.ink, fontFamily: families.sans, fontSize: 15, lineHeight: 21 }}>
          {row.callAi && !row.kalsa ? (
            <Text style={{ color: colors.ink3 }}>{t("room.askedKalsa")} </Text>
          ) : null}
          {row.text}
        </Text>
        <Text style={{ color: colors.ink3, fontFamily: families.mono, fontSize: 11, marginTop: 2 }}>
          {clock(row.time)}
        </Text>
      </View>
    </View>
  );
}

/** One message still on its way out. */
function PendingRow({
  colors,
  item,
  onRetry,
  onDiscard,
}: {
  colors: DesignColors;
  item: RoomQueueRow;
  onRetry?: (clientMsgId: string) => void;
  onDiscard: (clientMsgId: string) => void;
}) {
  const { t } = useLocale();
  const state =
    item.state === "failed"
      ? t("room.failed")
      : item.state === "sending"
        ? t("room.sending")
        : t("room.queued");
  const reason = noteLine(t, item.errorCode);
  return (
    <View
      testID={`room.pending.${item.clientMsgId}`}
      style={{ marginTop: space.xs, maxWidth: "85%", alignSelf: "flex-end", alignItems: "flex-end" }}
    >
      <Text style={{ color: colors.ink3, fontFamily: families.sansSemi, fontSize: 12.5 }}>
        {state}
      </Text>
      <View
        style={{
          backgroundColor: colors.surfaceMuted,
          borderColor: colors.line2,
          borderStyle: "dashed",
          borderWidth: 1,
          borderRadius: radius.row,
          paddingHorizontal: space.sm,
          paddingVertical: space.xs,
        }}
      >
        <Text style={{ color: colors.ink, fontFamily: families.sans, fontSize: 15, lineHeight: 21 }}>
          {item.callAi ? (
            <Text style={{ color: colors.ink3 }}>{t("room.askedKalsa")} </Text>
          ) : null}
          {item.text}
        </Text>
      </View>
      {reason ? (
        <Text style={{ color: colors.ink3, fontFamily: families.sans, fontSize: 12.5 }}>
          {reason}
        </Text>
      ) : null}
      {/* A message in flight is nobody's to decide on: it is already out. */}
      {item.state === "sending" ? null : (
        <View style={{ flexDirection: "row", gap: space.xs }}>
          {onRetry ? (
            <PendingAction
              colors={colors}
              label={t("room.retry")}
              testID={`room.pending.retry.${item.clientMsgId}`}
              onPress={() => onRetry(item.clientMsgId)}
            />
          ) : null}
          <PendingAction
            colors={colors}
            label={t("room.discard")}
            testID={`room.pending.discard.${item.clientMsgId}`}
            onPress={() => onDiscard(item.clientMsgId)}
          />
        </View>
      )}
    </View>
  );
}

function PendingAction({
  colors,
  label,
  testID,
  onPress,
}: {
  colors: DesignColors;
  label: string;
  testID: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: space.xxs,
        paddingHorizontal: space.xs,
        borderRadius: radius.chip,
        backgroundColor: pressed ? colors.tint : "transparent",
      })}
    >
      <Text style={{ color: colors.brand, fontFamily: families.sansSemi, fontSize: 12.5 }}>
        {label}
      </Text>
    </Pressable>
  );
}
