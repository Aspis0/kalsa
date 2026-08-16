import { Platform } from "react-native";
import {
  ApplicationReleaseType,
  getInstallReferrerAsync,
  getIosApplicationReleaseTypeAsync,
} from "expo-application";

export type StoreSource = "google" | "apple" | "none";

/** Safety net: if Play's referrer service never settles, treat as no store. */
const REFERRER_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("install_referrer_timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Which store this install came from — drives the Account login hero.
 *
 * iOS: App Store *distribution* builds (including TestFlight — both are
 * signed with an App Store profile without UDIDs) report "apple".
 * Debug/ad-hoc/enterprise/simulator builds report "none".
 *
 * Android: the Play Install Referrer API only serves packages that Google
 * Play installed itself. A successful call (even with an empty referrer,
 * i.e. no campaign) proves a Play install → "google". Any rejection
 * (FEATURE_NOT_SUPPORTED, SERVICE_UNAVAILABLE, lost connection, missing
 * Play Store, timeout) means the app was sideloaded / from another store →
 * "none" → email-only login.
 */
export async function detectStoreSource(): Promise<StoreSource> {
  if (Platform.OS === "ios") {
    try {
      const release = await getIosApplicationReleaseTypeAsync();
      if (release === ApplicationReleaseType.APP_STORE) return "apple";
      return "none";
    } catch {
      return "none";
    }
  }
  if (Platform.OS === "android") {
    try {
      await withTimeout(getInstallReferrerAsync(), REFERRER_TIMEOUT_MS);
      return "google";
    } catch {
      return "none";
    }
  }
  return "none";
}
