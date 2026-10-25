/**
 * Builds the next current.json for one platform's release from the current one.
 * Pure: the caller reads and writes the bucket. A platform on another version is
 * refused unless mixing is allowed; then it keeps its installer and loses its
 * update, so its updater is told nothing and never gets an artifact that disagrees
 * with the manifest's version.
 */

const RELEASE_KEY = /^releases\/([^/]+)\//;
const OTHER = { windows: "mac", mac: "windows" };

export function versionOfKey(key) {
  return RELEASE_KEY.exec(key)?.[1] ?? null;
}

function withoutUpdate(installer) {
  return { key: installer.key, name: installer.name, size: installer.size, sha256: installer.sha256 };
}

export function mergeRelease(current, platform, release, { allowMixed = false } = {}) {
  const other = OTHER[platform];
  const otherInstaller = current[other] ?? null;
  const otherVersion = otherInstaller === null ? null : versionOfKey(otherInstaller.key);
  const mixed = otherInstaller !== null && otherVersion !== release.version;
  if (mixed && !allowMixed) {
    throw new Error(
      `the ${other} installer is at ${otherVersion}, not ${release.version}: release both platforms, or pass --allow-mixed`,
    );
  }
  const kept = otherInstaller === null ? null : mixed ? withoutUpdate(otherInstaller) : otherInstaller;
  const entry = { ...release.installer, update: release.update };
  // Notes describe one version: another platform of the same version keeps them.
  const notes = release.notes ?? (current.version === release.version ? current.notes : null);
  return {
    version: release.version,
    ...(notes ? { notes } : {}),
    windows: platform === "windows" ? entry : kept,
    mac: platform === "mac" ? entry : kept,
  };
}
