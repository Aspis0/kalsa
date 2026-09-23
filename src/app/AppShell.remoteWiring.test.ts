/**
 * Source pins for AppShell's remote wiring (step 2).
 *
 * These are LINE-LEVEL pins, not behaviour tests: AppShell cannot be rendered
 * under node jest, so each pin asserts the wiring text is present, in order,
 * and that the wrapped engine names no longer come from LlamaService. They go
 * red if a hunk is reverted; they do NOT prove runtime behaviour (see
 * STEP2.md's untested-wiring list for what only a rendering test could pin).
 */
import { readFileSync } from "fs";
import { join } from "path";

const shell = readFileSync(join(__dirname, "AppShell.tsx"), "utf8");

describe("AppShell remote wiring (source pins)", () => {
  test("engine calls are imported through the facade, not LlamaService", () => {
    expect(shell).toContain('} from "../engine/engineBackend";');
    const llamaImport = shell.match(
      /import \{([\s\S]*?)\} from "\.\.\/engine\/LlamaService";/,
    );
    expect(llamaImport).not.toBeNull();
    const llamaNames = llamaImport![1];
    for (const wrapped of [
      "streamAssistantTurn",
      "initEngine",
      "disposeEngine",
      "isEngineReady",
      "extractMemory",
      "completeOnce",
      "translateText",
      "saveEngineSession",
    ]) {
      expect(llamaNames).not.toMatch(new RegExp(`\\b${wrapped}\\b`));
    }
    // Main-new locals stay on LlamaService (RECON hunk #2).
    for (const kept of ["buildSystemPrompt", "chatKvNPast", "logPrewarmSkip"]) {
      expect(llamaNames).toMatch(new RegExp(`\\b${kept}\\b`));
    }
  });

  test("boot graft: remote decision first, death-marker pick on the local id only", () => {
    expect(shell).toContain("hydrateRemoteBrainSettings()");
    expect(shell).toContain("decideRemoteBoot({");
    expect(shell).toContain("await recoverLocalBackend();");
    expect(shell.indexOf("decideRemoteBoot({")).toBeLessThan(
      shell.indexOf("pickStartModel({"),
    );
    expect(shell).toContain('t("settings.remoteBrainMigratedToLocal")');
  });

  test("selection flow routes the remote id to selectRemoteComputer", () => {
    expect(shell).toContain("const selectRemoteComputer = useCallback(");
    expect(shell).toContain("if (modelId === REMOTE_COMPUTER_MODEL_ID) {");
    expect(shell).toMatch(
      /if \(modelId === REMOTE_COMPUTER_MODEL_ID\) \{\s*\n\s*selectRemoteComputer\(\);/,
    );
    // The current model follows the backend, so sends ensure the remote engine.
    expect(shell).toContain(
      "const currentModel = remoteActive ? REMOTE_COMPUTER_MODEL : MODEL_REGISTRY[modelIndex];",
    );
    // Backend switch intents bracket both directions of the switch.
    expect(shell).toContain('beginBackendSwitch("local");');
    expect(shell).toContain('beginBackendSwitch("remote");');
    expect(shell).toContain("endBackendSwitch();");
  });

  test("tools are off for remote turns", () => {
    expect(shell).toContain("? { tools: undefined, executeTool: undefined }");
  });

  test("ready label names the backend", () => {
    expect(shell).toMatch(
      /isRemoteEngineBackend\(\)\s*\?\s*t\("download\.readyRemote"\)/,
    );
  });

  test("background embedding is gated on remote mode", () => {
    // Job entry: gated before any embedder download or extraction.
    expect(shell).toMatch(
      /if \(isRemoteEngineBackend\(\)\) return;\s*\n\s*if \(!entry\?\.id/,
    );
    // Mid-job: a gate sits directly above the native embed call.
    const embedCall = shell.indexOf("await embedDocumentChunk(");
    expect(embedCall).toBeGreaterThan(-1);
    const gate = shell.lastIndexOf("isRemoteEngineBackend()", embedCall);
    expect(gate).toBeGreaterThan(-1);
    expect(embedCall - gate).toBeLessThan(400);
    // Rebuild refuses before destroying the old index.
    expect(shell).toMatch(
      /if \(isRemoteEngineBackend\(\)\) \{\s*\n\s*return \{ ok: false, reason: "unavailable" \};/,
    );
  });
});
