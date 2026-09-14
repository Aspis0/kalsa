import { humanRemoteBrainError, isInternalErrorCode } from "./remoteBrainErrors";

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
    expect(humanRemoteBrainError("remote_brain_unknown_code", t)).toBe(
      "settings.remoteBrainFailGeneric",
    );
    expect(humanRemoteBrainError(undefined, t)).toBe(
      "settings.remoteBrainFailGeneric",
    );
  });

  test("transport failures get actionable copy, never the status code", () => {
    expect(humanRemoteBrainError("remote_brain_network", t)).toBe(
      "settings.remoteBrainFailNetwork",
    );
    expect(humanRemoteBrainError("remote_brain_send", t)).toBe(
      "settings.remoteBrainFailNetwork",
    );
    expect(humanRemoteBrainError("remote_brain_timeout", t)).toBe(
      "settings.remoteBrainFailTimeout",
    );
    expect(humanRemoteBrainError("remote_brain_busy", t)).toBe(
      "settings.remoteBrainFailBusy",
    );
    expect(humanRemoteBrainError("remote_brain_stale_init", t)).toBe(
      "settings.remoteBrainFailNetwork",
    );
    expect(humanRemoteBrainError("remote_brain_http_500", t)).toBe(
      'settings.remoteBrainFailServer:{"status":"500"}',
    );
  });

  test("isInternalErrorCode flags machine codes and spares user copy", () => {
    expect(isInternalErrorCode("remote_brain_network")).toBe(true);
    expect(isInternalErrorCode("remote_brain_http_500")).toBe(true);
    expect(isInternalErrorCode("context_full")).toBe(true);
    expect(
      isInternalErrorCode("Couldn't reach the AI service. Please try again."),
    ).toBe(false);
    expect(isInternalErrorCode("settings.remoteBrainUrlMissing")).toBe(false);
    expect(isInternalErrorCode("Reply stopped at the token limit.")).toBe(false);
  });

  test("a native exception is never echoed to the user", () => {
    const shown = humanRemoteBrainError(
      "fetch failed: java.net.ConnectException: Failed to connect to /127.0.0.1:8000",
      t,
    );
    expect(shown).toBe("settings.remoteBrainFailGeneric");
    expect(shown).not.toContain("java.net");
    expect(shown).not.toContain("fetch failed");
  });
});
