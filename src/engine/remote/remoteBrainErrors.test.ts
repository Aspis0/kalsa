import { humanRemoteBrainError } from "./remoteBrainErrors";

const t = (key: string, vars?: Record<string, string>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key;

describe("humanRemoteBrainError", () => {
  test("maps known codes to i18n keys, never the raw code", () => {
    expect(humanRemoteBrainError("remote_brain_https_required", t)).toBe(
      "settings.remoteBrainHttpsRequired",
    );
    expect(humanRemoteBrainError("remote_brain_token_required", t)).toBe(
      "settings.remoteBrainTokenRequired",
    );
    expect(humanRemoteBrainError("remote_brain_url_missing", t)).toBe(
      "settings.remoteBrainUrlMissing",
    );
    expect(humanRemoteBrainError("invalid_scheme", t)).toBe(
      "settings.remoteBrainUrlInvalid",
    );
    expect(humanRemoteBrainError("remote_brain_https_required", t)).not.toContain(
      "remote_brain_",
    );
  });

  test("unknown snake_case codes become generic, not interpolated", () => {
    expect(humanRemoteBrainError("remote_brain_http_302", t)).toBe(
      "settings.remoteBrainFailGeneric",
    );
    expect(humanRemoteBrainError(undefined, t)).toBe(
      "settings.remoteBrainFailGeneric",
    );
  });
});
