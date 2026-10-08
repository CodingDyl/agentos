import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * Whether AgentOS is running in Tauri (desktop app) vs. the browser.
 */
export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/**
 * Open a site URL in its own window:
 * - In Tauri: a new WebviewWindow labeled by the site's project ID or name
 * - In browser: a new tab via window.open
 *
 * The window is reused if it's already open.
 */
export async function openSiteInWindow(url: string, title: string, windowId: string): Promise<void> {
  if (isTauri()) {
    const label = `site-${windowId}`;
    // Check if the window is already open
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      // Just focus the existing window
      await existing.setFocus();
    } else {
      // Create a new window
      new WebviewWindow(label, {
        url,
        title,
        width: 1200,
        height: 800,
        center: true,
      });
    }
  } else {
    // Browser fallback: open in a new tab
    window.open(url, "_blank", "noopener");
  }
}
