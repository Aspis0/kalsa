/**
 * Android Digital Asset Links for kalsa.io → com.kalsa.app
 * (https://kalsa.io/.well-known/assetlinks.json).
 *
 * BETA DEBT: swap assetlinks.json to the release signing key before any public
 * invite link — the debug keystore is public and authenticates nothing.
 *
 * Fingerprint provenance: SHA-256 of the signer certificate read from the real
 * CI APK (kalsa-apks/2641144c-debuggable/…/app-release.apk) by parsing the APK
 * Signing Block (pair id 0x7109871a, APK Signature Scheme v2) and hashing the
 * certificate DER with python3 hashlib, cross-checked with
 * `openssl x509 -fingerprint -sha256` (subject CN=Android Debug).
 */

export const SHA256_CERT_FINGERPRINT =
  "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C";

export function assetLinksResponse(): Response {
  const statement = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.kalsa.app",
        sha256_cert_fingerprints: [SHA256_CERT_FINGERPRINT],
      },
    },
  ];
  return new Response(JSON.stringify(statement, null, 2) + "\n", {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
      // no-store on purpose: after the release-key swap (BETA DEBT) the
      // verification file must take effect immediately, never from a cache.
      "cache-control": "no-store",
    },
  });
}
