/** Pipeline states shared by the host, its overlays, and settings screens. */
export type ModelPipelineState =
  | "checking"
  | "missing"
  | "downloading"
  | "loading"
  | "ready"
  | "error";

/** Voice ASR asset state; this does not imply an LLM load. */
export type VoicePipelineState =
  | "checking"
  | "missing"
  | "downloading"
  | "ready"
  | "error";

/** Optional embedding-model asset state; this does not imply a chat load. */
export type EmbeddingPipelineState =
  | "checking"
  | "missing"
  | "downloading"
  | "ready"
  | "error";
