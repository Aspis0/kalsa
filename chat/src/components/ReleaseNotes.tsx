/** The release notes are English in every language, so the element says so. Plain text only: React escapes it and `release-notes` keeps the line breaks. */
export function ReleaseNotes({ notes }: { notes: string | null }) {
  if (!notes) return null;
  return <p className="settings-note release-notes" lang="en">{notes}</p>;
}
