/**
 * The root's engine-turn ref cluster and its thermal gate, extracted from
 * `HostRoot.tsx` under the file-size rule (the root may only compose, and
 * the Web switch, the composer arms and the welcome wiring needed the lines —
 * the seam this file IS, reported with the slice).
 *
 * A MOVE, not a redesign: every ref, its type and its initial value are the
 * ones the root declared when this file was cut, and `HostEngineParams`
 * (`useHostEngine.ts`) still names the same shapes — the root spreads `refs`
 * back into that call, so the composition reads as it did before with one
 * object instead of thirteen declarations.
 *
 * The thermal gate rides along because it is a hook (it subscribes): the
 * imperative ref is updated by the native event BEFORE React paints the gate,
 * which is the property the engine half depends on, unchanged here.
 */
import { useCallback, useRef } from "react";
import { useThermalHardGate } from "../hooks/useThermalHardGate";
import { COMPACTION_ENABLED_DEFAULT } from "../engine/ttftFlags";
import type { ContextMode } from "../context/compactor";
import type { LocalAttachment } from "./hostMessage";

/** What the root hands `useHostEngine` as one spread: exactly the ref-shaped
 *  parameters of `HostEngineParams` — no state, no stores, no flags. */
export type HostTurnRefs = {
  thermalHardGateRef: { current: boolean };
  streamInFlightRef: { current: boolean };
  nativeTurnStartAtRef: { current: number };
  lastUserRawRef: { current: string };
  activeDocumentAttachmentRef: { current: LocalAttachment | null };
  onMiniappRef: { current: (miniapp: unknown) => void };
  memoryExtractRef: { current: Promise<void> | null };
  memoryExtractCancelRef: { current: (() => void) | null };
  toolhelpRef: { current: boolean };
  contextModeRef: { current: ContextMode };
  compactionEnabledRef: { current: boolean };
  embedderDownloadedRef: { current: boolean };
  chatEngineCtxRef: { current: number };
};

/** The conversation-touched publisher slot: declared beside the cluster it
 *  reads, published by the root after the actions object exists. */
export type TouchedRef = {
  current: ((meta: { title: string; preview: string; searchBlob: string }) => void) | null;
};

export function useHostTurnRefs(): {
  refs: HostTurnRefs;
  thermalHardGated: boolean;
  touchedRef: TouchedRef;
} {
  const thermalHardGateRef = useRef(false);
  const onThermalHardGateChange = useCallback((gated: boolean) => {
    // Native events update the imperative guard before React paints the gate.
    thermalHardGateRef.current = gated;
  }, []);
  const { gated: thermalHardGated } = useThermalHardGate({ onGateChange: onThermalHardGateChange });

  const streamInFlightRef = useRef(false);
  const nativeTurnStartAtRef = useRef(0);
  const lastUserRawRef = useRef("");
  const activeDocumentAttachmentRef = useRef<LocalAttachment | null>(null);
  const onMiniappRef = useRef<(miniapp: unknown) => void>(() => {});
  const memoryExtractRef = useRef<Promise<void> | null>(null);
  const memoryExtractCancelRef = useRef<(() => void) | null>(null);
  const toolhelpRef = useRef(false);
  const contextModeRef = useRef<ContextMode>("anchored");
  const compactionEnabledRef = useRef(COMPACTION_ENABLED_DEFAULT);
  const embedderDownloadedRef = useRef(false);
  const chatEngineCtxRef = useRef(4096);
  const touchedRef = useRef<TouchedRef["current"]>(null);

  return {
    refs: {
      thermalHardGateRef,
      streamInFlightRef,
      nativeTurnStartAtRef,
      lastUserRawRef,
      activeDocumentAttachmentRef,
      onMiniappRef,
      memoryExtractRef,
      memoryExtractCancelRef,
      toolhelpRef,
      contextModeRef,
      compactionEnabledRef,
      embedderDownloadedRef,
      chatEngineCtxRef,
    },
    thermalHardGated,
    touchedRef,
  };
}
