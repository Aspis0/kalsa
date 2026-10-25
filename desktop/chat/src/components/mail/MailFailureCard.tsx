import { useLanguage } from "../../i18n/useLanguage";
import type { MailFailure } from "../../lib/mail/failure";
import { Icon } from "../Icon";

/**
 * Why a mail call did not run, said by Kalsa and by nobody else. The model's
 * answer is not what a person acts on here: it never saw the code, and a
 * guessed fix reads as advice the app gave.
 */
export function MailFailureCard({ failure, onOpenSettings }: { failure: MailFailure; onOpenSettings: () => void }) {
  const { table } = useLanguage();
  const t = table.mail.failure;
  return (
    <div className="mail-failure">
      <p className="mail-failure-head">
        <Icon name="alert" size={15} />
        {t.title}
      </p>
      <p className="mail-failure-cause">{t[failure.kind]}</p>
      {failure.inSettings ? (
        <button type="button" className="mail-failure-go" onClick={onOpenSettings}>
          {t.openSettings}
        </button>
      ) : null}
    </div>
  );
}