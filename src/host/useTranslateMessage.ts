/**
 * Translate a message into the settings language — the controller's
 * `runTranslate` (`AiChatPage.tsx:3533-3582`), its refs (`Chat:1308-1319`)
 * and its two cleanup effects (`Chat:1875-1905`, `Chat:1951-1957`) as one
 * hook beside the message actions.
 *
 * Result is VOLATILE React state keyed by message id — never written into a
 * `Message`, so nothing here can reach the persist path or move the history
 * hash (the controller kept `translationResult` out of `Message` too;
 * `toPersistableHistoryMessages` never saw a translation).
 *
 * Three fences, each for a different way a stale translation could land:
 *
 * 1. **Run id**: `++runRef` at start; a result is applied only by the run
 *    that still owns the id, and the finally only releases the flag it still
 *    owns — a superseded run cannot clear a newer run's guard.
 * 2. **Conversation switch / unmount**: abort the engine job, bump the run
 *    id, drop the state. The bump is the anti-orphan trap: persisted ids can
 *    repeat across conversations, so a late result keyed by id must be
 *    refused by the run id, not trusted to find a "different" message.
 * 3. **Orphan cleanup**: whatever message the view is showing (busy or done)
 *    is checked against the live list; when it is gone the busy flag and the
 *    result go together, so a half-run can never paint under a message that
 *    no longer exists.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { translateText } from "../engine/engineBackend";
import type { TranslateResult } from "../engine/LlamaService";
import type { Locale, TranslationKey } from "../i18n";
import type { TranscriptTranslation } from "../ui/shell/transcriptTypes";
import type { Message } from "./hostMessage";
import { translationInFlightRef } from "./translateState";
import { isRemoteEngineBackend } from "../engine/engineBackend";
import { runHostLocalAction } from "./remoteLocalAction";

export type TranslationOutcome = {
  id: string;
  text: string;
  lang: Locale;
  error?: boolean;
  truncated?: boolean;
};

export interface TranslateMessageParams {
  locale: Locale;
  /** The active conversation: a switch drops the run and its state. */
  conversationId: string | undefined;
  /** The rendering mirror; the orphan cleanup reads it, never mutates it. */
  messages: readonly Message[];
  sendingRef: { current: boolean };
  showNoticeKey: (key: TranslationKey) => void;
  /** The menu closes when a run starts, as the controller's did. */
  closeMenu: () => void;
}

export interface TranslateMessage {
  /** The band's view of the run under one message, or null when idle. */
  view: TranscriptTranslation | null;
  /** True while a job holds the engine — the send face dims on it. */
  translating: boolean;
  run: (messageId: string, sourceText: string) => void;
  retry: () => void;
  close: () => void;
  toggle: () => void;
}

export function useTranslateMessage(params: TranslateMessageParams): TranslateMessage {
  const { locale, conversationId, messages, sendingRef, closeMenu } = params;
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [result, setResult] = useState<TranslationOutcome | null>(null);
  const [expanded, setExpanded] = useState(true);
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  /** Retry re-runs the message the current view belongs to. */
  const sourceRef = useRef<{ id: string; text: string } | null>(null);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const closeMenuRef = useRef(closeMenu);
  closeMenuRef.current = closeMenu;
  const noticeRef = useRef(params.showNoticeKey);
  noticeRef.current = params.showNoticeKey;

  const run = useCallback((messageId: string, sourceText: string) => {
    runHostLocalAction(isRemoteEngineBackend(), () => noticeRef.current("settings.remoteGated"), () => {
      // Do not contend with an active chat completion on the same engine.
      if (sendingRef.current || translationInFlightRef.current) return;
      const runId = (runRef.current += 1);
      // Sync flag BEFORE the await, so the opener / send see it immediately.
      translationInFlightRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      closeMenuRef.current();
      setTranslatingId(messageId);
      setResult(null);
      setExpanded(true);
      sourceRef.current = { id: messageId, text: sourceText };
      // Captured at start so the badge stays correct if locale changes mid-run.
      const targetLang = localeRef.current;
      void (async () => {
        try {
          const out: TranslateResult = await translateText(
            sourceText,
            targetLang,
            targetLang,
            controller.signal,
          );
          if (runId !== runRef.current) return;
          setResult(
            out.text
              ? { id: messageId, text: out.text, lang: targetLang, truncated: out.truncated }
              : { id: messageId, text: "", lang: targetLang, error: true, truncated: out.truncated },
          );
        } catch {
          if (runId !== runRef.current) return;
          setResult({ id: messageId, text: "", lang: targetLang, error: true });
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
          if (runId === runRef.current) {
            translationInFlightRef.current = false;
            setTranslatingId(null);
          }
        }
      })();
    });
  }, [sendingRef]);

  const retry = useCallback(() => {
    const source = sourceRef.current;
    if (source) run(source.id, source.text);
  }, [run]);

  const close = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    translationInFlightRef.current = false;
    setTranslatingId(null);
    setResult(null);
  }, []);

  const toggle = useCallback(() => setExpanded((value) => !value), []);

  // Conversation change: abort the job, bump the run id, drop the state —
  // the controller's `Chat:1875-1905`, trimmed to the translate half.
  const lastConversationRef = useRef(conversationId);
  useEffect(() => {
    const previous = lastConversationRef.current;
    lastConversationRef.current = conversationId;
    if (previous === conversationId) return;
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    translationInFlightRef.current = false;
    setTranslatingId(null);
    setResult(null);
    sourceRef.current = null;
  }, [conversationId]);

  // Unmount: the job must not write state into a dead component, and the
  // engine job must stop (controller `Chat:1920-1924`).
  useEffect(
    () => () => {
      runRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      translationInFlightRef.current = false;
    },
    [],
  );

  // The orphan cleanup (controller `Chat:1951-1957`, widened to the busy id):
  // a translation whose message is gone — regenerate truncation, history
  // trim, delete — is dropped WHOLE, busy flag and result together.
  useEffect(() => {
    const target = translatingId ?? result?.id;
    if (target === undefined || target === null) return;
    if (messages.some((message) => message.id === target)) return;
    setTranslatingId(null);
    setResult(null);
    sourceRef.current = null;
  }, [messages, result, translatingId]);

  let view: TranscriptTranslation | null = null;
  if (translatingId !== null) {
    view = { messageId: translatingId, busy: true, expanded };
  } else if (result !== null) {
    view = {
      messageId: result.id,
      busy: false,
      expanded,
      result: {
        text: result.text,
        lang: result.lang,
        ...(result.error ? { error: true } : {}),
        ...(result.truncated ? { truncated: true } : {}),
      },
    };
  }

  return { view, translating: translatingId !== null, run, retry, close, toggle };
}
