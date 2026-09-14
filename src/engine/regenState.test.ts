import { REMOTE_MAC_MODEL_ID } from "./remote/remoteMacModel";
import {
  deferModelSwitchIfSendClaimed,
  drainPendingModelSwitch,
  pendingModelSwitchQueue,
  sendClaimRef,
} from "./regenState";

describe("deferModelSwitchIfSendClaimed", () => {
  afterEach(() => {
    sendClaimRef.current = false;
    pendingModelSwitchQueue.length = 0;
  });

  test("send-claimed + select Mac is deferred, not executed immediately", () => {
    sendClaimRef.current = true;
    expect(deferModelSwitchIfSendClaimed(REMOTE_MAC_MODEL_ID)).toBe(true);
    expect(pendingModelSwitchQueue).toEqual([REMOTE_MAC_MODEL_ID]);
    expect(drainPendingModelSwitch()).toBe(REMOTE_MAC_MODEL_ID);
    expect(pendingModelSwitchQueue).toEqual([]);
  });

  test("without a send claim Mac proceeds immediately", () => {
    sendClaimRef.current = false;
    expect(deferModelSwitchIfSendClaimed(REMOTE_MAC_MODEL_ID)).toBe(false);
    expect(pendingModelSwitchQueue).toEqual([]);
  });
});
