import { REMOTE_COMPUTER_MODEL_ID } from "./remote/remoteComputerModel";
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

  test("send-claimed + select remote computer is deferred, not executed immediately", () => {
    sendClaimRef.current = true;
    expect(deferModelSwitchIfSendClaimed(REMOTE_COMPUTER_MODEL_ID)).toBe(true);
    expect(pendingModelSwitchQueue).toEqual([REMOTE_COMPUTER_MODEL_ID]);
    expect(drainPendingModelSwitch()).toBe(REMOTE_COMPUTER_MODEL_ID);
    expect(pendingModelSwitchQueue).toEqual([]);
  });

  test("Remote-computer button uses selectModelById so send-claim defers like a local switch", () => {
    sendClaimRef.current = true;
    let executed: string | null = null;
    const selectModelById = (id: string) => {
      if (deferModelSwitchIfSendClaimed(id)) return;
      executed = id;
    };
    selectModelById(REMOTE_COMPUTER_MODEL_ID);
    expect(executed).toBeNull();
    expect(pendingModelSwitchQueue).toEqual([REMOTE_COMPUTER_MODEL_ID]);
    pendingModelSwitchQueue.length = 0;
    selectModelById("qwen-local");
    expect(executed).toBeNull();
    expect(pendingModelSwitchQueue).toEqual(["qwen-local"]);
  });

  test("without a send claim the remote computer proceeds immediately", () => {
    sendClaimRef.current = false;
    expect(deferModelSwitchIfSendClaimed(REMOTE_COMPUTER_MODEL_ID)).toBe(false);
    expect(pendingModelSwitchQueue).toEqual([]);
  });
});
