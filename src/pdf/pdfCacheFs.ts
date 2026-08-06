/**
 * Cache filesystem for remote PDF bodies written by web_fetch.
 * Injected deps keep this module free of expo-file-system so harnesses can
 * pin partial-write cleanup and the no-directory path.
 */

import { uint8ArrayToBase64 } from "../util/base64";
import type { PdfCacheFs } from "../agent/webFetchTool";

export type PdfCacheFsDeps = {
  /** Cache or document directory URI (trailing slash optional). Empty → error. */
  getDirectory: () => string;
  writeAsBase64: (uri: string, base64: string) => Promise<void>;
  deleteAsync: (uri: string) => Promise<void>;
  /** Model-facing i18n string when getDirectory() is empty. */
  noCacheDirMessage: string;
  now?: () => number;
  randomId?: () => string;
};

/**
 * Build a PdfCacheFs. On write failure mid-stream, deletes the target URI
 * before rethrowing so the caller's finally (which only sees a returned URI)
 * cannot leak a partial file until the 1 h sweep.
 */
export function makePdfCacheFs(deps: PdfCacheFsDeps): PdfCacheFs {
  const now = deps.now ?? (() => Date.now());
  const randomId =
    deps.randomId ?? (() => Math.random().toString(36).slice(2, 8));

  return {
    async write(bytes: Uint8Array): Promise<string> {
      const dir = deps.getDirectory() ?? "";
      if (!dir) throw new Error(deps.noCacheDirMessage);
      const base = dir.endsWith("/") ? dir : `${dir}/`;
      const uri = `${base}web-fetch-pdf-${now()}-${randomId()}.pdf`;
      try {
        const b64 = uint8ArrayToBase64(bytes);
        await deps.writeAsBase64(uri, b64);
        return uri;
      } catch (error) {
        await deps.deleteAsync(uri).catch(() => undefined);
        throw error;
      }
    },
    async remove(fileUri: string): Promise<void> {
      await deps.deleteAsync(fileUri).catch(() => undefined);
    },
  };
}
