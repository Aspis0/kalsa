import { useState } from "react";
import type { Engine } from "../types";
import { megabytes } from "./format";
import { knownSize, sizeWarning } from "./modelWarning";
import { useLocalSize } from "./useLocalSize";

/** Which model to run: a short suggested list, or any Hugging Face id or local path. Starting is never blocked by size. */
export function ModelPicker({ engine, ramBytes, onStart }: { engine: Engine; ramBytes: number; onStart: (model: string) => void }) {
  const suggested = engine.suggestedModels;
  const [chosen, setChosen] = useState(0);
  const [typed, setTyped] = useState("");
  const entry = typed.trim() || suggested[chosen]?.id || "";
  const localSize = useLocalSize(entry);
  const warning = sizeWarning(knownSize(entry, suggested, localSize), ramBytes);

  return (
    <>
      <p className="run-ask">Choose a model to run. Kalsa downloads it the first time you start.</p>
      {suggested.length ? (
        <div className="run-opts" role="radiogroup" aria-label="Suggested models">
          {suggested.map((model, index) => (
            <button
              key={model.id}
              type="button"
              role="radio"
              aria-checked={!typed.trim() && chosen === index}
              className="run-opt"
              onClick={() => { setTyped(""); setChosen(index); }}
            >
              <span className="run-radio" aria-hidden="true" />
              <span><b>{model.id}</b><span>{model.note}{model.sizeBytes ? `, ${megabytes(model.sizeBytes)} to download` : ""}</span></span>
            </button>
          ))}
        </div>
      ) : null}
      <label className="run-field" htmlFor="run-model">Any Hugging Face model id or a local file/folder</label>
      <input
        id="run-model"
        className="run-input"
        type="text"
        value={typed}
        placeholder={`owner/model, or a full path such as /Users/you/models/${engine.id === "llama-cpp" ? "model.gguf" : "model-folder"}`}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setTyped(event.target.value)}
      />
      <p className="run-hint">Kalsa passes it to {engine.name} as you typed it. It does not curate or block models.</p>
      {warning ? <div className="run-warn" role="status"><b>This looks much bigger than this Mac’s memory.</b><br />{warning}</div> : null}
      <div className="run-acts">
        <button type="button" className="run-btn" disabled={!entry} onClick={() => onStart(entry)}>Start</button>
        {entry ? <span className="run-hint inline">{entry}</span> : null}
      </div>
    </>
  );
}
