// One screen, one switch. Everything it knows comes from the supervisor's
// state: the webview never decides whether the server is up.

const status = document.getElementById("status");
const detail = document.getElementById("detail");
const toggle = document.getElementById("toggle");

const POLL_MS = 1000;

function render(state) {
  switch (state.kind) {
    case "stopped":
      status.textContent = "Off";
      detail.textContent = "";
      toggle.textContent = "Turn on";
      toggle.disabled = false;
      break;
    case "starting":
      status.textContent = "Starting…";
      detail.textContent = "Loading the model. This can take a minute on an old computer.";
      toggle.textContent = "Starting…";
      toggle.disabled = true;
      break;
    case "running":
      status.textContent = "On";
      detail.textContent = `Listening on 127.0.0.1:${state.port}`;
      toggle.textContent = "Turn off";
      toggle.disabled = false;
      break;
    case "failed":
      status.textContent = "Stopped";
      detail.textContent = state.reason;
      toggle.textContent = "Try again";
      toggle.disabled = false;
      break;
    default:
      status.textContent = "Unknown";
      detail.textContent = "";
      toggle.disabled = true;
  }
}

async function refresh() {
  try {
    render(await window.__TAURI__.core.invoke("brain_state"));
  } catch (error) {
    status.textContent = "Unknown";
    detail.textContent = String(error);
  }
}

toggle.addEventListener("click", async () => {
  toggle.disabled = true;
  try {
    const state = await window.__TAURI__.core.invoke("brain_state");
    if (state.kind === "running" || state.kind === "starting") {
      await window.__TAURI__.core.invoke("brain_stop");
    } else {
      await window.__TAURI__.core.invoke("brain_start");
    }
  } catch (error) {
    status.textContent = "Stopped";
    detail.textContent = String(error);
  }
  await refresh();
});

refresh();
setInterval(refresh, POLL_MS);
