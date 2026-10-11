import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import "./ConfirmDialog.css";

/** A destructive action asked first (RULES.md "Dialog"): the amber circle,
    the title, one line, Cancel and the action. */
export function ConfirmDialog({
  title,
  body,
  cancel,
  confirm,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  cancel: string;
  confirm: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus starts on Cancel: Enter on an open dialog must never delete.
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
        <span className="dialog-icon">
          <Icon name="trash" size={26} />
        </span>
        <h3 id="dialog-title">{title}</h3>
        <p id="dialog-body">{body}</p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="dialog-btn" onClick={onCancel}>
            {cancel}
          </button>
          <button ref={confirmRef} type="button" className="dialog-btn dialog-btn-danger" onClick={onConfirm}>
            <Icon name="trash" size={18} />
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
