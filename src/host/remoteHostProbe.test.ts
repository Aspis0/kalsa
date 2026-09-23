import { decideRemoteHostProbe } from "./remoteHostProbe";
import { modelSwitchInFlightRef, notifyModelSwitchSettled, subscribeModelSwitchSettled } from "./modelSwitchState";
import { readFileSync } from "fs";
import { join } from "path";

const SCAN = readFileSync(join(__dirname, "usePipelineScans.ts"), "utf8");
const SWITCH = readFileSync(join(__dirname, "modelSwitch.ts"), "utf8");
const REMOTE_SWITCH = readFileSync(join(__dirname, "remoteModelTransition.ts"), "utf8");

describe("host model probing follows backend intent across a switch", () => {
  beforeEach(() => {
    modelSwitchInFlightRef.current = false;
  });

  test("the live switch blocks probing, then settling resumes the matching backend", () => {
    let probeRevision = 0;
    const unsubscribe = subscribeModelSwitchSettled(() => { probeRevision += 1; });
    modelSwitchInFlightRef.current = true;
    const whileSwitching = decideRemoteHostProbe({
      prefsReady: true,
      switchInFlight: modelSwitchInFlightRef.current,
      backendRemote: false,
      remoteActive: true,
      remoteReady: false,
    });
    expect(whileSwitching).toBe("skip");

    modelSwitchInFlightRef.current = false;
    notifyModelSwitchSettled();
    expect(probeRevision).toBe(1);
    expect(decideRemoteHostProbe({
      prefsReady: true,
      switchInFlight: modelSwitchInFlightRef.current,
      backendRemote: false,
      remoteActive: false,
      remoteReady: false,
    })).toBe("probe-local");
    expect(SCAN).toContain("decideRemoteHostProbe({");
    expect(SCAN).toContain('if (probeAction === "skip") return;');
    expect(SCAN).toContain("subscribeModelSwitchSettled(");
    expect(SWITCH).toContain("notifyModelSwitchSettled();");
    expect(REMOTE_SWITCH).toContain("notifyModelSwitchSettled();");
    unsubscribe();
  });

  test("hydration gates both sides and a remote intent never starts a local probe", () => {
    expect(decideRemoteHostProbe({
      prefsReady: false,
      switchInFlight: false,
      backendRemote: false,
      remoteActive: true,
      remoteReady: false,
    })).toBe("skip");
    expect(decideRemoteHostProbe({
      prefsReady: true,
      switchInFlight: false,
      backendRemote: true,
      remoteActive: true,
      remoteReady: false,
    })).toBe("ensure-remote");
    expect(decideRemoteHostProbe({
      prefsReady: true,
      switchInFlight: false,
      backendRemote: true,
      remoteActive: true,
      remoteReady: true,
    })).toBe("skip");
    expect(decideRemoteHostProbe({
      prefsReady: true,
      switchInFlight: false,
      backendRemote: true,
      remoteActive: false,
      remoteReady: false,
    })).toBe("skip");
    expect(SCAN).toContain('if (probeAction === "ensure-remote") {');
    expect(SCAN).toContain("ensureEngineForModelRef.current(REMOTE_COMPUTER_MODEL)");
  });
});
