import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import "./ConfirmDialog.css";

/** An action asked first (RULES.md "Dialog"): the round icon, the title, one
    line, Cancel and the action. A destructive one wears the amber circle and
    the red button; any other the sage ones. */
export function ConfirmDialog({
  icon,
  tone,
  title,
  body,
  cancel,
  confirm,
  onCancel,
  onConfirm,
}: {
  icon: IconName;
  tone: "danger" | "accent";
  title: string;
  body: string;
  cancel: string;
  confirm: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus starts on Cancel: Enter on an open dialog must never act.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="dialog-scrim"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          // Handled here, so the shell's own Escape does not also leave the page.
          event.preventDefault();
          onCancel();
        } else if (event.key === "Tab") {
          // The two buttons are the whole dialog: Tab cycles between them.
          event.preventDefault();
          (document.activeElement === cancelRef.current ? confirmRef : cancelRef).current?.focus();
        }
      }}
    >
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-body">
        <span className={`dialog-icon is-${tone}`}>
          <Icon name={icon} size={26} />
        </span>
        <h3 id="dialog-title">{title}</h3>
        <p id="dialog-body">{body}</p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="dialog-btn" onClick={onCancel}>
            {cancel}
          </button>
          <button ref={confirmRef} type="button" className={`dialog-btn dialog-btn-${tone}`} onClick={onConfirm}>
            <Icon name={icon} size={18} />
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
