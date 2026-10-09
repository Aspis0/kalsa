import { V2 } from "./contract-v2";

const enumFields: Record<string, readonly string[]> = V2.enums;
const bucketFields: Record<string, { labels: readonly string[] }> = Object.fromEntries(Object.entries(V2.buckets).filter(([key]) => key !== "deviceBucket"));
const special = new Set(["onBattery", "exitCode", "exitSignal", "signature", "breadcrumbs", "gpuModel", "gpuDriver", "cpuModel", "engineRelease"]);
const ascii = (s: unknown): s is string => typeof s === "string" && s.length <= V2.limits.hardwareChars && /^[\x20-\x7e]+$/.test(s);
const matches = (pattern: string, s: unknown): boolean => ascii(s) && new RegExp(pattern).test(s);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const ipv4 = (value: unknown): boolean => typeof value === "string" && value.split(".").length === 4 && value.split(".").every(part => /^[0-9]+$/.test(part) && Number(part) <= 255);

export function validateV2(report: Record<string, unknown>): string | null {
  if (new TextEncoder().encode(JSON.stringify(report)).length > V2.limits.bodyBytes) return "body too large";
  if (report.diagnostics === undefined) return null;
  if (!object(report.diagnostics)) return "diagnostics invalid";
  const d = report.diagnostics;
  for (const [key, value] of Object.entries(d)) {
    const allowed = Object.prototype.hasOwnProperty.call(enumFields, key) ? enumFields[key] : Object.prototype.hasOwnProperty.call(bucketFields, key) ? bucketFields[key]?.labels : undefined;
    if (allowed) {
      if (typeof value !== "string" || !allowed.includes(value)) return `diagnostics.${key} invalid`;
    } else if (!special.has(key)) return `unknown diagnostics key: ${key}`;
  }
  if (d.osFamily !== undefined && d.osFamily !== report.platform) return "osFamily/platform mismatch";
  if (d.onBattery !== undefined && typeof d.onBattery !== "boolean") return "onBattery invalid";
  for (const [key, min, max] of [
    ["exitCode", V2.limits.exitCodeMin, V2.limits.exitCodeMax],
    ["exitSignal", V2.limits.exitSignalMin, V2.limits.exitSignalMax],
  ] as const) {
    if (d[key] !== undefined && (typeof d[key] !== "number" || !Number.isInteger(d[key]) || (d[key] as number) < min || (d[key] as number) > max)) return `${key} invalid`;
  }
  if (d.signature !== undefined && (!matches(V2.patterns.signature, d.signature) || (d.signature as string).length > V2.limits.signatureChars)) return "signature invalid";
  if (d.cpuModel !== undefined && !matches(V2.patterns.cpuModel, d.cpuModel)) return "cpuModel invalid";
  if (d.engineRelease !== undefined && !matches(V2.patterns.engineRelease, d.engineRelease)) return "engineRelease invalid";
  if (d.gpuDriver !== undefined && (!matches(V2.patterns.gpuDriver, d.gpuDriver) || ipv4(d.gpuDriver))) return "gpuDriver invalid";
  if (d.gpuModel !== undefined) {
    const patterns: Record<string, string> = V2.patterns.gpuModel;
    const pattern = typeof d.gpuVendor === "string" ? patterns[d.gpuVendor] : undefined;
    if (!pattern || !matches(pattern, d.gpuModel)) return "gpuModel invalid";
  }
  if (d.breadcrumbs !== undefined) {
    if (!Array.isArray(d.breadcrumbs) || d.breadcrumbs.length > V2.limits.breadcrumbs) return "breadcrumbs invalid";
    for (const crumb of d.breadcrumbs) {
      if (!object(crumb) || Object.keys(crumb).some(k => !["component", "stage", "sinceStart"].includes(k))) return "breadcrumb invalid";
      if (typeof crumb.component !== "string" || !enumFields.component!.includes(crumb.component)) return "breadcrumb.component invalid";
      if (typeof crumb.stage !== "string" || !enumFields.stage!.includes(crumb.stage)) return "breadcrumb.stage invalid";
      if (crumb.sinceStart !== undefined && (typeof crumb.sinceStart !== "string" || !bucketFields.sinceStart!.labels.includes(crumb.sinceStart))) return "breadcrumb.sinceStart invalid";
    }
  }
  return null;
}

export function v2SignatureFields(report: Record<string, unknown>): Record<string, string> {
  const d = object(report.diagnostics) ? report.diagnostics : {};
  const fields: Record<string, string> = { v: "2", platform: String(report.platform ?? "") };
  for (const key of ["component", "stage", "backend", "engineRelease", "modelId", "signature", "gpuVendor", "gpuModel", "gpuDriver"]) fields[key] = typeof d[key] === "string" ? d[key] : "";
  return fields;
}

export function v2IssueLines(report: unknown, escape: (value: string) => string): string[] {
  if (!object(report) || report.v !== 2 || validateV2(report)) return [];
  const d = object(report.diagnostics) ? report.diagnostics : {};
  const platform = typeof report.platform === "string" && V2.enums.osFamily.includes(report.platform as typeof V2.enums.osFamily[number]) ? report.platform : "unknown";
  return ["v: 2", `platform: ${platform}`, ...Object.entries(d).map(([key, value]) => `${key}: ${escape(typeof value === "object" ? JSON.stringify(value) : String(value))}`)];
}
