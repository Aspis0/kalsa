/**
 * The Room, over everything else: one paired computer's room — who is in it,
 * the transcript, what is still on its way out, and the composer that posts
 * (with the quiet way to ask Kalsa). This screen is the shell only: the
 * room's state and actions come from `useRoom`, the pieces from `room/`, and
 * every sentence from the catalogue.
 */
import { useRef, useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ArrowUp } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocale } from "../i18n";
import { useRoom } from "../room/useRoom";
import { families, modes, radius, space, type DesignColors, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { bottomInsetFor } from "../ui/shell/shellGeometry";
import { useKeyboardHeight } from "../ui/shell/useKeyboardHeight";
import { SettingsHeader } from "./SettingsHeader";
import { RoomPeople } from "./room/RoomPeople";
import { RoomTranscript } from "./room/RoomTranscript";
import { noteLine, queueLine } from "./room/roomNotes";

export function RoomScreen({ localId, onBack }: { localId: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  // The shell's own keyboard mechanism: the settled height this app already
  // pays for means the composer stands ON the keyboard, not under it.
  const bandInsets = bottomInsetFor(insets, useKeyboardHeight());
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const colors = modes[mode];
  const { t, locale } = useLocale();
  const room = useRoom(localId);
  const [draft, setDraft] = useState("");
  const [ask, setAsk] = useState(false);
  const posting = useRef(false);

  const { feed, rows, pending } = room;
  const info = feed.info;
  const aiName = info?.members.find((member) => member.kind === "ai")?.name || "Kalsa";
  const youPending = info?.ai.youPending ?? false;

  // A tap empties the composer BEFORE the post: the words are on the way,
  // and a second tap has nothing left to send. Refused, they come back.
  const post = async (): Promise<void> => {
    if (posting.current) return;
    posting.current = true;
    const text = draft;
    setDraft("");
    try {
      const sent = await room.send(text, ask);
      if (sent) setAsk(false);
      else setDraft(text);
    } finally {
      posting.current = false;
    }
  };

  if (feed.status === "loading") {
    return (
      <Page colors={colors} title={t("room.title")} backLabel={t("common.back")} onBack={onBack}>
        <Quiet text={t("room.loading")} colors={colors} />
      </Page>
    );
  }
  if (feed.status === "removed") {
    return (
      <Page colors={colors} title={info?.roomName || t("room.title")} backLabel={t("common.back")} onBack={onBack}>
        <Quiet text={t("room.removed")} colors={colors} testID="room.removed" />
        {/* The reader's own unsent words are still theirs: the room will
            never take them, so discard is the only thing left to offer. */}
        {pending.length > 0 ? (
          <RoomTranscript
            colors={colors}
            rows={[]}
            pending={pending}
            live={null}
            kalsaName={aiName}
            onDiscard={(clientMsgId) => void room.discard(clientMsgId)}
          />
        ) : null}
      </Page>
    );
  }
  if (feed.status === "error") {
    return (
      <Page
        colors={colors}
        title={info?.roomName || t("room.title")}
        backLabel={t("common.back")}
        onBack={onBack}
      >
        <Quiet
          text={noteLine(t, feed.error?.code, feed.error?.message) ?? t("room.noteFallback")}
          colors={colors}
          testID="room.error"
        />
        <Pressable
          testID="room.reload"
          accessibilityRole="button"
          accessibilityLabel={t("room.retry")}
          onPress={room.reload}
          style={{ alignSelf: "flex-start", marginTop: space.sm }}
        >
          <Text style={{ color: colors.brand, fontFamily: families.sansSemi, fontSize: 14 }}>
            {t("room.retry")}
          </Text>
        </Pressable>
        {/* The read failed; the shelf is the reader's own and may still
            post — the stream does not need info to carry a message. */}
        {pending.length > 0 ? (
          <RoomTranscript
            colors={colors}
            rows={[]}
            pending={pending}
            live={null}
            kalsaName={aiName}
            onRetry={(clientMsgId) => void room.retry(clientMsgId)}
            onDiscard={(clientMsgId) => void room.discard(clientMsgId)}
          />
        ) : null}
      </Page>
    );
  }

  const quiet = {
    color: colors.ink3,
    fontFamily: families.sans,
    fontSize: 12.5,
    paddingHorizontal: space.md,
  } as const;
  const notice = noteLine(t, feed.noteCode);
  const queue = queueLine(t, locale, info?.ai.queue ?? []);
  const callRefusal = noteLine(t, feed.callRefusalCode);
  // The reader's own action that did not go through: a compose the shelf
  // refused, or a page of older words that would not load.
  const trouble = noteLine(t, room.sendErrorCode) ?? noteLine(t, room.pageErrorCode);

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <SettingsHeader
        title={info?.roomName || t("room.title")}
        onBack={onBack}
        backLabel={t("common.back")}
      />
      <RoomPeople
        colors={colors}
        members={info?.members ?? []}
        you={info?.you ?? -1}
        nameErrorCode={room.nameErrorCode}
        onSetName={(name) => void room.setName(name)}
      />
      {feed.reconnecting ? (
        <Text testID="room.reconnecting" style={{ ...quiet, paddingBottom: space.xxs }}>
          {feed.error?.code === "door_unusable"
            ? noteLine(t, feed.error.code, feed.error.message)
            : t("room.reconnecting")}
        </Text>
      ) : null}
      <RoomTranscript
        colors={colors}
        rows={rows}
        pending={pending}
        live={feed.live}
        kalsaName={aiName}
        kalsaRunning={info?.ai.running != null}
        hasOlder={feed.hasOlder}
        loadingOlder={room.loadingOlder}
        onLoadOlder={() => void room.loadOlder()}
        onRetry={(clientMsgId) => void room.retry(clientMsgId)}
        onDiscard={(clientMsgId) => void room.discard(clientMsgId)}
      />
      {queue ? (
        <Text testID="room.queue" style={quiet}>
          {queue}
        </Text>
      ) : null}
      {notice ? (
        <Text testID="room.note" style={quiet}>
          {notice}
        </Text>
      ) : null}
      {callRefusal ? (
        <Text testID="room.callRefusal" style={quiet}>
          {callRefusal}
        </Text>
      ) : null}
      {trouble ? (
        <Text testID="room.trouble" accessibilityRole="alert" style={{ ...quiet, color: colors.danger }}>
          {trouble}
        </Text>
      ) : null}
      <View style={{ padding: space.md, paddingBottom: bandInsets.bottom + space.sm }}>
        <Pressable
          testID="room.ask"
          accessibilityRole="button"
          accessibilityLabel={t("room.askKalsa")}
          accessibilityState={{ selected: ask, disabled: youPending }}
          disabled={youPending}
          onPress={() => setAsk((current) => !current)}
          style={{
            alignSelf: "flex-start",
            marginBottom: space.xs,
            paddingHorizontal: space.sm,
            paddingVertical: space.xxs,
            borderRadius: radius.chip,
            backgroundColor: ask ? colors.brand : colors.tint,
            opacity: youPending ? 0.45 : 1,
          }}
        >
          <Text
            style={{
              color: ask ? colors.onBrand : colors.brand,
              fontFamily: families.sansSemi,
              fontSize: 12.5,
            }}
          >
            {t("room.askKalsa")}
          </Text>
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
          <TextInput
            testID="room.composer"
            accessibilityLabel={t("room.writeAria")}
            value={draft}
            onChangeText={setDraft}
            multiline
            placeholder={t("room.writePlaceholder")}
            placeholderTextColor={colors.ink3}
            style={{
              flex: 1,
              minHeight: 44,
              maxHeight: 120,
              color: colors.ink,
              fontFamily: families.sans,
              fontSize: 15,
              lineHeight: 21,
              backgroundColor: colors.surface,
              borderColor: colors.line,
              borderWidth: 1,
              borderRadius: radius.composer,
              paddingHorizontal: space.md,
              paddingVertical: space.xs,
            }}
          />
          <Pressable
            testID="room.send"
            accessibilityRole="button"
            accessibilityLabel={t("common.send")}
            accessibilityState={{ disabled: draft.trim() === "" }}
            disabled={draft.trim() === ""}
            onPress={() => void post()}
            style={({ pressed }) => ({
              marginLeft: space.xs,
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: draft.trim() === "" ? colors.tint : colors.brand,
              opacity: pressed ? 0.78 : 1,
            })}
          >
            <ArrowUp
              size={18}
              color={draft.trim() === "" ? colors.ink3 : colors.onBrand}
              strokeWidth={2.5}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** The room's own frame before there is a room to show: header, one line. */
function Page({
  colors,
  title,
  backLabel,
  onBack,
  children,
}: {
  colors: DesignColors;
  title: string;
  backLabel: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <SettingsHeader title={title} onBack={onBack} backLabel={backLabel} />
      <View style={{ flex: 1, padding: space.md }}>{children}</View>
    </View>
  );
}

function Quiet({ text, colors, testID }: { text: string; colors: DesignColors; testID?: string }) {
  return (
    <Text
      testID={testID}
      style={{ color: colors.ink3, fontFamily: families.sans, fontSize: 14, lineHeight: 20 }}
    >
      {text}
    </Text>
  );
}
