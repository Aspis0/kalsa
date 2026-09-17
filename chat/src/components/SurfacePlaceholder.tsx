import "./Settings.css";

interface SurfacePlaceholderProps {
  title: string;
  line: string;
}

/** An honest stand-in: a title and one line, never fake controls. */
export function SurfacePlaceholder({ title, line }: SurfacePlaceholderProps) {
  return (
    <div className="surface-placeholder">
      <h2>{title}</h2>
      <p>{line}</p>
    </div>
  );
}

export const PLACEHOLDER_LINES: Record<string, string> = {
  Models: "Model choice will live here. Until then, the model name in Settings decides.",
  Server: "Server status will live here. Connection errors already point at Settings.",
  Devices: "This computer is the only device. Nothing syncs anywhere.",
  Advanced: "Advanced controls will live here. Nothing is hidden elsewhere.",
};
