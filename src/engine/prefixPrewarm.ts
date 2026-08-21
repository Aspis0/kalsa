/**
 * Pure helpers for the static system+tools prefix prewarm (V2-2).
 *
 * Hash is djb2 over {locale, systemText, toolNames+schema JSON}.
 * Messages are system-only — no user, facts, persona, or operative/digest.
 */

export type PrewarmToolLike = {
  type?: string;
  function?: {
    name?: unknown;
    description?: unknown;
    parameters?: unknown;
  };
};

export type StaticPrefixMessage = { role: "system"; content: string };

export type AssembledStaticPrefix = {
  messages: StaticPrefixMessage[];
  tools: PrewarmToolLike[];
  hasTools: boolean;
  hash: string;
  systemChars: number;
  toolCount: number;
};

/** Same djb2 as sessionPersistence.historyHash (UTF-16 code units). */
export function djb2(text: string): string {
  let h = 5381 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h = (((h << 5) + h + text.charCodeAt(i)) >>> 0);
  }
  return String(h >>> 0);
}

/** Stable {name, schema} rows for the prefix hash. */
export function toolsForPrewarmHash(
  tools: ReadonlyArray<PrewarmToolLike> | null | undefined,
): Array<{ name: string; schema: unknown }> {
  const list = Array.isArray(tools) ? tools : [];
  return list.map((tool) => {
    const fn = tool?.function;
    return {
      name: typeof fn?.name === "string" ? fn.name : "",
      schema: {
        description: typeof fn?.description === "string" ? fn.description : "",
        parameters: fn?.parameters ?? null,
      },
    };
  });
}

/**
 * djb2 over JSON.stringify({locale, systemText, tools: [{name, schema}]}).
 */
export function computePrewarmPrefixHash(
  locale: string,
  systemText: string,
  tools?: ReadonlyArray<PrewarmToolLike> | null,
): string {
  return djb2(
    JSON.stringify({
      locale: typeof locale === "string" ? locale : "",
      systemText: typeof systemText === "string" ? systemText : "",
      tools: toolsForPrewarmHash(tools),
    }),
  );
}

/** System-only chat. Never user / assistant / tool roles. */
export function buildStaticPrefixMessages(systemText: string): StaticPrefixMessage[] {
  return [{ role: "system", content: typeof systemText === "string" ? systemText : "" }];
}

/**
 * Queue skip: only when this process already prewarmed (or marked hot) this
 * prefix. After a live chat turn the caller sets prewarmPrefixHash so ensure()
 * will not overwrite hot chat KV with a system-only prefill.
 *
 * Disk restore is split: hybrid/kvUnified loadSession is not a real native
 * restore (n_past=0) so prewarm must still run when the hash is null. Dense
 * a restore populated real KV — see shouldSkipPrewarmAfterRestore.
 *
 * Hash is identity-only (locale + systemText + tool name/schema), not a
 * byte-proof of the rendered jinja prompt.
 */
export function shouldSkipStaticPrefixPrewarm(
  prewarmPrefixHash: string | null | undefined,
  prefixHash: string,
): boolean {
  return prewarmPrefixHash === prefixHash;
}

/**
 * A restore that populated chat KV must not be prewarmed over: a
 * system+user"." prewarm seq_rm-succeeds and deletes the restored tail, and
 * the first send then re-prefills the whole history.
 *
 * This used to skip only for DENSE models, on the assumption that "hybrid /
 * kvUnified restores are not real (n_past=0)". **Measured false on 2026-08-21**
 * (HARNESS_FINDINGS §7.29): on LFM2.5-8B-A1B-KEXP — hybrid — a restore after
 * force-stop logged `is_hybrid=1 resumable=1`, loaded in 19 ms, and the next
 * send ran at `n_past=1473` with `promptMs` ~2 s, twice. The KV was real, and
 * the architecture never told us whether it would be.
 *
 * So the condition is the restore, not the architecture. Qwen3.5-2B also
 * restores, then loses the KV at prompt time ("no usable state checkpoint …
 * doing full cache clear") because its prompt diverges — a prewarm would not
 * have survived that either, so skipping is right there too.
 */
export function shouldSkipPrewarmAfterRestore(kvHoldsChatSession: boolean): boolean {
  return kvHoldsChatSession === true;
}

export function assembleStaticPrefix(input: {
  locale: string;
  systemText: string;
  tools?: ReadonlyArray<PrewarmToolLike> | null;
}): AssembledStaticPrefix {
  const tools = Array.isArray(input.tools) ? [...input.tools] : [];
  const systemText = typeof input.systemText === "string" ? input.systemText : "";
  const locale = typeof input.locale === "string" ? input.locale : "";
  return {
    messages: buildStaticPrefixMessages(systemText),
    tools,
    hasTools: tools.length > 0,
    hash: computePrewarmPrefixHash(locale, systemText, tools),
    systemChars: systemText.length,
    toolCount: tools.length,
  };
}
