/**
 * The three vision shapes the root hands out must follow the answering brain:
 * the live reader tracks the ref (a connect after the render is seen at the
 * next notice), while the send's and the transcript's copies hold the render's
 * answer. Local mode reads the phone's own mmproj and never asks the desk.
 */
import { getRemoteVision } from "../engine/engineBackend";
import { hostVision } from "./hostVision";

jest.mock("../engine/engineBackend", () => ({ getRemoteVision: jest.fn() }));

type ModelHost = Parameters<typeof hostVision>[0];

const modelHost = (input: {
  remoteActive: boolean;
  mmproj?: string;
  ref?: { current: boolean };
}): ModelHost =>
  ({
    remoteActive: input.remoteActive,
    remoteActiveRef: input.ref ?? { current: input.remoteActive },
    currentModel: { mmproj: input.mmproj },
  }) as unknown as ModelHost;

const remoteSees = getRemoteVision as jest.Mock;

beforeEach(() => remoteSees.mockReset());

test("local mode reads the phone's own mmproj and never asks the desk", () => {
  const withVision = hostVision(modelHost({ remoteActive: false, mmproj: "mmproj.gguf" }));
  expect(withVision.liveCapable()).toBe(true);
  expect(withVision.sendCapable).toBe(true);
  expect(withVision.remoteVision).toBe(false);
  expect(remoteSees).not.toHaveBeenCalled();

  const textOnly = hostVision(modelHost({ remoteActive: false }));
  expect(textOnly.liveCapable()).toBe(false);
  expect(textOnly.sendCapable).toBe(false);
  expect(textOnly.remoteVision).toBe(false);
});

test("remote mode reads the desk's own verdict in all three shapes", () => {
  remoteSees.mockReturnValue(true);
  const sees = hostVision(modelHost({ remoteActive: true }));
  expect(sees.liveCapable()).toBe(true);
  expect(sees.sendCapable).toBe(true);
  expect(sees.remoteVision).toBe(true);
  expect(remoteSees).toHaveBeenCalledTimes(3);

  // A local mmproj must not leak into the remote verdicts.
  remoteSees.mockReturnValue(false);
  const blind = hostVision(modelHost({ remoteActive: true, mmproj: "mmproj.gguf" }));
  expect(blind.liveCapable()).toBe(false);
  expect(blind.sendCapable).toBe(false);
  expect(blind.remoteVision).toBe(false);
});

test("the live reader follows a connect after the render; the other two do not", () => {
  remoteSees.mockReturnValue(true);
  const ref = { current: false };
  const vision = hostVision(modelHost({ remoteActive: false, ref }));
  expect(vision.liveCapable()).toBe(false);
  expect(vision.sendCapable).toBe(false);
  expect(vision.remoteVision).toBe(false);

  ref.current = true;
  expect(vision.liveCapable()).toBe(true);
  expect(vision.sendCapable).toBe(false);
  expect(vision.remoteVision).toBe(false);
});
