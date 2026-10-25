import React from "react";
import { Pill } from "./Pill";

type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "teal";

type Props = {
  children: React.ReactNode;
  live?: boolean;
  tone?: Tone;
};

export function StatusPill({ children, live = false, tone = "neutral" }: Props) {
  return (
    <Pill dot={live} pulse={live} tone={tone}>
      {children}
    </Pill>
  );
}
