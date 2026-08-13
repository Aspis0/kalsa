/**
 * Local markdown notes overlay — list, search, edit, delete, export.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { GlassPanel2, Header } from "../theme/components";
import { radius, spacing } from "../theme/tokens";
import { fontFamilies, useTypography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";

type Props = {
  onBack: () => void;
  /** When set, open this note after the index loads (e.g. just saved). */
  focusId?: string | null;
};

export function NotesScreen({ onBack, focusId }: Props) {
  const { colors } = useLabTheme<any>();
  const typography = useTypography();
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

  const handleBack = useCallback(() => {
    if (editing) {
      setEditing(null);
      setDraft("");
      setNotice("");
      return;
    }
    onBack();
  }, [editing, onBack]);

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

  const confirmDelete = useCallback(
    (id: string) => {
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
                setEditing(null);
                setDraft("");
                await reload();
              } catch {
                if (mountedRef.current) setNotice(t("notes.errorSave"));
              }
            })();
          },
        },
      ]);
    },
    [reload, t],
  );

  const exportNote = useCallback(() => {
    const body = editing ? draft : "";
    if (!body.trim()) return;
    void Share.share({
      message: body,
      title: editing?.title || t("notes.title"),
    }).catch(() => undefined);
  }, [draft, editing, t]);

  if (editing) {
    return (
      <View
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundColor: colors.shell,
          zIndex: 50,
        }}
      >
        <Header
          title={editing.id ? t("notes.edit") : t("notes.new")}
          onBack={handleBack}
          backAccessibilityLabel={t("common.back")}
          trailing={
            <View style={{ flexDirection: "row", gap: spacing.sm, paddingRight: spacing.sm }}>
              {editing.id ? (
                <Pressable
                  onPress={() => confirmDelete(editing.id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t("notes.delete")}
                >
                  <Text style={[typography.bodyXs, { color: colors.bad }]}>{t("notes.delete")}</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={exportNote}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("notes.export")}
              >
                <Text style={[typography.bodyXs, { color: colors.accent }]}>{t("notes.export")}</Text>
              </Pressable>
            </View>
          }
        />
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t("notes.bodyPlaceholder")}
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
            accessibilityLabel={t("notes.edit")}
            style={[
              typography.bodyMd,
              {
                color: colors.ink,
                minHeight: 280,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.sm,
                padding: spacing.md,
              },
            ]}
          />
          {notice ? (
            <Text style={[typography.bodyXs, { color: colors.bad }]}>{notice}</Text>
          ) : null}
          <Pressable
            onPress={() => void persistDraft()}
            accessibilityRole="button"
            accessibilityLabel={t("common.save")}
            style={({ pressed }) => ({
              backgroundColor: colors.accent,
              borderRadius: radius.sm,
              paddingVertical: 10,
              alignItems: "center",
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={[typography.bodySm, { color: colors.primaryText ?? "#F4EFE4" }]}>
              {t("common.save")}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: colors.shell,
        zIndex: 50,
      }}
    >
      <Header
        title={t("notes.title")}
        onBack={handleBack}
        backAccessibilityLabel={t("common.back")}
        trailing={
          <Pressable
            onPress={openNew}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("notes.new")}
            style={{ paddingRight: spacing.md }}
          >
            <Text style={[typography.bodySm, { color: colors.accent }]}>{t("notes.new")}</Text>
          </Pressable>
        }
      />
      <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("notes.search")}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel={t("notes.search")}
          style={[
            typography.bodySm,
            {
              color: colors.ink,
              backgroundColor: colors.panel,
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: colors.line,
              paddingHorizontal: spacing.sm,
              paddingVertical: 8,
            },
          ]}
        />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm }}
        keyboardShouldPersistTaps="handled"
      >
        {visible.length === 0 ? (
          <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.xs }}>
            <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
              {t("notes.empty")}
            </Text>
            <Text style={[typography.bodyXs, { color: colors.muted }]}>{t("notes.emptyBody")}</Text>
          </GlassPanel2>
        ) : (
          visible.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => void openNote(item.id)}
              onLongPress={() => confirmDelete(item.id)}
              delayLongPress={380}
              accessibilityRole="button"
              accessibilityLabel={item.title.trim() ? item.title : t("notes.untitled")}
              style={({ pressed }) => ({
                backgroundColor: pressed ? colors.panel : colors.panelSolid ?? colors.panel,
                borderRadius: radius.sm,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderWidth: 1,
                borderColor: colors.line,
              })}
            >
              <Text
                numberOfLines={1}
                style={[typography.bodyMd, { color: colors.ink, fontFamily: fontFamilies.bodyMedium }]}
              >
                {item.title.trim() ? item.title : t("notes.untitled")}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}
