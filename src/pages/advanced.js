// The advanced panel exposes the small set of safe launch controls. Values
// are read from Rust's launch description, and edits are sent back to the
// same command that builds the supervisor argv.

import { available, invoke } from "../lib/tauri.js";

const tauriBackend = {
  read() {
    if (!available()) return Promise.resolve(null);
    return invoke("brain_advanced");
  },
  save(contextTokens, idleUnloadSeconds, internetRoad) {
    return invoke("brain_set_advanced", {
      contextTokens,
      idleUnloadSeconds,
      internetRoad,
    });
  },
};

function numberOrNull(value, label) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (Number.isInteger(number)) return number;
  throw new Error(`${label} must be a whole number.`);
}

function show(value) {
  return value === null || value === undefined ? "automatic" : String(value);
}

export function mountAdvanced(root, { backend = tauriBackend } = {}) {
  root.innerHTML = `
    <div class="advanced-panel">
      <p class="eyebrow">ADVANCED</p>
      <p class="section-title">Server settings</p>
      <button type="button" class="secondary advanced-toggle" data-el="toggle" aria-expanded="false">Show settings</button>
      <div class="advanced-body" data-el="body" hidden></div>
    </div>
  `;
  const toggle = root.querySelector('[data-el="toggle"]');
  const body = root.querySelector('[data-el="body"]');
  let dto = null;
  let open = false;
  let dirty = false;
  let focused = false;
  let view = null;

  function drawBody() {
    body.innerHTML = `
      <p class="advanced-note" data-el="note"></p>
      <label class="field"><span class="field-label">Context size</span><input type="number" data-el="context" min="512" max="32768" step="512" placeholder="Automatic" /></label>
      <p class="field-help" data-el="context-help"></p>
      <label class="field"><span class="field-label">Unload after idle</span><input type="number" data-el="idle" min="60" max="3600" step="60" /></label>
      <p class="field-help">Between 60 seconds and 1 hour, so an ordinary pause does not reload the model.</p>
      <label class="field"><span class="field-label">Internet road</span><input type="checkbox" data-el="road" /></label>
      <p class="field-help" data-el="road-help"></p>
      <p class="effective-values" data-el="effective"></p>
      <p class="field-help" data-el="door"></p>
      <p class="field-help" data-el="iroh"></p>
      <button type="button" class="primary" data-el="save">Save settings</button>
      <p class="feedback" data-el="feedback" hidden></p>
    `;
    const context = body.querySelector('[data-el="context"]');
    const idle = body.querySelector('[data-el="idle"]');
    const road = body.querySelector('[data-el="road"]');
    const roadHelp = body.querySelector('[data-el="road-help"]');
    const note = body.querySelector('[data-el="note"]');
    const contextHelp = body.querySelector('[data-el="context-help"]');
    const effective = body.querySelector('[data-el="effective"]');
    const door = body.querySelector('[data-el="door"]');
    const iroh = body.querySelector('[data-el="iroh"]');
    const save = body.querySelector('[data-el="save"]');
    const feedback = body.querySelector('[data-el="feedback"]');
    view = { context, idle, road, roadHelp, note, contextHelp, effective, door, iroh, save, feedback };
    for (const input of [context, idle, road]) {
      input.addEventListener("input", () => {
        dirty = true;
      });
      input.addEventListener("focus", () => {
        focused = true;
      });
      input.addEventListener("blur", () => {
        focused = false;
      });
    }

    renderBody();

    save.addEventListener("click", async () => {
      view.feedback.hidden = true;
      view.save.disabled = true;
      try {
        const saved = await backend.save(
          numberOrNull(view.context.value, "Context size"),
          numberOrNull(view.idle.value, "Idle time"),
          view.road.checked,
        );
        dto = saved;
        dirty = false;
        renderBody();
        view.feedback.hidden = false;
        view.feedback.textContent = "Saved for the next start.";
      } catch (error) {
        view.feedback.hidden = false;
        view.feedback.textContent = String(error);
        view.save.disabled = false;
      }
    });
  }

  function renderBody() {
    if (!view) return;
    if (!dto) {
      view.note.textContent = "These settings are available inside the Kalsa Brain app.";
      view.contextHelp.textContent = "The app will read the machine before choosing a value.";
      view.effective.textContent = "The values in force will appear here when the app is open.";
      view.door.textContent = "The local door is waiting for the server to run.";
      view.iroh.textContent = "The internet road is waiting for the server to run.";
      view.road.checked = false;
      view.save.hidden = true;
      return;
    }
    if (!dirty && !focused) {
      view.context.value = dto.context_override ?? "";
      view.idle.value = dto.idle_override ?? dto.idle_unload_seconds ?? "";
      view.road.checked = dto.internet_road ?? false;
    }
    view.roadHelp.textContent =
      "Opens a second way in over the internet: this computer announces itself on a public directory service, so the phone can find it without Tailscale. The door stays password-checked. Off is the default.";
    view.note.textContent = dto.running
      ? "The current server stays as it is. Changes apply next time you turn on."
      : "Changes apply next time you turn on.";
    view.contextHelp.textContent = dto.context_max
      ? `Automatic is up to ${dto.context_max}. A smaller value uses less memory.`
      : "Automatic uses the value chosen for this computer.";
    const valuesLabel = dto.running ? "In force" : "Next start";
    view.effective.textContent = `${valuesLabel}: context ${show(dto.context_tokens)}; batch ${show(dto.batch_size)}; micro-batch ${show(dto.ubatch_size)}; KV ${show(dto.kv_cache_type)}; flash attention ${show(dto.flash_attention)}; GPU layers ${show(dto.gpu_layers)}; threads ${show(dto.threads)}; idle unload ${show(dto.idle_unload_seconds)} seconds.`;
    view.door.textContent = dto.door_port
      ? `Local door: ${dto.door_port}. Run for Tailscale: tailscale serve ${dto.door_port}`
      : "The local door is waiting for the server to run.";
    view.iroh.textContent = dto.iroh_sentence ?? "";
    view.save.hidden = false;
  }

  function setOpen(value) {
    open = value;
    body.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Hide settings" : "Show settings";
    if (open) {
      dirty = false;
      focused = false;
      drawBody();
    }
  }

  async function refresh() {
    try {
      dto = await backend.read();
    } catch {
      if (!open) dto = null;
    }
    if (open) renderBody();
  }

  toggle.addEventListener("click", () => setOpen(!open));
  return { refresh, open: () => setOpen(true) };
}
