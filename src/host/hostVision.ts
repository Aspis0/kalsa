/**
 * The vision verdict of whichever brain is answering, in the shapes the host
 * reads it: `liveCapable` is re-read at each attach notice (never captured —
 * a model switch or a desk restart must not leave a stale answer),
 * `sendCapable` is the render's answer the next send composes with, and
 * `remoteVision` is what the transcript draws — the same verdict the chip row
 * and the wire read: pictures ride the desk only while its own fresh verdict
 * says it can see.
 */
import { getRemoteVision } from "../engine/engineBackend";
import type { useHostEngine } from "./useHostEngine";

type ModelHost = ReturnType<typeof useHostEngine>["modelHost"];

export interface HostVision {
  liveCapable: () => boolean;
  sendCapable: boolean;
  remoteVision: boolean;
}

export function hostVision(modelHost: ModelHost): HostVision {
  return {
    liveCapable: () =>
      modelHost.remoteActiveRef.current
        ? getRemoteVision()
        : Boolean(modelHost.currentModel.mmproj),
    sendCapable: modelHost.remoteActive
      ? getRemoteVision()
      : Boolean(modelHost.currentModel.mmproj),
    remoteVision: modelHost.remoteActive ? getRemoteVision() : false,
  };
}
