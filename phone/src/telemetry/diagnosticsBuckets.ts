/**
 * Numeric → bucket labels for v2 diagnostics. Edges and labels mirror
 * workers/telemetry/contract-v2.ts `buckets`; a value equal to an edge falls
 * into the upper band (edges are exclusive upper bounds).
 */

function bucketOf<const L extends readonly string[]>(
  value: number,
  edges: readonly number[],
  labels: L,
): L[number] {
  let index = 0;
  while (index < edges.length && value >= edges[index]!) index += 1;
  return labels[index]!;
}

export function promptTokensBucket(tokens: number): "lt-512" | "512-2k" | "2-8k" | "ge-8k" {
  return bucketOf(tokens, [512, 2048, 8192], ["lt-512", "512-2k", "2-8k", "ge-8k"] as const);
}

export function contextTokensBucket(tokens: number): "lt-4k" | "4-16k" | "16-64k" | "ge-64k" {
  return bucketOf(tokens, [4096, 16384, 65536], ["lt-4k", "4-16k", "16-64k", "ge-64k"] as const);
}

export function tokensPerSecondBucket(tokensPerSecond: number): "lt-1" | "1-10" | "10-30" | "ge-30" {
  return bucketOf(tokensPerSecond, [1, 10, 30], ["lt-1", "1-10", "10-30", "ge-30"] as const);
}

export function sinceStartBucket(seconds: number): "lt-10s" | "10-60s" | "1-10m" | "ge-10m" {
  return bucketOf(seconds, [10, 60, 600], ["lt-10s", "10-60s", "1-10m", "ge-10m"] as const);
}
