/**
 * Share-in: the `Linking` listener, the pending-until-ready flush, and the
 * nonce merge into the draft — the controller's four traps kept in place
 * (`AppShell.tsx:3553-3671`, `AiChatPage.tsx:1959-1969`), called through
 * the controller's own `parseShareUrl` / `mergeSharePrefill`
 * (`src/app/shareIntent.ts` — called, never rebuilt).
 *
 * - CONSUME ONCE: `claimShare` records the URL at claim time, so the
 *   `getInitialURL` + `url` double delivery of one intent applies once.
 * - HOLD until ready: a URL arriving before `conversationsReady` parks in
 *   the gate; the flush effect re-claims it — held, never dropped.
 * - NONCE RE-MERGE: each applied text runs through `recordSharePrefill`, so
 *   the merge effect's dependencies change even for identical text and the
 *   same passage shared twice appends twice.
 * - NOTICES: the file half's busy / too-large / failed paths each serve the
 *   one-slot notice (`shareImport.ts`); text payloads need none.
 *
 * The root passes ports only — state it owns (draft, drawer, notice) and the
 * library's `addDocument` — so this hook holds no state of its own beyond
 * the gate, the import flag and the pending prefill.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { importSharedPdf } from "../documents/importSharedDocument";
import { mergeSharePrefill, type ShareInPayload } from "../app/shareIntent";
import type { LibraryDoc } from "../documents/DocumentLibrary";
import type { TranslationKey } from "../i18n";
import { applyShareFile } from "./shareImport";
import {
  claimShare,
  createShareGate,
  recordSharePrefill,
  takePendingShare,
  type SharePrefill,
} from "./shareIn";

export interface ShareInParams {
  /** The controller's `conversationsReady` gate (`AppShell.tsx:3562`). */
  conversationsReady: boolean;
  setDraft: (updater: (prev: string) => string) => void;
  /** A claimed share closes the drawer first (`AppShell.tsx:3570`). */
  setDrawerOpen: (open: boolean) => void;
  showNoticeKey: (key: TranslationKey) => void;
  addDocument: (entry: LibraryDoc) => boolean;
}

export function useShareIn(params: ShareInParams): void {
  const { conversationsReady, setDraft, setDrawerOpen, showNoticeKey, addDocument } = params;
  const [gate] = useState(createShareGate);
  const importingRef = useRef(false);
  const [prefill, setPrefill] = useState<SharePrefill | null>(null);
  // Read inside `consume`, not from the effect's closure — the listener must
  // see the current value without resubscribing per conversation load
  // (the controller's `conversationsReadyRef`, `AppShell.tsx:3564-3565`).
  const conversationsReadyRef = useRef(conversationsReady);
  conversationsReadyRef.current = conversationsReady;
  const consumeRef = useRef<(url: string | null) => void>(() => {});

  const apply = useCallback(
    async (payload: ShareInPayload) => {
      setDrawerOpen(false);
      if (payload.kind === "text") {
        setPrefill((previous) => recordSharePrefill(previous, payload.text));
        return;
      }
      await applyShareFile(payload.uri, {
        getInfo: (uri) => FileSystem.getInfoAsync(uri),
        readText: (uri) => FileSystem.readAsStringAsync(uri),
        importPdf: (uri) => importSharedPdf(uri),
        addDocument,
        isImporting: () => importingRef.current,
        setImporting: (busy) => {
          importingRef.current = busy;
        },
        notice: showNoticeKey,
        prefill: (text) => setPrefill((previous) => recordSharePrefill(previous, text)),
      });
    },
    [addDocument, setDrawerOpen, showNoticeKey],
  );

  useEffect(() => {
    let cancelled = false;
    const consume = (url: string | null) => {
      if (cancelled) return;
      const claim = claimShare(gate, url, conversationsReadyRef.current);
      if (claim.outcome === "apply") void apply(claim.payload);
    };
    consumeRef.current = consume;
    const sub = Linking.addEventListener("url", (event) => consume(event.url));
    void Linking.getInitialURL()
      .then((url) => consume(url))
      .catch(() => undefined);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [apply, gate]);

  // The pending flush (`AppShell.tsx:3661-3671`): once the conversations are
  // ready, take the held URL out of the slot and run it through the SAME
  // consume — claim rules included, so a URL claimed elsewhere is a duplicate.
  useEffect(() => {
    if (!conversationsReady) return;
    const held = takePendingShare(gate);
    if (!held) return;
    consumeRef.current(held);
  }, [conversationsReady, gate]);

  // The chat-side merge (`AiChatPage.tsx:1959-1969`): keyed on text AND
  // nonce, so an identical payload with a bumped nonce merges again — the
  // controller's exact dependencies, over the root's draft.
  const prefillText = prefill?.text;
  const prefillNonce = prefill?.nonce;
  useEffect(() => {
    if (!prefillText || prefillNonce === undefined) return;
    setDraft((previous) => mergeSharePrefill(previous, prefillText));
  }, [prefillText, prefillNonce, setDraft]);
}
