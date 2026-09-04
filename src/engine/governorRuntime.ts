import AsyncStorage from "@react-native-async-storage/async-storage";

export const GOVERNOR_ENABLED_KEY = "kalsa.governor.enabled";

type RetryArgs<P, R> = {
  enabled: boolean;
  governorParams: P;
  cpuParams: P;
  init: (params: P) => Promise<R>;
  nativeLog: () => string;
  log?: (line: string) => void;
};

export async function readGovernorEnabled(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(GOVERNOR_ENABLED_KEY);
    return value === "1" || value?.toLowerCase() === "true";
  } catch {
    return false;
  }
}

export function isGovernorFallback(
  error: unknown,
  nativeLog: string,
): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /KALSA_GOVERNOR_FALLBACK|governor.*(fail|reject|invalid)/i.test(
    `${message}\n${nativeLog}`,
  );
}

export async function initWithGovernorFallback<P, R>(
  args: RetryArgs<P, R>,
): Promise<{ value: R; retried: boolean; fallbackReason?: string }> {
  if (!args.enabled) {
    return { value: await args.init(args.cpuParams), retried: false };
  }
  try {
    return { value: await args.init(args.governorParams), retried: false };
  } catch (error) {
    if (!isGovernorFallback(error, args.nativeLog())) throw error;
    const message = error instanceof Error ? error.message : String(error ?? "");
    try {
      const value = await args.init(args.cpuParams);
      (args.log ?? console.log)("KALSA_GOVERNOR_FALLBACK_RETRY {ok:true}");
      return { value, retried: true, fallbackReason: message };
    } catch (retryError) {
      (args.log ?? console.log)("KALSA_GOVERNOR_FALLBACK_RETRY {ok:false}");
      throw retryError;
    }
  }
}
