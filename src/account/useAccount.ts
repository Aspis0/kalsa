import { useCallback, useEffect, useState } from "react";

import {
  clearAccountEmail,
  isValidEmail,
  loadAccountEmail,
  saveAccountEmail,
} from "./accountStorage";

export class InvalidEmailError extends Error {
  readonly code = "invalid_email" as const;
  constructor() {
    super("invalid_email");
    this.name = "InvalidEmailError";
  }
}

export function useAccount() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    loadAccountEmail()
      .then((saved) => {
        if (!mounted) return;
        setEmail(saved);
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const signIn = useCallback(async (nextEmail: string) => {
    const normalized = nextEmail.trim();
    if (!isValidEmail(normalized)) {
      throw new InvalidEmailError();
    }
    setEmail(normalized);
    try {
      await saveAccountEmail(normalized);
    } catch {
      setEmail(null);
      throw new Error("write_failed");
    }
  }, []);

  const signOut = useCallback(async () => {
    const previous = email;
    setEmail(null);
    try {
      await clearAccountEmail();
    } catch {
      setEmail(previous);
      throw new Error("write_failed");
    }
  }, [email]);

  return {
    email,
    isSignedIn: email !== null,
    loading,
    signIn,
    signOut,
  };
}
