/**
 * The file half of share-in (`AppShell.tsx:3583-3637`): a shared `.txt`/`.md`
 * is read with the controller's size caps into a prefill, anything else goes
 * through the PDF import into the document library, and every failure path —
 * too large, busy, failed — serves a notice instead of a silent no-op.
 *
 * Every side effect arrives as a port, so the branch order and the notice
 * mapping are testable in node without `expo-file-system` or the PDF host.
 *
 * ADAPTATION, reported: the controller attached the imported PDF to the
 * composer (`setShareAttachDoc`, `AppShell.tsx:3616-3621` →
 * `AiChatPage.tsx:3717-3722`); this build has no attachment flow at all
 * (PARITY row 43 — the composer's `attachment` is always `null`), so a
 * successful import says what happened and what is held
 * (`errors.shareImportNotAttached`) rather than pretending to attach.
 *
 * The controller decides `instanceof SharedImportError` to pick a notice;
 * this module reads the error's `code` instead — the outcomes are identical
 * for every value the import can throw (`too_large` / `busy` / everything
 * else → failed), and it keeps this file free of the expo import graph the
 * node tests would otherwise have to load.
 */
import { SHARE_TEXT_CAP, SHARE_TEXT_FILE_MAX_BYTES } from "../app/shareIntent";
import type { LibraryDoc } from "../documents/DocumentLibrary";
import type { TranslationKey } from "../i18n";

export interface ShareFilePorts {
  /** `FileSystem.getInfoAsync`. */
  getInfo: (uri: string) => Promise<{ exists: boolean; isDirectory?: boolean; size?: number }>;
  /** `FileSystem.readAsStringAsync`. */
  readText: (uri: string) => Promise<string>;
  /** `importSharedPdf` — rejects with a `SharedImportError`-shaped `code`. */
  importPdf: (uri: string) => Promise<LibraryDoc>;
  /** The library's `addDocument`; `false` means it did not take. */
  addDocument: (entry: LibraryDoc) => boolean;
  /** The controller's `shareImportingRef` (`AppShell.tsx:3560`). */
  isImporting: () => boolean;
  setImporting: (busy: boolean) => void;
  /** The one-slot notice, by catalogue key. */
  notice: (key: TranslationKey) => void;
  /** A text payload lands in the draft (the nonce bump lives in the caller). */
  prefill: (text: string) => void;
}

const SHARED_TEXT_EXT = /(?:\.txt|\.md)$/;

export async function applyShareFile(uri: string, ports: ShareFilePorts): Promise<void> {
  // The controller's branch order, verbatim: text files try first and fall
  // THROUGH on an empty read (an empty `.txt` is not a prefill, and the
  // import path below reports why it is not one either).
  const path = (uri.split("?")[0] ?? "").toLowerCase();
  if (SHARED_TEXT_EXT.test(path)) {
    try {
      const info = await ports.getInfo(uri);
      if (!info.exists || info.isDirectory) {
        ports.notice("errors.shareImportFailed");
        return;
      }
      if (typeof info.size !== "number" || !Number.isFinite(info.size) || info.size < 0) {
        ports.notice("errors.shareImportFailed");
        return;
      }
      if (info.size > SHARE_TEXT_FILE_MAX_BYTES) {
        ports.notice("errors.shareImportTooLarge");
        return;
      }
      const text = await ports.readText(uri);
      if (typeof text === "string" && text.trim()) {
        ports.prefill(text.slice(0, SHARE_TEXT_CAP));
        return;
      }
    } catch {
      ports.notice("errors.shareImportFailed");
      return;
    }
  }

  if (ports.isImporting()) {
    ports.notice("errors.shareImportBusy");
    return;
  }
  ports.setImporting(true);
  try {
    const entry = await ports.importPdf(uri);
    if (!ports.addDocument(entry)) {
      ports.notice("errors.shareImportBusy");
      return;
    }
    // The import's real job (into Documents) happened; the composer attach
    // did not exist to happen — say so instead of going quiet.
    ports.notice("errors.shareImportNotAttached");
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code ?? "")
        : "";
    if (code === "too_large") ports.notice("errors.shareImportTooLarge");
    else if (code === "busy") ports.notice("errors.shareImportBusy");
    else ports.notice("errors.shareImportFailed");
  } finally {
    ports.setImporting(false);
  }
}
