import type { LlamaContext } from "llama.rn";
import type { KvReproState } from "./kvReproducibility";
import type { BakedUserTail } from "./memoryFactsTail";
import type { SessionSaveFingerprint } from "./sessionPersistence";
import type { PromptEnvInputs } from "./sessionKey";

/** Live engine state for the KV-session files; getters, not a snapshot, so a read cannot outlive a dispose. */
export interface ChatKvSessionState {
  readonly context: LlamaContext | null;
  readonly disposing: boolean;
  readonly activeGovernorActive: boolean;
  readonly activeModelId: string | null;
  readonly activeModelFileId: string | undefined;
  readonly activeEngineBuild: string | undefined;
  readonly activeEngineCtx: number;
  readonly activeCacheTypeK: string | null;
  readonly activeCacheTypeV: string | null;
  readonly activeEngineKnob: string | undefined;
  readonly activeMtpNMax: number | undefined;
  readonly activeSpecType: string | undefined;
  readonly kvReproState: KvReproState;

  lastChatNPast: number | undefined;
  lastPromptEnvHash: string | undefined;
  lastSuccessfulSessionSave: SessionSaveFingerprint | null;
  bakedUserTails: BakedUserTail[];
  kvHoldsChatSession: boolean;
  chatKvDiskCurrent: boolean;
  lastAssembleBoundary: number | undefined;

  bakeUnprefixedHealed: boolean;
  lastAssembleConvId: string | undefined;
  attemptedAssembleStart: number | undefined;
  attemptedAssembleConvId: string | undefined;
  lastCompletionPromptEnvHash: string | undefined;
  lastCompletionPromptEnvInputs: PromptEnvInputs | undefined;

  withLifecycleLock<T>(fn: () => Promise<T>): Promise<T>;
  withEngineJob<T>(fn: () => Promise<T>): Promise<T>;
  dropHoldAfterOptionalNativeClear(engine: LlamaContext | null): Promise<boolean>;
  isContextPoisoned(): boolean;
}
