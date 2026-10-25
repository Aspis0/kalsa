/** The release notes are English in every language, so the list says so. Plain text only: React escapes each line, and one line is one bullet. */
export function ReleaseNotes({ notes }: { notes: string | null }) {
  const lines = notes?.split("\n").map(line => line.trim()).filter(Boolean) ?? [];
  if (lines.length === 0) return null;
  return <ul className="release-notes" lang="en">{lines.map((line, i) => <li key={i}>{line}</li>)}</ul>;
}
