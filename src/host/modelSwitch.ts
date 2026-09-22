/**
 * Model selection: `selectModel` + `selectModelById`, lifted from the old
 * controller as a factory over injected state. The two inner functions keep
 * their original names so their mutual calls stay verbatim.
 *
 * Adaptations (reported): the render-captured guards read `modelIndexRef` /
 * `modelStateRef` (same values, sync read); `downloadInFlight` is gone with
 * the download paths; the chat-side locks are `regenState`'s module refs,
 * maintained at the same points the old screen did. `MODEL_STORAGE_KEY` is the
 * parity doc's class-(a) const, lifted.
 */
import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  deferModelSwitchIfSendClaimed,
  drainPendingModelSwitch,
  regenInFlightRef,
  sendClaimRef,
  sendingInFlightRef,
} from "../engine/regenState";
import {
  computeHistoryHashFromMessages,
  readBootMessages,
} from "../engine/sessionPersistence";
import {
  disposeEngine,
  getActiveModelId,
  isEngineReady,
  saveEngineSession,
} from "../engine/LlamaService";
import {
  markChatReleased,
  nativeOpBusy,
  runNativeOpBounded,
} from "../engine/llamaContextGate";
import { MODEL_REGISTRY } from "../engine/ModelRegistry";
import { clearLoadMarker } from "../engine/loadMarker";
import { MODEL_SWITCH_DISPOSE_TIMEOUT_MS } from "./engineGateHelpers";
import { loadMarkerStore, type EngineLoadDeps } from "./engineLoad";

export const MODEL_STORAGE_KEY = "kalsa.model.id";

export interface ModelSwitchDeps extends EngineLoadDeps {
  memoryExtractRef: { current: Promise<void> | null };
}

/** Single-flight guard across a switch's dispose window (was a component ref). */
const modelSwitchInFlightRef = { current: false };
/** Single-flight waiter that drains the pending switch queue after sendClaim. */
const modelSwitchDrainInFlightRef = { current: false };

export function createModelSwitchers(deps: ModelSwitchDeps) {
  const {
    t,
    thermalHardGateRef,
    engineGenerationRef,
    modelIndexRef,
    chatGateGenRef,
    modelStateRef,
    streamInFlightRef,
    setModelIndex,
    setModelState,
    setModelError,
    setModelErrorKind,
    setModelErrorDetail,
    memoryExtractRef,
  } = deps;
  async function selectModel(nextIndex: number): Promise<void> {
      if (thermalHardGateRef.current) return;
      if (
        modelSwitchInFlightRef.current ||
        modelStateRef.current === "downloading" ||
        modelStateRef.current === "loading"
      ) {
        return;
      }
      if (nextIndex < 0 || nextIndex >= MODEL_REGISTRY.length) return;
      if (nextIndex === modelIndexRef.current) return;

      // Pool: keep the previous model's session on disk so switch-back can restore.

      // Sync invalidation: the double-tap guard, the generation bump and the
      // gen capture/clear must not sit behind the awaited clear below — an
      // in-flight ensure is invalidated by the bump the moment the tap lands,
      // not one storage round-trip later. modelIndexRef moves with them: it is
      // invalidation, not the flip, and triggers no render. The flip itself
      // stays after the clear (the kick it triggers reads the marker through
      // the load gate, and a fire-and-forget clear could lose that race).
      modelSwitchInFlightRef.current = true;
      engineGenerationRef.current += 1;
      // FIX 1: capture THIS load's gen SYNCHRONOUSLY at switch/invalidation time.
      // The dispose callback must never read chatGateGenRef.current — a newer
      // ensureEngineForModel may have acquired a higher gen by then.
      const releasedGen = chatGateGenRef.current;
      chatGateGenRef.current = null;
      modelIndexRef.current = nextIndex; // keep stillCurrent() correct before re-render

      // Two releases for the lock, two for the gen, mutually exclusive: the
      // catch below covers throws from statements BEFORE the dispose IIFE
      // launches; the IIFE's finally covers everything from launch on and is
      // the only release on the normal path.
      try {
        // Awaited BEFORE the selection flips: they share one continuation with
        // no await in between, re-entry is locked above, and modelIndex is
        // still unchanged, so no kick exists yet.
        await clearLoadMarker(loadMarkerStore, MODEL_REGISTRY[nextIndex].id).catch(() => undefined);
        // Re-asserting a selection clears that model's death marker so the user
        // can retry a model whose load killed a previous launch.

        // Transition: show checking before dispose awaits.
        setModelIndex(nextIndex);
        setModelState("checking");
        setModelError(null);
        setModelErrorDetail(null);
        setModelErrorKind(null);
        // Persist the selection: restored at next boot (same as Atomic Chat).
        AsyncStorage.setItem(MODEL_STORAGE_KEY, MODEL_REGISTRY[nextIndex].id).catch(() => undefined);

        // Extraction holds the engine: wait briefly so dispose does not race it.
        // Epoch checks discard any delayed writes after the engine is gone.
        void (async () => {
          // The outer try arms at the TOP of the body, so the memory-extract
          // block below runs inside it: the body can no longer end without
          // releasing what the switch captured (gen + lock). Nothing in here is
          // known to throw, so this closes a shape, not a witnessed crash.
          try {
            if (memoryExtractRef.current) {
              let memoryExtractTimer: ReturnType<typeof setTimeout> | undefined;
              try {
                await Promise.race([
                  memoryExtractRef.current,
                  new Promise<void>((resolve) => {
                    memoryExtractTimer = setTimeout(resolve, 3000);
                  }),
                ]);
              } catch {
                // ignore
              } finally {
                // Keep the 3s bound, but never leak the timer when extraction wins.
                if (memoryExtractTimer !== undefined) clearTimeout(memoryExtractTimer);
              }
              memoryExtractRef.current = null;
            }
            if (isEngineReady() && !sendingInFlightRef.current) {
              const modelId = getActiveModelId();
              if (modelId) {
                try {
                  const msgs = await readBootMessages();
                  await saveEngineSession(
                    modelId,
                    computeHistoryHashFromMessages(msgs),
                    msgs.length,
                  );
                } catch {
                  // previous good .kvs stays
                }
              }
            }
            // Dispose inside runNativeOp so chat release cannot overlap an
            // in-flight embed op (never-overlap invariant). Bounded: a hung
            // native completion must not hold the FIFO forever and leave the
            // UI stuck on "checking"; on timeout we refuse WITHOUT enqueueing
            // behind the possibly-hung op.
            const disposeResult = await runNativeOpBounded(
              () => disposeEngine(),
              MODEL_SWITCH_DISPOSE_TIMEOUT_MS,
            );
            if (!disposeResult.ok) {
              console.warn(
                `[kalsa] model switch dispose timed out after ${MODEL_SWITCH_DISPOSE_TIMEOUT_MS}ms (nativeOpBusy=${nativeOpBusy()}); previous model still resident — the switch can be retried`,
              );
              setModelState("error");
              setModelErrorKind("engine");
              setModelError(t("errors.engineDisposeTimeout"));
              setModelErrorDetail(null);
            }
          } catch {
            // ignore
          } finally {
            // Dispose → free only the gen captured at switch time.
            if (releasedGen !== null) markChatReleased(releasedGen);
            modelSwitchInFlightRef.current = false;
          }
        })();
      } catch (error) {
        // Mirror of the IIFE's finally, for throws before its launch: release
        // the captured gen (or chat_ready would outlive chatGateGenRef and
        // tryAcquireChat would refuse forever) and clear the lock. The catch
        // and the finally are mutually exclusive — the catch only sees
        // statements preceding the launch — so there is no double release.
        if (releasedGen !== null) markChatReleased(releasedGen);
        modelSwitchInFlightRef.current = false;
        // The rethrow below reaches no handler — this app has no global
        // rejection handler and callers discard the promise — so without this
        // line a failed switch is invisible on a release build. Name and
        // message only: these logs ride on public CI artifacts.
        console.warn(
          `[kalsa] model switch failed before dispose: ${(error as Error)?.name ?? "Error"}: ${(error as Error)?.message ?? String(error)}`,
        );
        throw error;
      }  }

  function selectModelById(modelId: string): void {
      // While a send holds the pre-await claim (fit-gate), queue the switch
      // (last-wins) and apply it only after the claim releases. Avoids dispose
      // racing ensureEngineForModel mid-send.
      if (deferModelSwitchIfSendClaimed(modelId)) {
        if (!modelSwitchDrainInFlightRef.current) {
          modelSwitchDrainInFlightRef.current = true;
          void (async () => {
            try {
              const t0 = Date.now();
              // Wait for the pre-await claim AND any in-flight native send to
              // clear: the watchdog frees the claim first, but the native
              // completion can lag past it.
              while (
                (sendClaimRef.current || sendingInFlightRef.current) &&
                Date.now() - t0 < 5000
              ) {
                await new Promise((r) => setTimeout(r, 50));
              }
              // Timed out still claimed/in-flight: drop queue so a late dispose
              // cannot land mid-stream without a fresh user action.
              if (sendClaimRef.current || sendingInFlightRef.current) {
                drainPendingModelSwitch();
                return;
              }
              const pendingId = drainPendingModelSwitch();
              if (!pendingId) return;
              // Claim free — re-enter (defer will no-op).
              selectModelById(pendingId);
            } finally {
              modelSwitchDrainInFlightRef.current = false;
            }
          })();
        }
        return;
      }
      const nextIndex = MODEL_REGISTRY.findIndex((m) => m.id === modelId);
      if (nextIndex < 0) return;
      // Refuse model switch while edit/regenerate owns the turn.
      if (regenInFlightRef.current) {
        Alert.alert(t("chat.regenBusy"), t("chat.regenBusy"));
        return;
      }
      if (streamInFlightRef.current) {
        Alert.alert(
          t("settings.switchWhileStreamingTitle"),
          t("settings.switchWhileStreamingBody"),
          [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("common.continue"),
              style: "destructive",
              onPress: () => selectModel(nextIndex),
            },
          ],
        );
        return;
      }
      selectModel(nextIndex);  }

  return { selectModel, selectModelById };
}
