/** User-authored personas overlay. Builtins are templates (hide, don't delete). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  findPersona,
  getDefaultPersonasStorage,
  isBuiltinPersonaId,
  listAllPersonas,
  loadPersonasState,
  nextPersonaId,
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
import { e1, modes, radius, space, type, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { SettingsHeader } from "./SettingsHeader";
import { PersonaEditorSheet, type PersonaEditorDraft } from "./PersonaEditorSheet";
import { PersonaRow } from "./PersonaRow";

type Props = {
  onBack: () => void;
  onActiveChange?: (id: string) => void;
};
type ThemeContext = { mode: ThemeMode };

export function PersonasScreen({ onBack, onActiveChange }: Props) {
  const insets = useSafeAreaInsets();
  const { mode } = useLabTheme<ThemeContext>();
  const colors = modes[mode];
  const { t } = useLocale();
  const mountedRef = useRef(true);
  const [state, setState] = useState<PersonasPersisted>({ items: [], hiddenBuiltinIds: [] });
  const [activeId, setActiveId] = useState("");
  const [editor, setEditor] = useState<PersonaEditorDraft | null>(null);
  const [notice, setNotice] = useState("");
  const builtins = useMemo(() => builtinCopyFromT(t), [t]);

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
      // Storage may be unavailable on a first-run device.
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

  const activate = useCallback(async (id: string) => {
    setActiveId(id);
    onActiveChange?.(id);
    try {
      await saveActivePersonaId(getDefaultPersonasStorage(), id);
    } catch {
      if (mountedRef.current) setNotice(t("memory.saveError"));
    }
  }, [onActiveChange, t]);

  const handleBack = useCallback(() => {
    if (editor) setEditor(null);
    else onBack();
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
  const templates = all.filter((persona) => persona.builtin);
  const yours = all.filter((persona) => !persona.builtin);

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
    setEditor({ id: persona.id, name: persona.name, instructions: persona.instructions });
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

  const confirmDelete = useCallback((persona: Persona) => {
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
            if (activeId === persona.id) await activate("");
          })();
        },
      },
    ]);
  }, [activate, activeId, persist, state, t]);

  const toggleHidden = useCallback((id: BuiltinPersonaId) => {
    const willHide = !hidden.has(id);
    const next = setBuiltinHidden(state, id, willHide);
    void persist(next);
    if (willHide && activeId === id) void activate("");
  }, [activate, activeId, hidden, persist, state]);

  const cardStyle = {
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    overflow: "hidden" as const,
    ...e1,
  };

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
      <SettingsHeader title={t("personas.title")} onBack={handleBack} backLabel={t("common.back")} />
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
          testID="personas.create"
          onPress={openCreate}
          accessibilityRole="button"
          accessibilityLabel={t("personas.create")}
          style={({ pressed }) => ({
            minHeight: 52,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.button,
            backgroundColor: pressed ? colors.brandDeep : colors.brand,
          })}
        >
          <Text style={[type.bodyStrong, { color: colors.onBrand }]}>{t("personas.create")}</Text>
        </Pressable>

        <View style={cardStyle}>
          <Text style={[type.label, { color: colors.ink3, padding: space.md }]}>
            {t("personas.templates").toLocaleUpperCase()}
          </Text>
          <View style={{ height: 1, backgroundColor: colors.line }} />
          {templates.map((persona) => (
            <PersonaRow
              key={persona.id}
              persona={persona}
              active={activeId === persona.id && !hidden.has(persona.id)}
              hidden={hidden.has(persona.id)}
              colors={colors}
              t={t}
              onActivate={() => void activate(activeId === persona.id ? "" : persona.id)}
              onEdit={() => openEdit(persona)}
              onDelete={() => confirmDelete(persona)}
              onToggleHidden={(id) => toggleHidden(id)}
            />
          ))}
        </View>

        <View style={cardStyle}>
          <Text style={[type.label, { color: colors.ink3, padding: space.md }]}>
            {t("personas.yours").toLocaleUpperCase()}
          </Text>
          <View style={{ height: 1, backgroundColor: colors.line }} />
          {yours.length === 0 ? (
            <Text style={[type.body, { color: colors.ink2, padding: space.md }]}>
              {t("personas.empty")}
            </Text>
          ) : (
            yours.map((persona) => (
              <PersonaRow
                key={persona.id}
                persona={persona}
                active={activeId === persona.id}
                hidden={false}
                colors={colors}
                t={t}
                onActivate={() => void activate(activeId === persona.id ? "" : persona.id)}
                onEdit={() => openEdit(persona)}
                onDelete={() => confirmDelete(persona)}
                onToggleHidden={toggleHidden}
              />
            ))
          )}
        </View>
      </ScrollView>
      {editor ? (
        <PersonaEditorSheet
          editor={editor}
          notice={notice}
          colors={colors}
          t={t}
          onChange={(next) => setEditor(next)}
          onSave={() => void saveEditor()}
          onClose={handleBack}
        />
      ) : null}
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
