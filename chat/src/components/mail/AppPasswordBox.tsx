import { useLanguage } from "../../i18n/useLanguage";
import { APP_PASSWORD_PAGE } from "../../lib/mail/appPassword";
import type { AppPasswordProvider } from "../../lib/mail/appPassword";
import { Icon } from "../Icon";
import { Openable } from "../Openable";
import "./mail.css";

/**
 * How to get the code this provider wants instead of the account password,
 * under the field it goes in. The address is a constant in the app, so this is
 * the person's own browser on a page the provider publishes — never anything a
 * model or a typed string can point somewhere else.
 */
export function AppPasswordBox({ provider, failed = false }: {
  provider: AppPasswordProvider;
  /** Marks the box as the answer to a refused connection, where the reason is
      already written above it: the title stays the how-to, not a second copy. */
  failed?: boolean;
}) {
  const { table } = useLanguage();
  const t = table.mail.appPassword;
  const steps = provider === "google" ? t.stepsGoogle : t.stepsApple;

  return (
    <div className={failed ? "mail-apppass is-failed" : "mail-apppass"}>
      <p className="mail-apppass-title">
        <Icon name="lock" size={15} />
        {t.title}
      </p>
      <ol className="mail-apppass-steps">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="mail-apppass-note">{t.note}</p>
      <Openable url={APP_PASSWORD_PAGE[provider]}>{t.openPage}</Openable>
    </div>
  );
}