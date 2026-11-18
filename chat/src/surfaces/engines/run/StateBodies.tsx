import type { EngineStatus } from "./types";
import { LogTail } from "./LogTail";

export function StartingBody({ status }: { status: EngineStatus | null }) {
  return (
    <>
      <p className="run-prog"><b>Downloading the model, then loading it</b></p>
      <div className="run-track ind" role="progressbar" aria-label="Starting"><i /></div>
      <p className="run-hint">The first start downloads the model from Hugging Face, so it can take a while. Later starts load it from disk.</p>
      <LogTail lines={status?.logTail ?? []} open />
    </>
  );
}

export function RunningBody({ status, model }: { status: EngineStatus; model: string | null }) {
  return (
    <>
      <div className="run-facts">
        {model ? <div><span>Model</span><b>{model}</b></div> : null}
        <div><span>Address</span><b>127.0.0.1:{status.port ?? "?"}</b></div>
        <div><span>Reachable from</span><b>This Mac only</b></div>
      </div>
      <p className="run-hint">tok/s will be measured in chat, with this model on this Mac.</p>
      <LogTail lines={status.logTail} />
    </>
  );
}

export function FailureBody({ headline, detail, lines }: { headline: string; detail: string; lines: string[] }) {
  return (
    <>
      <div className="run-errbox" role="alert"><b>{headline}</b><br />{detail}</div>
      <LogTail lines={lines} open />
    </>
  );
}
