import { useLanguage } from "../../i18n/useLanguage";
import { APP_PASSWORD_PAGE } from "../../lib/mail/appPassword";
import type { AppPasswordProvider } from "../../lib/mail/appPassword";
import { Icon } from "../Icon";
import { Openable } from "../Openable";
import "./mail.css";

/**
 * How to get the code a provider wants instead of the account password. The
 * addresses are constants in the app, so this is the person's own browser on a
 * page the provider publishes — never anything a model or a typed string can
 * point somewhere else.
 *
 * Two providers when the address is still empty, because which one it will be
 * is exactly what the person has not said yet.
 */
export function AppPasswordBox({ providers, failed = false }: {
  providers: AppPasswordProvider[];
  /** Marks the box as the answer to a refused connection, where the reason is
      already written above it. */
  failed?: boolean;
}) {
  const { table } = useLanguage();
  const t = table.mail.appPassword;
  if (providers.length === 0) return null;

  return (
    <div className={failed ? "mail-apppass is-failed" : "mail-apppass"}>
      {providers.map((provider) => (
        <section key={provider} className="mail-apppass-for">
          <p className="mail-apppass-title">
            <Icon name="lock" size={15} />
            {provider === "google" ? "Google" : "Apple"}
          </p>
          <ol className="mail-apppass-steps">
            {(provider === "google" ? t.stepsGoogle : t.stepsApple).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <Openable url={APP_PASSWORD_PAGE[provider]}>{t.openPage}</Openable>
        </section>
      ))}
      <p className="mail-apppass-note">{t.note}</p>
    </div>
  );
}