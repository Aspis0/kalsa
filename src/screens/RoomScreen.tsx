/**
 * The Room, over everything else: one paired computer's room — who is in it,
 * the transcript, what is still on its way out, and the composer that posts
 * (with the quiet way to ask Kalsa). This screen is the shell only: the
 * room's state and actions come from `useRoom`, the pieces from `room/`, and
 * every sentence from the catalogue.
 */
import { useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ArrowUp } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocale } from "../i18n";
import { useRoom } from "../room/useRoom";
import { families, modes, radius, space, type DesignColors, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { SettingsHeader } from "./SettingsHeader";
import { RoomPeople } from "./room/RoomPeople";
import { RoomTranscript } from "./room/RoomTranscript";
import { noteLine } from "./room/roomNotes";

export function RoomScreen({ localId, onBack }: { localId: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const colors = modes[mode];
  const { t } = useLocale();
  const room = useRoom(localId);
  const [draft, setDraft] = useState("");
  const [ask, setAsk] = useState(false);

  const { feed, rows, pending } = room;
  const info = feed.info;
  const aiName = info?.members.find((member) => member.kind === "ai")?.name || "Kalsa";
  const youPending = info?.ai.youPending ?? false;

  const post = async (): Promise<void> => {
    const sent = await room.send(draft, ask);
    if (!sent) return;
    setDraft("");
    setAsk(false);
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
      <Page colors={colors} title={t("room.title")} backLabel={t("common.back")} onBack={onBack}>
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
      </Page>
    );
  }

  const notice = noteLine(t, feed.noteCode);
  const sendError = noteLine(t, room.sendErrorCode);

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
        <Text
          testID="room.reconnecting"
          style={{
            color: colors.ink3,
            fontFamily: families.sans,
            fontSize: 12.5,
            paddingHorizontal: space.md,
            paddingBottom: space.xxs,
          }}
        >
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
        onRetry={(clientMsgId) => void room.retry(clientMsgId)}
        onDiscard={(clientMsgId) => void room.discard(clientMsgId)}
      />
      {notice ? (
        <Text
          testID="room.note"
          style={{ color: colors.ink3, fontFamily: families.sans, fontSize: 12.5, paddingHorizontal: space.md }}
        >
          {notice}
        </Text>
      ) : null}
      {sendError ? (
        <Text
          testID="room.sendError"
          accessibilityRole="alert"
          style={{ color: colors.danger, fontFamily: families.sans, fontSize: 12.5, paddingHorizontal: space.md }}
        >
          {sendError}
        </Text>
      ) : null}
      <View style={{ padding: space.md, paddingBottom: insets.bottom + space.sm }}>
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
