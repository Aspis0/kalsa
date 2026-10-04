/**
 * The room's transcript: what the room holds, what the reader's own phone
 * has not delivered yet, and the answer still being written — one list, in
 * seq order, with each writer named. A message on its way out carries the
 * two things the reader can tell it (retry, discard); a live turn carries
 * no clock, because the room holds no moment for it yet.
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
  onRetry,
  onDiscard,
}: Props) {
  const { t } = useLocale();
  const list = useRef<FlatList<RoomRow> | null>(null);
  if (rows.length === 0 && pending.length === 0 && live === null) {
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
      // The newest words stay in sight: a row arriving or growing scrolls
      // the list to its end, which is where a chat's reader already is.
      onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
      renderItem={({ item }) => (
        <MessageRow colors={colors} row={item} kalsaName={kalsaName} />
      )}
      ListFooterComponent={
        <>
          {live !== null ? (
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
                  {live}
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
