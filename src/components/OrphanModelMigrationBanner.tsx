import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Trash2, Inbox } from "lucide-react-native";

import { useLocale } from "../i18n";
import { useLabTheme } from "../ui/labTheme";
import {
  clearPendingOrphanMigration,
  deleteOrphanDirs,
  estimateOrphanSizeBytes,
  loadPendingOrphanMigration,
  rememberKeptOrphanIds,
  type PendingOrphanMigration,
} from "../engine/ModelDownloader.orphanMigration";
import { formatBytes } from "../engine/ModelRegistry";
import { GlassPanel2 } from "../theme/components";
import { radius, spacing } from "../theme/tokens";
import { useTypography, fontFamilies } from "../theme/typography";

/**
 * One-time "N models no longer in catalog — Delete / Keep" notice.
 *
 * Reads the pending orphan migration persisted at boot (see
 * `detectOrphansAtBoot`). Shows only when a non-empty, non-dismissed payload
 * exists. Delete removes those dirs + resume blobs; Keep remembers the ids so we
 * never re-prompt. Never throws to the caller.
 */
export function OrphanModelMigrationBanner() {
  const { t } = useLocale();
  const typography = useTypography();
  const { colors } = useLabTheme<any>();

  const [migration, setMigration] = useState<PendingOrphanMigration | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadPendingOrphanMigration().then(setMigration);
  }, []);

  if (!migration || migration.orphans.length === 0) return null;

  const sizeLabel =
    migration.sizeBytes != null ? ` · ${formatBytes(migration.sizeBytes)}` : "";

  const run = async (action: "delete" | "keep") => {
    if (busy) return;
    setBusy(true);
    try {
      if (action === "delete") {
        await deleteOrphanDirs(migration.orphans);
      } else {
        // Remember so we don't re-prompt; leave the files in place.
        await rememberKeptOrphanIds(migration.orphans);
        await clearPendingOrphanMigration();
      }
    } finally {
      setBusy(false);
      setMigration(null);
    }
  };

  return (
    <GlassPanel2 opaque rounded="md" style={{ padding: spacing.md, gap: spacing.sm }}>
      <View style={{ gap: spacing.xs }}>
        <View style={{ gap: spacing.xs }}>
          <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
            {t("models.orphanNoticeTitle", { count: migration.orphans.length })}
          </Text>
          <Text style={[typography.bodyXs, { color: colors.muted }]}>
            {t("models.orphanNoticeBody", { count: migration.orphans.length })}{sizeLabel}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Pressable
            onPress={() => run("delete")}
            disabled={busy}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.bad ?? colors.line,
              backgroundColor: pressed ? `${colors.bad ?? colors.line}22` : "transparent",
            })}
          >
            <Trash2 size={16} color={colors.bad ?? colors.muted} />
            <Text style={[typography.bodySm, { color: colors.bad ?? colors.ink }]}>
              {t("models.orphanDelete")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => run("keep")}
            disabled={busy}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: pressed ? `${colors.accent}22` : "transparent",
            })}
          >
            <Inbox size={16} color={colors.muted} />
            <Text style={[typography.bodySm, { color: colors.ink }]}>
              {t("models.orphanKeep")}
            </Text>
          </Pressable>
        </View>
      </View>
    </GlassPanel2>
  );
}