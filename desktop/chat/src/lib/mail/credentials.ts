import { appPasswordProvider } from "./appPassword";

/**
 * The address and the password as this provider wants them sent.
 *
 * Google's and Apple's codes are sixteen letters shown in groups of four, so a
 * person copies them with the spaces still in. Their login ignores them; ours
 * would not. Nobody else's password is touched: a space inside an account
 * password is a character of that password, and stripping it would refuse a
 * correct one.
 */
export function prepareCredentials(email: string, password: string): { email: string; password: string } {
  const address = email.trim();
  return {
    email: address,
    password: appPasswordProvider(address) === null ? password : password.replace(/\s+/g, ""),
  };
}