import {
  getActiveModelId,
  initEngine,
  isEngineReady,
} from "../engine/engineBackend";
import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import { hostEngineErrorText } from "./remoteEngineError";
import type { Locale, TranslateFn } from "../i18n";
import type { ModelPipelineState } from "../app/AppShell";

export async function ensureRemoteHostModel(input: {
  locale: Locale;
  t: TranslateFn;
  generationRef: { current: number };
  modelStateRef: { current: ModelPipelineState };
  setModelState: (state: ModelPipelineState) => void;
  setModelError: (message: string | null) => void;
  setModelErrorKind: (kind: "engine" | null) => void;
  setModelErrorDetail: (detail: string | null) => void;
  setChatEngineCtx: (ctx: number) => void;
  chatEngineCtxRef: { current: number };
  remoteErrorRef: { current: string | null };
}): Promise<boolean> {
  const generation = input.generationRef.current;
  if (isEngineReady() && getActiveModelId() === REMOTE_COMPUTER_MODEL_ID) {
    input.remoteErrorRef.current = null;
    input.setModelState("ready");
    return true;
  }
  input.modelStateRef.current = "loading";
  input.setModelState("loading");
  input.setModelError(null);
  input.setModelErrorKind(null);
  input.setModelErrorDetail(null);
  input.remoteErrorRef.current = null;
  try {
    const result = await initEngine("", REMOTE_COMPUTER_MODEL_ID, {
      locale: input.locale,
      backend: "remote",
    });
    if (generation !== input.generationRef.current) return false;
    input.chatEngineCtxRef.current = result.effectiveNCtx;
    input.setChatEngineCtx(result.effectiveNCtx);
    input.modelStateRef.current = "ready";
    input.remoteErrorRef.current = null;
    input.setModelState("ready");
    return true;
  } catch (error) {
    if (generation !== input.generationRef.current) return false;
    const message = error instanceof Error ? error.message : String(error);
    input.modelStateRef.current = "error";
    input.setModelState("error");
    input.setModelErrorKind("engine");
    const humanError = hostEngineErrorText(message, true, input.t);
    input.remoteErrorRef.current = humanError;
    input.setModelError(humanError);
    input.setModelErrorDetail(null);
    return false;
  }
}
