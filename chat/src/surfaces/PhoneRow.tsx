import { useState } from "react";
import type { CSSProperties } from "react";
import { Icon } from "../components/Icon";
import { useLanguage } from "../i18n/useLanguage";
import { codeSentence } from "../lib/rustText";
import type { PairedDevice } from "./pairingWords";
import { deviceName } from "./pairingWords";

/** How long an owner's name may be. The store cuts the same number of
    characters; this keeps the field from asking for more than can be kept. */
const NAME_LIMIT = 40;

// A button the row holds after one press. It is aria-disabled, not
// disabled: disabling it would drag the owner's focus to <body> the moment
// it is pressed, so it stays what it was — focusable, named, and inert
// until the store's answer releases it.
function HeldButton({
  held,
  onPress,
  primary = false,
  children,
}: {
  held: boolean;
  onPress: () => void;
  primary?: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      className={primary ? "btn-primary" : "btn-quiet"}
      aria-disabled={held}
      onClick={() => {
        if (!held) onPress();
      }}
    >
      {primary ? <Icon name="check" size={18} stroke={2.4} /> : null}
      {children}
    </button>
  );
}

/** One row of the Phones page (mockups 09-phones-*): a phone or this
    computer, its line, and the decision it is waiting for or its Remove. */
export function PhoneRow({
  device,
  request,
  connected,
  entering,
  active,
  decided,
  rowRef,
  style,
  onAllow,
  onForget,
  onDeny,
  onRename,
}: {
  device: PairedDevice;
  /** A pairing-again request riding this seat's row. */
  request: PairedDevice | undefined;
  /** The beat after Allow: the sentence and its checkmark hold the row for
      a moment, then it settles into the ordinary detail. */
  connected: boolean;
  entering: boolean;
  /** The door is serving this phone right now. */
  active: boolean;
  decided: ReadonlySet<number>;
  rowRef: (element: HTMLDivElement | null) => void;
  style: CSSProperties | undefined;
  onAllow: (actedId: number, rowId: number) => void;
  onForget: (id: number) => void;
  onDeny: (id: number) => void;
  /** The owner's name for this phone, or null to give it back its number. */
  onRename: (id: number, name: string | null) => void;
}) {
  const { table, tag } = useLanguage();
  const t = table.devices;
  // The row's own rename, held here so it survives this page's poll: the
  // rows are redrawn from the store every two seconds, and a field that
  // closed itself on the next redraw would be a field nobody could type in.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // This computer's own record: named as it names itself, and with
  // no Forget. The button would take the app's own key to its own
  // door out of the store while the running door still holds it, so
  // the local chat would answer 401 until the next launch minted a
  // fresh one. The command refuses it too; the row simply does not
  // offer it.
  const host = device.kind === "host";
  // The stored label is minted in English by Rust ("This computer", "Paired
  // phone 2"), so a row that showed it would be English in every language. The
  // app words it instead — the same words the Phones page's sentence uses.
  const name = deviceName(t, device);
  // A row waiting for the owner's decision carries the wash —
  // a standing tint that survives reduced motion, since "needs
  // you" is information — and, when motion is allowed, a waiting
  // row that just arrived unfolds in: the reverse of the fold,
  // on the fold's own number, and pure motion, so reduced motion
  // draws no entrance and no beat.
  const needsOwner = !connected && (device.waiting === true || request !== undefined);
  /** Only a phone that has reached the house can be named: this computer's
      own record is not the owner's to rename (the store refuses it), and a
      row still waiting on Allow has not shown up in the house yet. */
  const canRename = !host && !needsOwner && request === undefined;

  /** What the field says, saved: empty takes the name back rather than
      storing a blank one, which is what the store would do with it anyway.
      Enter and a blur both commit — losing focus is leaving the field — and
      Escape leaves without changing anything, from the field and not from
      the page. */
  function commitRename(): void {
    if (!editing) return;
    const said = draft.trim();
    setEditing(false);
    if (said) {
      if (said !== name) onRename(device.id, said);
      return;
    }
    // Nothing typed where there was a name, nothing typed where there was
    // none: the first takes the name back, the second is not a rename.
    if (device.name) onRename(device.id, null);
  }
  const classes =
    "surface-device" +
    (needsOwner ? " is-waiting" : "") +
    (entering ? " is-entering" : "");
  return (
    <div className={classes} ref={rowRef} style={style}>
      <span className={connected || !needsOwner ? "phones-icon is-live" : "phones-icon"} aria-hidden="true">
        <Icon name={host ? "laptop" : "phone"} size={22} />
      </span>
      {active ? (
        <span className="surface-device-live" aria-hidden="true" />
      ) : null}
      {editing ? (
        <input
          className="surface-device-rename"
          autoFocus
          defaultValue={device.name ?? ""}
          placeholder={t.phoneNamePlaceholder}
          aria-label={t.renamePhone}
          maxLength={NAME_LIMIT}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename();
            if (event.key === "Escape") {
              // Leaves the rename, not the page.
              event.preventDefault();
              setEditing(false);
            }
          }}
          onBlur={commitRename}
        />
      ) : (
        <span className="surface-device-name">{name}</span>
      )}
      {/* The detail is the row's voice: the beat a screen reader
          hears land is the same sentence the owner reads. */}
      <span className="surface-device-detail" aria-live="polite">
        {connected ? (
          <>
            <svg className="surface-check" viewBox="0 0 12 10" aria-hidden="true">
              <path
                className="surface-check-path"
                d="M1 5.5 4.5 9 11 1.5"
              />
            </svg>
            {t.connectedSentence(name)}
          </>
        ) : device.waiting ? (
          t.waitingOkRow
        ) : request ? (
          t.pairingAgain(name)
        ) : host ? (
          t.hostRuns
        ) : device.phone_code ? (
          codeSentence(table.rust, device.phone_code, device.phone_params ?? {}, tag)
        ) : (
          (device.phone ?? "")
        )}
      </span>
      {connected || needsOwner ? null : (
        <span className="phones-status">
          <svg className="phones-status-check" viewBox="0 0 12 10" aria-hidden="true">
            <path d="M1 5.5 4.5 9 11 1.5" />
          </svg>
          {t.connectedBadge}
        </span>
      )}
      {host ? null : device.waiting ? (
        <>
          <HeldButton
            held={decided.has(device.id)}
            onPress={() => onForget(device.id)}
          >
            {t.refuse}
          </HeldButton>
          <HeldButton
            held={decided.has(device.id)}
            primary
            onPress={() => onAllow(device.id, device.id)}
          >
            {t.allow}
          </HeldButton>
        </>
      ) : request ? (
        // The buttons belong to the REQUEST, not the seat: Deny
        // takes the request back and leaves this phone, its label
        // and its credential exactly where they are. One press is
        // enough — the row holds its decision until the store's
        // next answer.
        <>
          <HeldButton
            held={decided.has(request.id)}
            onPress={() => onDeny(request.id)}
          >
            {t.refuse}
          </HeldButton>
          <HeldButton
            held={decided.has(request.id)}
            primary
            onPress={() => onAllow(request.id, device.id)}
          >
            {t.allow}
          </HeldButton>
        </>
      ) : canRename ? (
        // The owner's own name for this phone, beside the Remove it already
        // offers: the two decisions that are the owner's and not the app's.
        <>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              setDraft(device.name ?? "");
              setEditing(true);
            }}
          >
            <Icon name="pencil" size={14} />
            {t.renamePhone}
          </button>
          <button type="button" className="btn-quiet" onClick={() => onForget(device.id)}>
            {t.forget}
          </button>
        </>
      ) : null}
    </div>
  );
}
