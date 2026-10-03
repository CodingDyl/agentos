import type { ReactNode } from "react";
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-1 text-sm text-paper-char">{label}{children}</label>; }
