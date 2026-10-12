import { useLanguage } from "../i18n/useLanguage";
import type { UpdateErrorPayload } from "../lib/update";
import { rustSentence } from "../lib/rustText";
import { Icon } from "./Icon";

/** The code picks the sentence: a refused install says why it was refused, and
    only a failed download says the download failed. Show details carries the
    code and the English text, which hold no update URL or key. */
export function UpdateFailure({ error, className }: { error: UpdateErrorPayload; className: string }) {
  const { table, tag } = useLanguage();
  return (
    <>
      <b role="alert" className={className}>{rustSentence(table.rust, error, tag)}</b>
      <details className="update-details">
        <summary>
          {table.setup.showDetails}
          <Icon name="down" size={15} stroke={2.2} />
        </summary>
        <p>
          <code>{error.code}</code>
        </p>
        {error.text ? <p lang="en">{error.text}</p> : null}
      </details>
    </>
  );
}
