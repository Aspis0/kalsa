import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { Search, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  deleteNote,
  filterNotes,
  loadNotesIndex,
  readNote,
  saveNote,
  type Note,
  type NoteMeta,
} from "../notes/NotesStore";
import { useLocale } from "../i18n";
import { e1, modes, radius, space, type, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { SettingsHeader } from "./SettingsHeader";
import { NoteEditorSheet } from "./NoteEditorSheet";

type Props = {
  onBack: () => void;
  focusId?: string | null;
};
type ThemeContext = { mode: ThemeMode };

/** Local markdown notes overlay — list, search, edit sheet, delete and export. */
export function NotesScreen({ onBack, focusId }: Props) {
  const insets = useSafeAreaInsets();
  const { mode } = useLabTheme<ThemeContext>();
  const colors = modes[mode];
  const { t } = useLocale();
  const mountedRef = useRef(true);
  const [items, setItems] = useState<NoteMeta[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Note | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const next = await loadNotesIndex();
      if (mountedRef.current) setItems(next);
    } catch {
      if (mountedRef.current) setItems([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!focusId) return;
    let cancelled = false;
    void (async () => {
      const note = await readNote(focusId);
      if (cancelled || !mountedRef.current || !note) return;
      setEditing(note);
      setDraft(note.body);
    })();
    return () => {
      cancelled = true;
    };
  }, [focusId]);

  const closeEditor = useCallback(() => {
    setEditing(null);
    setDraft("");
    setNotice("");
  }, []);
  const handleBack = useCallback(() => {
    if (editing) closeEditor();
    else onBack();
  }, [closeEditor, editing, onBack]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [handleBack]);

  const visible = useMemo(() => filterNotes(items, query), [items, query]);
  const openNew = useCallback(() => {
    setEditing({ id: "", title: "", updatedAt: Date.now(), body: "" });
    setDraft("");
    setNotice("");
  }, []);
  const openNote = useCallback(async (id: string) => {
    const note = await readNote(id);
    if (!mountedRef.current) return;
    if (!note) {
      setNotice(t("notes.errorLoad"));
      return;
    }
    setEditing(note);
    setDraft(note.body);
    setNotice("");
  }, [t]);
  const persistDraft = useCallback(async () => {
    if (!editing) return;
    try {
      const saved = await saveNote(draft, editing.id || undefined);
      if (!mountedRef.current) return;
      setEditing(saved);
      setNotice("");
      await reload();
    } catch {
      if (mountedRef.current) setNotice(t("notes.errorSave"));
    }
  }, [draft, editing, reload, t]);
  const confirmDelete = useCallback((id: string) => {
    Alert.alert(t("notes.delete"), t("notes.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("notes.delete"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await deleteNote(id);
              if (!mountedRef.current) return;
              closeEditor();
              await reload();
            } catch {
              if (mountedRef.current) setNotice(t("notes.errorSave"));
            }
          })();
        },
      },
    ]);
  }, [closeEditor, reload, t]);
  const exportNote = useCallback(() => {
    if (!draft.trim()) return;
    void Share.share({
      message: draft,
      title: editing?.title || t("notes.title"),
    }).catch(() => undefined);
  }, [draft, editing, t]);

  const cardStyle = {
    flexShrink: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    ...e1,
  } as const;

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: colors.page,
        zIndex: 50,
      }}
    >
      <SettingsHeader title={t("notes.title")} onBack={handleBack} backLabel={t("common.back")} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: space.md,
          paddingTop: space.xs,
          paddingBottom: insets.bottom + space.lg,
          gap: space.md,
          flexGrow: 1,
        }}
      >
        <Pressable
          testID="notes.new"
          onPress={openNew}
          accessibilityRole="button"
          accessibilityLabel={t("notes.new")}
          style={({ pressed }) => ({
            minHeight: 52,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.button,
            backgroundColor: pressed ? colors.brandDeep : colors.brand,
          })}
        >
          <Text style={[type.bodyStrong, { color: colors.onBrand }]}>{t("notes.new")}</Text>
        </Pressable>

        <View
          style={{
            minHeight: 52,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.md,
            borderRadius: radius.field,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.surface,
          }}
        >
          <Search size={20} color={colors.ink3} strokeWidth={1.75} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("notes.search")}
            placeholderTextColor={colors.ink3}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel={t("notes.search")}
            style={[type.body, { flex: 1, minWidth: 0, color: colors.ink, paddingVertical: space.xs }]}
          />
          {query ? (
            <Pressable
              onPress={() => setQuery("")}
              accessibilityRole="button"
              accessibilityLabel={t("common.clear")}
              style={{ width: 40, height: 48, alignItems: "center", justifyContent: "center" }}
            >
              <X size={18} color={colors.ink3} />
            </Pressable>
          ) : null}
        </View>

        {visible.length === 0 ? (
          <View style={[cardStyle, { padding: space.md, gap: space.xs }]}>
            <Text style={[type.headline, { color: colors.ink }]}>{t("notes.empty")}</Text>
            <Text style={[type.body, { color: colors.ink2 }]}>{t("notes.emptyBody")}</Text>
          </View>
        ) : (
          <View style={[cardStyle, { overflow: "hidden" }]}>
            {visible.map((item, index) => (
              <View key={item.id}>
                {index > 0 ? (
                  <View style={{ height: 1, backgroundColor: colors.line, marginLeft: space.md }} />
                ) : null}
                <Pressable
                  onPress={() => void openNote(item.id)}
                  onLongPress={() => confirmDelete(item.id)}
                  delayLongPress={380}
                  accessibilityRole="button"
                  accessibilityLabel={item.title.trim() ? item.title : t("notes.untitled")}
                  style={({ pressed }) => ({
                    minHeight: 56,
                    justifyContent: "center",
                    paddingHorizontal: space.md,
                    backgroundColor: pressed ? colors.tint : colors.surface,
                  })}
                >
                  <Text numberOfLines={1} style={[type.bodyStrong, { color: colors.ink }]}>
                    {item.title.trim() ? item.title : t("notes.untitled")}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      {editing ? (
        <NoteEditorSheet
          title={editing.id ? t("notes.edit") : t("notes.new")}
          draft={draft}
          notice={notice}
          hasSavedNote={Boolean(editing.id)}
          colors={colors}
          t={t}
          onDraftChange={setDraft}
          onSave={() => void persistDraft()}
          onExport={exportNote}
          onDelete={() => confirmDelete(editing.id)}
          onClose={handleBack}
        />
      ) : null}
    </View>
  );
}
