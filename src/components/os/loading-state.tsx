import type { HTMLAttributes } from "react";
import { DedsecLoader } from "./dedsec-loader";

export interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  /** What the system is doing, in the product's own voice. */
  message: string;
  detail?: string;
}

/**
 * A screen waiting on data. The DedSec loop is the wait; callers still name
 * what is being read so existing call sites do not have to change.
 */
export function LoadingState({ className }: LoadingStateProps) {
  return <DedsecLoader variant="page" className={className} />;
}
