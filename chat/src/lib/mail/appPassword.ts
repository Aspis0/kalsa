/**
 * The providers that will not take a normal password over IMAP, and the page
 * where the person gets the one they do want. Only providers whose own
 * documentation says so are listed: for the others the account password is
 * what goes in the field, and inventing a step would only send the person
 * looking for something that does not exist.
 */

export type AppPasswordProvider = "google" | "apple";

/** Where the code is made. Fixed addresses: nothing the person types reaches
    an address, so there is nothing here for a model or a hostile string to
    redirect. */
export const APP_PASSWORD_PAGE: Record<AppPasswordProvider, string> = {
  google: "https://myaccount.google.com/apppasswords",
  apple: "https://account.apple.com",
};

const BY_DOMAIN: Record<string, AppPasswordProvider> = {
  "gmail.com": "google",
  "googlemail.com": "google",
  "icloud.com": "apple",
  "me.com": "apple",
  "mac.com": "apple",
};

/** Who asks for an app password here, or null when the normal one is right. */
export function appPasswordProvider(email: string): AppPasswordProvider | null {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return BY_DOMAIN[domain] ?? null;
}