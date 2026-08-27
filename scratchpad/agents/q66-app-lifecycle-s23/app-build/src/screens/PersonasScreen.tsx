/**
 * User-authored personas overlay. Builtins are templates (hide, don't delete).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  findPersona,
  getDefaultPersonasStorage,
  isBuiltinPersonaId,
  listAllPersonas,
  loadPersonasState,
  nextPersonaId,
  PERSONA_INSTRUCTIONS_CAP,
  removeUserPersona,
  sanitizePersonaInstructions,
  sanitizePersonaName,
  saveActivePersonaId,
  savePersonasState,
  setBuiltinHidden,
  upsertUserPersona,
  type BuiltinCopy,
  type BuiltinPersonaId,
  type Persona,
  type PersonasPersisted,
} from "../conversations/PersonasStore";
import { useLocale, type TranslateFn } from "../i18n";
import { GlassPanel2, Header } from "../theme/components";
import { radius, spacing } from "../theme/tokens";
import { fontFamilies, useTypography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";

type EditorState = {
  id: string;
  name: string;
  instructions: string;
  builtinSource?: boolean;
};

type Props = {
  onBack: () => void;
  onActiveChange?: (id: string) => void;
};

export function PersonasScreen({ onBack, onActiveChange }: Props) {
  const { colors } = useLabTheme<any>();
  const typography = useTypography();
  const { t } = useLocale();
  const mountedRef = useRef(true);
  const [state, setState] = useState<PersonasPersisted>({
    items: [],
    hiddenBuiltinIds: [],
  });
  const [activeId, setActiveId] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [notice, setNotice] = useState("");

  const builtins: BuiltinCopy = useMemo(
    () => ({
      "builtin-assistant": {
        name: t("personas.assistantName"),
        instructions: t("personas.assistantInstructions"),
      },
      "builtin-coder": {
        name: t("personas.coderName"),
        instructions: t("personas.coderInstructions"),
      },
      "builtin-translator": {
        name: t("personas.translatorName"),
        instructions: t("personas.translatorInstructions"),
      },
      "builtin-mentor": {
        name: t("personas.mentorName"),
        instructions: t("personas.mentorInstructions"),
      },
    }),
    [t],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const loaded = await loadPersonasState(getDefaultPersonasStorage());
      if (!mountedRef.current) return;
      setState(loaded.state);
      setActiveId(loaded.activeId);
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const persist = useCallback(async (next: PersonasPersisted) => {
    setState(next);
    try {
      await savePersonasState(getDefaultPersonasStorage(), next);
    } catch {
      if (mountedRef.current) setNotice(t("memory.saveError"));
    }
  }, [t]);

  const activate = useCallback(
    async (id: string) => {
      setActiveId(id);
      onActiveChange?.(id);
      try {
        await saveActivePersonaId(getDefaultPersonasStorage(), id);
      } catch {
        if (mountedRef.current) setNotice(t("memory.saveError"));
      }
    },
    [onActiveChange, t],
  );

  const handleBack = useCallback(() => {
    if (editor) {
      setEditor(null);
      return;
    }
    onBack();
  }, [editor, onBack]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [handleBack]);

  const all = useMemo(() => listAllPersonas(state, builtins), [builtins, state]);
  const hidden = useMemo(() => new Set(state.hiddenBuiltinIds), [state.hiddenBuiltinIds]);
  const templates = all.filter((p) => p.builtin);
  const yours = all.filter((p) => !p.builtin);

  const openCreate = useCallback(() => {
    setNotice("");
    setEditor({ id: nextPersonaId(), name: "", instructions: "" });
  }, []);

  const openEdit = useCallback((persona: Persona) => {
    setNotice("");
    if (persona.builtin) {
      setEditor({
        id: nextPersonaId(),
        name: persona.name,
        instructions: persona.instructions,
        builtinSource: true,
      });
      return;
    }
    setEditor({
      id: persona.id,
      name: persona.name,
      instructions: persona.instructions,
    });
  }, []);

  const saveEditor = useCallback(async () => {
    if (!editor) return;
    const name = sanitizePersonaName(editor.name);
    const instructions = sanitizePersonaInstructions(editor.instructions);
    if (!name || !instructions) {
      setNotice(t("personas.nameRequired"));
      return;
    }
    const next = upsertUserPersona(state, { id: editor.id, name, instructions });
    await persist(next);
    setEditor(null);
    await activate(editor.id);
  }, [activate, editor, persist, state, t]);

  const confirmDelete = useCallback(
    (persona: Persona) => {
      if (persona.builtin) return;
      Alert.alert(t("personas.delete"), t("personas.deleteConfirm"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("personas.delete"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              const next = removeUserPersona(state, persona.id);
              await persist(next);
              if (activeId === persona.id) {
                await activate("");
              }
            })();
          },
        },
      ]);
    },
    [activate, activeId, persist, state, t],
  );

  const toggleHidden = useCallback(
    (id: BuiltinPersonaId) => {
      const willHide = !hidden.has(id);
      const next = setBuiltinHidden(state, id, willHide);
      void persist(next);
      if (willHide && activeId === id) {
        void activate("");
      }
    },
    [activate, activeId, hidden, persist, state],
  );

  const renderRow = (persona: Persona) => {
    const isHidden = Boolean(persona.builtin && hidden.has(persona.id));
    const isActive = activeId === persona.id && !isHidden;
    return (
      <View
        key={persona.id}
        style={{
          paddingVertical: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
          opacity: isHidden ? 0.55 : 1,
          gap: spacing.xs,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={[
                typography.bodySm,
                {
                  color: colors.ink,
                  fontFamily: isActive ? fontFamilies.bodySemi : fontFamilies.bodyMedium,
                },
              ]}
              numberOfLines={1}
            >
              {persona.name}
              {isActive ? ` · ${t("personas.active")}` : ""}
              {isHidden ? ` · ${t("personas.hidden")}` : ""}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {!isHidden ? (
            <Pressable
              onPress={() => void activate(isActive ? "" : persona.id)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={isActive ? t("personas.clear") : t("personas.use")}
            >
              <Text style={[typography.bodyXs, { color: colors.accent }]}>
                {isActive ? t("personas.clear") : t("personas.use")}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => openEdit(persona)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={persona.builtin ? t("personas.duplicate") : t("personas.edit")}
          >
            <Text style={[typography.bodyXs, { color: colors.accent }]}>
              {persona.builtin ? t("personas.duplicate") : t("personas.edit")}
            </Text>
          </Pressable>
          {persona.builtin && isBuiltinPersonaId(persona.id) ? (
            <Pressable
              onPress={() => {
                if (isBuiltinPersonaId(persona.id)) toggleHidden(persona.id);
              }}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={isHidden ? t("personas.show") : t("personas.hide")}
            >
              <Text style={[typography.bodyXs, { color: colors.muted }]}>
                {isHidden ? t("personas.show") : t("personas.hide")}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => confirmDelete(persona)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t("personas.delete")}
            >
              <Text style={[typography.bodyXs, { color: colors.bad }]}>{t("personas.delete")}</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  if (editor) {
    const remaining = PERSONA_INSTRUCTIONS_CAP - editor.instructions.length;
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
          title={editor.builtinSource ? t("personas.create") : t("personas.edit")}
          onBack={handleBack}
          backAccessibilityLabel={t("common.back")}
        />
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          keyboardShouldPersistTaps="handled"
        >
          <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg, gap: spacing.sm }}>
            <Text style={[typography.bodyXs, { color: colors.muted }]}>{t("personas.name")}</Text>
            <TextInput
              value={editor.name}
              onChangeText={(name) => setEditor({ ...editor, name })}
              placeholder={t("personas.namePlaceholder")}
              placeholderTextColor={colors.muted}
              accessibilityLabel={t("personas.name")}
              style={[
                typography.bodyMd,
                {
                  color: colors.ink,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radius.sm,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 8,
                },
              ]}
            />
            <Text style={[typography.bodyXs, { color: colors.muted, marginTop: spacing.sm }]}>
              {t("personas.instructions")}
            </Text>
            <TextInput
              value={editor.instructions}
              onChangeText={(instructions) =>
                setEditor({
                  ...editor,
                  instructions: instructions.slice(0, PERSONA_INSTRUCTIONS_CAP),
                })
              }
              placeholder={t("personas.instructionsPlaceholder")}
              placeholderTextColor={colors.muted}
              multiline
              textAlignVertical="top"
              accessibilityLabel={t("personas.instructions")}
              style={[
                typography.bodyMd,
                {
                  color: colors.ink,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radius.sm,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 8,
                  minHeight: 180,
                },
              ]}
            />
            <Text style={[typography.bodyXs, { color: colors.muted }]}>
              {t("personas.capHint", { max: PERSONA_INSTRUCTIONS_CAP })}
              {remaining < 200 ? ` (${remaining})` : ""}
            </Text>
            {notice ? (
              <Text style={[typography.bodyXs, { color: colors.bad }]}>{notice}</Text>
            ) : null}
            <Pressable
              onPress={() => void saveEditor()}
              accessibilityRole="button"
              accessibilityLabel={t("common.save")}
              style={({ pressed }) => ({
                marginTop: spacing.sm,
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
          </GlassPanel2>
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
        title={t("personas.title")}
        subtitle={t("personas.subtitle")}
        onBack={handleBack}
        backAccessibilityLabel={t("common.back")}
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={openCreate}
          accessibilityRole="button"
          accessibilityLabel={t("personas.create")}
          style={({ pressed }) => ({
            backgroundColor: colors.accentSoft,
            borderRadius: radius.sm,
            paddingVertical: 12,
            alignItems: "center",
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={[typography.bodySm, { color: colors.accent }]}>{t("personas.create")}</Text>
        </Pressable>

        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg }}>
          <Text
            style={[
              typography.bodyXs,
              { color: colors.muted, fontFamily: fontFamilies.bodySemi, marginBottom: spacing.xs },
            ]}
          >
            {t("personas.templates")}
          </Text>
          {templates.map(renderRow)}
        </GlassPanel2>

        <GlassPanel2 opaque rounded="lg" style={{ padding: spacing.lg }}>
          <Text
            style={[
              typography.bodyXs,
              { color: colors.muted, fontFamily: fontFamilies.bodySemi, marginBottom: spacing.xs },
            ]}
          >
            {t("personas.yours")}
          </Text>
          {yours.length === 0 ? (
            <Text style={[typography.bodyXs, { color: colors.muted }]}>{t("personas.empty")}</Text>
          ) : (
            yours.map(renderRow)
          )}
        </GlassPanel2>
      </ScrollView>
    </View>
  );
}

/** Resolve builtin copy for the active persona outside this screen. */
export function builtinCopyFromT(t: TranslateFn): BuiltinCopy {
  return {
    "builtin-assistant": {
      name: t("personas.assistantName"),
      instructions: t("personas.assistantInstructions"),
    },
    "builtin-coder": {
      name: t("personas.coderName"),
      instructions: t("personas.coderInstructions"),
    },
    "builtin-translator": {
      name: t("personas.translatorName"),
      instructions: t("personas.translatorInstructions"),
    },
    "builtin-mentor": {
      name: t("personas.mentorName"),
      instructions: t("personas.mentorInstructions"),
    },
  };
}

export function activePersonaInstructions(
  state: PersonasPersisted,
  activeId: string,
  t: TranslateFn,
): string {
  const persona = findPersona(state, activeId, builtinCopyFromT(t));
  return persona?.instructions ?? "";
}
