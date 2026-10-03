/**
 * A download's size as the app words it: decimal whole MB below a gigabyte,
 * decimal GB with one decimal above. The rule the model download's own
 * progress line uses, in one place so the offer that names a size and the
 * line that then counts it cannot disagree.
 *
 * Deliberately NOT `MachineCard`'s `bytesText`: that one words what a file
 * costs on DISK (binary MiB/GiB, the catalog's own label for the same
 * quantity). A download is a number of bytes off a network, and everything
 * else on that road — the progress line, the first run's confirm — is decimal.
 */
export function downloadBytes(bytes: number, tag: string): string {
  return bytes >= 1e9
    ? `${new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bytes / 1e9)} GB`
    : `${new Intl.NumberFormat(tag).format(Math.round(bytes / 1e6))} MB`;
}
