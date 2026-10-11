import type { BrainTone } from "./useBrain";
import { Icon } from "../components/Icon";
import "./PowerButton.css";

/** Home's round button (RULES.md "Power button"): the ring says the state, the
    label says what pressing it does. */
export function PowerButton({
  tone,
  label,
  disabled,
  checking = false,
  onPress,
}: {
  tone: BrainTone;
  label: string;
  disabled: boolean;
  // The installed AI being checked after an update: the leaf, not the power sign.
  checking?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      className={`power power-${tone}`}
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
    >
      <span className="power-face">
        {checking ? <Icon name="leaf" size={50} stroke={2} /> : <Icon name="power" size={52} stroke={2.3} />}
      </span>
    </button>
  );
}
