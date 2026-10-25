import type { ReactNode } from "react";
import { useLanguage } from "../i18n/useLanguage";

/** The square and its three steps (mockups 09-phones-square, 09-phones-loading):
    the code on the left, what to do on the right, and the way to add someone
    who is not at home. */
export function PhonesSquare({
  qrSvg,
  sentence,
  note,
  fresh,
  tailscale,
  invitePanel,
}: {
  /** The ceremony's square as SVG, generated on this machine; null while it is drawn. */
  qrSvg: string | null;
  sentence: string;
  note: string | null;
  fresh: string | null;
  tailscale: string | null;
  invitePanel: ReactNode;
}) {
  const { table } = useLanguage();
  const t = table.devices;
  return (
    <div className="phones-square">
      <div className="phones-qr-card">
        {qrSvg ? (
          <div className="surface-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        ) : (
          <div className="phones-wait">
            <span className="phones-spin" aria-hidden="true" />
            <p className="surface-sentence">{sentence}</p>
          </div>
        )}
      </div>
      <div className="phones-side">
        {/* The camera line is step two itself once the square is drawn,
            so the sentence is said once, in its place. */}
        <ol className="phones-steps">
          <li>{t.stepOpen}</li>
          <li>
            {qrSvg ? <p className="surface-sentence">{sentence}</p> : <p>{t.cameraInstruction}</p>}
            {note ? <p className="surface-quiet">{note}</p> : null}
          </li>
          <li>{t.stepAllow}</li>
        </ol>
        {fresh && (fresh === "expired" || fresh === "wrong-code") ? (
          <p className="surface-quiet">{fresh === "expired" ? t.freshExpired : t.freshWrongCode}</p>
        ) : null}
        {tailscale ? <p className="surface-quiet">{tailscale}</p> : null}
        <div className="phones-invite-box">
          <p className="phones-invite-title">{t.someoneNotAtHome}</p>
          <p className="phones-note">{t.someoneNotAtHomeBody}</p>
          {invitePanel}
        </div>
      </div>
    </div>
  );
}
