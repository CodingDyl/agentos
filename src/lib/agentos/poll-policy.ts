/**
 * How often screens that talk to GitHub (or to Vercel, which clones GitHub)
 * may poll. Faster than this is how a secondary rate limit never recovers.
 *
 * TanStack Query already skips `refetchInterval` in a hidden tab when
 * `refetchIntervalInBackground` is false; `githubStatusPollInterval` is the
 * same rule for anything that polls by hand.
 */

export const GITHUB_STATUS_POLL_MS = 60_000;

export function githubStatusPollInterval(hidden: boolean): number | false {
  return hidden ? false : GITHUB_STATUS_POLL_MS;
}

/** Site tab / Vercel health: never faster than the GitHub cap, even while a deploy is building. */
export function sitePollInterval(_state?: string): number {
  return GITHUB_STATUS_POLL_MS;
}
