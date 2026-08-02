/**
 * Engine locale — Fase 0: stub. In Fase 1 il corpo di `streamAssistantTurn`
 * viene sostituito da llama.rn (binding llama.cpp, MIT):
 *
 *   import { initLlama } from "llama.rn";
 *   const context = await initLlama({ model, useMetal: true }); // iOS
 *   await context.generate({ messages, onToken });
 *
 * L'interfaccia non cambia: i chiamanti (chat + Ask AI) restano identici.
 */

export type EngineMessage = {
  role: "user" | "assistant";
  content: string;
};

export type EngineCallbacks = {
  onDelta: (delta: string, full: string) => void;
  onStatus?: (status: { label: string }) => void;
  onTool?: (tool: unknown) => void;
  onSources?: (sources: unknown[]) => void;
  onMiniapp?: (miniapp: unknown) => void;
  onDone: () => void;
  onError: (error: Error) => void;
};

export function streamAssistantTurn(
  messages: EngineMessage[],
  callbacks: EngineCallbacks,
  signal?: AbortSignal,
): void {
  const lastUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const words = `[Local engine — Phase 1]. You said: ${lastUser}`.split(" ");

  let index = 0;
  let finished = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const finish = () => {
    if (finished) return;
    finished = true;
    callbacks.onDone();
  };

  const tick = () => {
    if (finished || signal?.aborted) return;
    if (index >= words.length) {
      finish();
      return;
    }
    const chunk = `${words[index]} `;
    const full = words.slice(0, index + 1).join(" ");
    callbacks.onDelta(chunk, full);
    index += 1;
    timers.push(setTimeout(tick, 60));
  };

  // Contratto: QUALSIASI uscita (fine, errore, abort) deve risolvere i
  // chiamanti esattamente una volta. Su abort puliamo i timer e chiudiamo
  // con onDone (la UI interrompe lo streaming e sblocca il composer).
  signal?.addEventListener(
    "abort",
    () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.length = 0;
      finish();
    },
    { once: true },
  );

  if (signal?.aborted) {
    finish();
    return;
  }

  callbacks.onStatus?.({ label: "Thinking locally" });
  timers.push(setTimeout(tick, 420));
}
