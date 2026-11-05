import type { HTMLAttributes } from "react";
import { PageLoader } from "./page-loader";

export interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  /** What the system is doing, in the product's own voice. */
  message: string;
  detail?: string;
}

/**
 * A screen waiting on data, named in the product's own words.
 */
export function LoadingState({ message, className }: LoadingStateProps) {
  return <PageLoader variant="page" label={message} className={className} />;
}
