/** Document library surface; import and extraction live in useDocumentImport. */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  BackHandler,
  Pressable,
  Text,
  View,
} from "react-native";
import { Plus, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DraggableFlatList, {
  type RenderItemParams,
  ScaleDecorator,
} from "react-native-draggable-flatlist";

import {
  type LibraryDoc,
  type LibraryState,
} from "../documents/DocumentLibrary";
import { isDocumentOpInFlight } from "../documents/documentChatTool";
import { useLocale } from "../i18n";
import { modes, radius, space, type, type ThemeMode } from "../theme/design";
import { useLabTheme } from "../ui/labTheme";
import { SettingsHeader } from "./SettingsHeader";
import { useDocumentImport } from "./documents/useDocumentImport";

import { DocumentListItem } from "./documents/DocumentListItem";
import {
  DocumentDetailView,
  type RebuildSemanticIndexResult,
} from "./documents/DocumentDetailView";
import { DocumentsEmptyState } from "./documents/DocumentsEmptyState";
import { DocumentImportOverlay } from "./documents/DocumentImportOverlay";

// Re-export pure helpers so existing harness imports / external callers keep working.
export {
  MAX_DOCUMENT_BYTES,
  MAX_TEXT_BYTES,
  normalizeUriPath,
  isOwnedDocumentUri,
  sizeWithinLimits,
} from "../documents/documentStorage";

type Props = {
  /** Current library snapshot from AppShell (display only — never merge). */
  library: LibraryState;
  /**
   * AppShell-owned add/import commit. Applies against current library state
   * (ref + functional updater). Returns false when refused (delete latch).
   * Screens must not call DocumentLibrary.addDoc with a captured snapshot.
   */
  onAddDocument: (entry: LibraryDoc) => boolean;
  /**
   * AppShell-owned delete. Survives screen unmount; applies against current
   * library state (functional updater). Returns false when refused (busy latch).
   */
  onDeleteDocument: (id: string) => Promise<boolean>;
  /** AppShell-owned dense-index reset and background re-embed. */
  onRebuildSemanticIndex: (id: string) => Promise<RebuildSemanticIndexResult>;
  /** Reactive busy state for a user-triggered rebuild job. */
  isSemanticRebuildBusy: boolean;
  /** AppShell-owned reorder (strict permutation via reorderDocs). */
  onReorderDocuments: (orderedIds: string[]) => void;
  /** AppShell-owned cover commit; refuses if doc is gone. */
  onUpdateDocumentPreview: (id: string, previewUri: string) => void;
  /**
   * AppShell-owned delete latch (survives unmount). Import/extract must refuse
   * while a delete is in flight.
   */
  isDocumentDeleteInFlight: () => boolean;
  /** Back closes the overlay (returns to chat / previous). */
  onBack: () => void;
};

type ScreenMode = "list" | { detailId: string };

export function DocumentsScreen({
  library,
  onAddDocument,
  onDeleteDocument,
  onRebuildSemanticIndex,
  isSemanticRebuildBusy,
  onReorderDocuments,
  onUpdateDocumentPreview: _onUpdateDocumentPreview,
  isDocumentDeleteInFlight,
  onBack,
}: Props) {
  // Cover is committed pre-add (importDocument); AppShell still accepts late
  // onUpdateDocumentPreview for future paths — keep the prop in the public API.
  void _onUpdateDocumentPreview;
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const colors = modes[mode];
  const insets = useSafeAreaInsets();
  const { t } = useLocale();
  const { importing, importName, importDocument, busyGuards } = useDocumentImport({
    onAddDocument,
    isDocumentDeleteInFlight,
  });

  const [screenMode, setScreenMode] = useState<ScreenMode>("list");
  const [reorderHintVisible, setReorderHintVisible] = useState(true);

  const docs = library.docs ?? [];
  const detailDoc =
    typeof screenMode === "object"
      ? docs.find((d) => d.id === screenMode.detailId) ?? null
      : null;

  // If the open detail was deleted elsewhere, pop back to list.
  useEffect(() => {
    if (typeof screenMode === "object" && !detailDoc) {
      setScreenMode("list");
    }
  }, [screenMode, detailDoc]);

  const handleBack = useCallback(() => {
    if (importing) return true;
    if (typeof screenMode === "object") {
      setScreenMode("list");
      return true;
    }
    onBack();
    return true;
  }, [importing, screenMode, onBack]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      return handleBack();
    });
    return () => sub.remove();
  }, [handleBack]);

  const confirmDelete = useCallback(
    (doc: LibraryDoc) => {
      if (busyGuards()) {
        Alert.alert(t("documents.title"), t("documents.errorBusy"));
        return;
      }
      Alert.alert(
        t("documents.delete"),
        t("documents.deleteConfirm", { name: doc.name }),
        [
          { text: t("documents.deleteCancel"), style: "cancel" },
          {
            text: t("documents.delete"),
            style: "destructive",
            onPress: () => {
              if (busyGuards()) {
                Alert.alert(t("documents.title"), t("documents.errorBusy"));
                return;
              }
              void onDeleteDocument(doc.id).then((accepted) => {
                if (!accepted) {
                  Alert.alert(t("documents.title"), t("documents.errorBusy"));
                  return;
                }
                setScreenMode("list");
              });
            },
          },
        ],
      );
    },
    [busyGuards, onDeleteDocument, t],
  );

  const onDragEnd = useCallback(
    ({ data }: { data: LibraryDoc[] }) => {
      const orderedIds = data.map((d) => d.id);
      onReorderDocuments(orderedIds);
    },
    [onReorderDocuments],
  );

  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<LibraryDoc>) => (
      <ScaleDecorator>
        <DocumentListItem
          doc={item}
          drag={drag}
          isActive={isActive}
          onOpen={(d) => {
            if (importing) return;
            setScreenMode({ detailId: d.id });
          }}
        />
      </ScaleDecorator>
    ),
    [importing],
  );

  const keyExtractor = useCallback((item: LibraryDoc) => item.id, []);

  const listData = useMemo(() => docs.slice(), [docs]);

  // Detail mode — in-screen push (not AppShell overlay).
  if (detailDoc) {
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
        <DocumentDetailView
          doc={detailDoc}
          onBack={() => setScreenMode("list")}
          onDelete={confirmDelete}
          onRebuildSemanticIndex={onRebuildSemanticIndex}
          busy={
            importing ||
            isSemanticRebuildBusy ||
            isDocumentDeleteInFlight() ||
            isDocumentOpInFlight()
          }
        />
        {importing ? <DocumentImportOverlay fileName={importName} /> : null}
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
        backgroundColor: colors.page,
        zIndex: 50,
      }}
    >
      <SettingsHeader
        title={t("documents.title")}
        onBack={handleBack}
        backLabel={t("common.back")}
      />
      {docs.length > 0 ? (
        <View
          style={{
            paddingHorizontal: space.md,
            paddingTop: space.xs,
            paddingBottom: space.sm,
          }}
        >
          <Pressable
            testID="documents.add"
            onPress={() => void importDocument()}
            disabled={importing}
            accessibilityRole="button"
            accessibilityLabel={t("documents.add")}
            accessibilityState={{ disabled: importing }}
            style={({ pressed }) => ({
              minHeight: 52,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: space.sm,
              borderRadius: radius.button,
              backgroundColor: importing
                ? colors.tint
                : pressed ? colors.brandDeep : colors.brand,
            })}
          >
            <Plus
              size={20}
              color={importing ? colors.ink3 : colors.onBrand}
              strokeWidth={1.75}
            />
            <Text
              style={[
                type.bodyStrong,
                { color: importing ? colors.ink3 : colors.onBrand },
              ]}
            >
              {t("documents.add")}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {docs.length === 0 ? (
        <DocumentsEmptyState
          onAdd={() => void importDocument()}
          disabled={importing}
        />
      ) : (
        <View style={{ flex: 1 }}>
          <DraggableFlatList
            data={listData}
            keyExtractor={keyExtractor}
            onDragEnd={onDragEnd}
            renderItem={renderItem}
            containerStyle={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: space.md,
              paddingTop: space.xs,
              paddingBottom: insets.bottom + space.lg,
              gap: space.sm,
            }}
            // MED-2: lower activation so a single hold-swipe on 480px works.
            activationDistance={6}
          />
          {reorderHintVisible ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingHorizontal: space.md,
                paddingVertical: space.xs,
                paddingBottom: insets.bottom + space.sm,
              }}
            >
              <Text style={[type.secondary, { color: colors.ink3, flex: 1 }]}>
                {t("documents.reorderHint")}
              </Text>
              <Pressable
                onPress={() => setReorderHintVisible(false)}
                accessibilityRole="button"
                accessibilityLabel={t("documents.reorderHintDismiss")}
                style={{
                  width: 40,
                  height: 40,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={16} color={colors.ink3} strokeWidth={1.75} />
              </Pressable>
            </View>
          ) : null}
        </View>
      )}

      {importing ? <DocumentImportOverlay fileName={importName} /> : null}
    </View>
  );
}
