/**
 * The built envelope, as `normalizeMiniapp` returns it. `blocks` is open on
 * purpose: every rendered block is a plain record, and the normalizer is the
 * one place that bounds what may be in it.
 */
export interface Miniapp {
  schema: "miniapp_v1";
  kind: string;
  title: string;
  blocks: Array<Record<string, unknown>>;
  actions?: Array<Record<string, unknown>>;
  computed?: Record<string, unknown>;
  state?: Record<string, unknown>;
  navigation?: Record<string, unknown>;
  interaction?: Record<string, unknown>;
}
