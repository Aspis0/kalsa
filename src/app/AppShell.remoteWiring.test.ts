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
const chat = readFileSync(join(__dirname, "../screens/AiChatPage.tsx"), "utf8");

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

  test("rebuild re-checks the backend with no await before the delete (race fix)", () => {
    // The preflights await twice; the only sync run into the delete must pass
    // through a fresh remote check.
    expect(shell).toMatch(
      /if \(isRemoteEngineBackend\(\)\) \{\s*\n\s*return \{ ok: false, reason: "unavailable" \};\s*\n\s*\}\s*\n\s*bumpEmbedJobGeneration\(\);\s*\n\s*await deleteVectorIndexFile\(id\);/,
    );
  });

  test("composer attach is gated in remote mode with the gated note", () => {
    const attach = chat.match(
      /const onComposerAttach = useCallback\(\(\) => \{([\s\S]*?)\}, \[/,
    );
    expect(attach).not.toBeNull();
    expect(attach![1]).toContain("isRemoteEngineBackend()");
    expect(attach![1]).toContain('showVoiceNote(t("settings.remoteGated"))');
  });

  test("stream errors humanize remote codes and leave everything else alone", () => {
    // Order-sensitive: an INVERTED ternary (raw first) must go red — that is
    // the N2 weakness this assertion was written for.
    expect(shell).toMatch(
      /error\.message\.startsWith\("remote_brain_"\)\s*\?\s*humanRemoteBrainError\(error\.message, t\)\s*:\s*error\.message/,
    );
    expect(shell).toContain("⚠️ ${shown}");
    expect(shell).not.toContain("⚠️ ${error.message}");
  });

  test("selectRemoteComputer humanizes its catch unconditionally", () => {
    // Every error out of the remote selection flow goes through
    // humanRemoteBrainError — no raw fallback branch left.
    expect(shell).toContain("setModelError(humanRemoteBrainError(raw, t))");
    expect(shell).not.toContain("humanRemoteBrainError(raw, t) : raw");
  });

  test("selectRemoteComputer refuses while a rebuild is in flight", () => {
    const selectRemote = shell.match(
      /const selectRemoteComputer = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/,
    );
    expect(selectRemote).not.toBeNull();
    expect(selectRemote![1]).toContain("semanticRebuildInFlight || isDeleteActive()");
  });

  test("boot does not overwrite the intent of a switch in flight (N1)", () => {
    expect(shell).toMatch(
      /decideRemoteBoot\(\{[\s\S]{0,900}?if \(modelSwitchInFlightRef\.current\) return;/,
    );
  });

  test("library chip, share path and file import are all gated in remote mode", () => {
    const docChip = chat.match(
      /const onComposerDocument = useCallback\(\(\) => \{([\s\S]*?)\}, \[/,
    );
    expect(docChip).not.toBeNull();
    expect(docChip![1]).toContain('showVoiceNote(t("settings.remoteGated"))');

    const shareAttach = chat.match(
      /const doc = attachLibraryDoc;([\s\S]{0,300}?)addLibraryDocumentAttachment/,
    );
    expect(shareAttach).not.toBeNull();
    expect(shareAttach![1]).toContain("isRemoteEngineBackend()");
    expect(shareAttach![1]).toContain('showVoiceNote(t("settings.remoteGated"))');

    const fileImport = chat.match(
      /const addPdfAttachment = useCallback\(async \(\) => \{([\s\S]*?)\}, \[/,
    );
    expect(fileImport).not.toBeNull();
    expect(fileImport![1]).toContain("isRemoteEngineBackend()");
    expect(fileImport![1]).toContain('showVoiceNote(t("settings.remoteGated"))');
  });

  test("remote ensure short-circuits when ready, before the loading flash", () => {
    const remoteBranch = shell.indexOf("if (captured.remote) {");
    expect(remoteBranch).toBeGreaterThan(-1);
    const shortCircuit = shell.indexOf(
      "isEngineReady() && getActiveModelId() === REMOTE_COMPUTER_MODEL_ID",
      remoteBranch,
    );
    const loading = shell.indexOf('setModelState("loading")', remoteBranch);
    expect(shortCircuit).toBeGreaterThan(remoteBranch);
    expect(shortCircuit).toBeLessThan(loading);
  });

  test("boot catch keeps main's read-only contract: no persistent write", () => {
    expect(shell).toContain("Preference read failure → keep the default boot model");
    // The regression shape: forcing the default back into storage on error.
    expect(shell).not.toContain("AsyncStorage.setItem(MODEL_STORAGE_KEY, getDefaultModel().id)");
    // Boot only persists the one real demotion (a stored remote id, no URL).
    expect(shell).toContain(
      'decision.reason === "orphan" && saved === REMOTE_COMPUTER_MODEL_ID',
    );
  });

  test("failure paths agree intent with the backend cache", () => {
    // Pre-IIFE throw ends the backend switch it began (the IIFE finally never runs).
    const preIife = shell.match(
      /\/\/ Also end the backend switch this path began[\s\S]{0,400}?endBackendSwitch\(\);[\s\S]{0,600}?throw error;/,
    );
    expect(preIife).not.toBeNull();
    // Remote→local flip that never landed: re-align to the remote cache and re-probe.
    const flipCatch = shell.match(
      /The flip to local never landed[\s\S]{0,900}?setPresenceProbeEpoch\(\(n\) => n \+ 1\);/,
    );
    expect(flipCatch).not.toBeNull();
    expect(flipCatch![0]).toContain("remote: true");
    expect(flipCatch![0]).toContain("setRemoteActive(true)");
    // Boot catch with a failing recovery aligns to the cache, not the default.
    const bootCatch = shell.match(
      /Preference read failure → keep the default boot model[\s\S]{0,900}?const cacheRemote = isRemoteEngineBackend\(\);[\s\S]{0,400}?setModelError\(t\("settings\.remoteBrainSaveFailed"\)\);/,
    );
    expect(bootCatch).not.toBeNull();
    // The model-id write surfaces a lost write instead of staying silent.
    const idWrite = shell.match(
      /AsyncStorage\.setItem\(MODEL_STORAGE_KEY, MODEL_REGISTRY\[nextIndex\]\.id\)\.catch\(\(\) => \{[\s\S]{0,300}?showNotice\(t\("settings\.remoteBrainSaveFailed"\)\);/,
    );
    expect(idWrite).not.toBeNull();
  });
});
