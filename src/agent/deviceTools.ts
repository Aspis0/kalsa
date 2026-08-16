import type { Locale } from "../i18n";
import type { EngineTool, EngineToolResult } from "../engine/LlamaService";
import { evaluateCalc } from "./deviceCalc";

export { evaluateCalc } from "./deviceCalc";

export const DEVICE_INFO_TOOL: EngineTool = {
  type: "function",
  function: {
    name: "device_info",
    description:
      "Local device clock, UI locale, and battery percent if available. Do not pass this output to web_search.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export const DEVICE_CALC_TOOL: EngineTool = {
  type: "function",
  function: {
    name: "device_calc",
    description:
      "Evaluate a local arithmetic expression with + - * / and parentheses. Integers and decimals only. Do not pass this output to web_search.",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Arithmetic expression, e.g. (3+4)*2",
        },
      },
      required: ["expression"],
    },
  },
};

export type DeviceInfoPayload = {
  nowISO: string;
  locale: string;
  batteryPercent?: number;
};

export async function readDeviceInfo(locale: Locale): Promise<DeviceInfoPayload> {
  const payload: DeviceInfoPayload = {
    nowISO: new Date().toISOString(),
    locale,
  };
  try {
    // Optional dep — fail closed (omit battery) if missing or native call fails.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Battery = require("expo-battery") as {
      getBatteryLevelAsync?: () => Promise<number>;
    };
    const level = await Battery.getBatteryLevelAsync?.();
    if (typeof level === "number" && Number.isFinite(level) && level >= 0) {
      payload.batteryPercent = Math.round(Math.min(1, level) * 100);
    }
  } catch {
    // omit batteryPercent
  }
  return payload;
}

export function formatDeviceInfoResult(info: DeviceInfoPayload): EngineToolResult {
  return { text: JSON.stringify(info), kind: "device_info" };
}

export function runDeviceCalc(
  args: Record<string, unknown>,
  invalidMessage: string,
  divZeroMessage: string,
): EngineToolResult {
  const expression =
    typeof args.expression === "string"
      ? args.expression
      : typeof args.expr === "string"
        ? args.expr
        : "";
  const result = evaluateCalc(expression);
  if (!result.ok) {
    return {
      text: result.error === "divzero" ? divZeroMessage : invalidMessage,
      kind: "device_calc",
      error: result.error,
    };
  }
  return { text: JSON.stringify({ expression, value: result.value }), kind: "device_calc" };
}
