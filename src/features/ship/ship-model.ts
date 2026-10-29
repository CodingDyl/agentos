import type { DevServerStatus } from "@shared/dev-server-types";
import type { ShipChangePriority, ShipChangeStatus, ShipDeployState, ShipPreviewSource } from "@shared/ship-types";

export const SHIP_PREVIEW_OPTIONS: readonly { value: ShipPreviewSource; label: string }[] = [
  { value: "local", label: "Local" },
  { value: "live", label: "Live" },
];

export const SHIP_CHANGE_STATUS_OPTIONS: readonly { value: ShipChangeStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

export const SHIP_CHANGE_PRIORITY_OPTIONS: readonly { value: ShipChangePriority; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const DEV_LABELS: Record<DevServerStatus, string> = {
  stopped: "Stopped",
  installing: "Installing",
  starting: "Starting",
  running: "Running",
  failed: "Failed",
};

export function shipDevLabel(status: DevServerStatus): string {
  return DEV_LABELS[status];
}

export function shipChangeStatusLabel(status: ShipChangeStatus): string {
  return SHIP_CHANGE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/** The name a person must type before production: the linked Vercel project's. */
export function productionConfirmationName(deploy: Pick<ShipDeployState, "vercelProjectName" | "vercelProjectId">): string | undefined {
  return deploy.vercelProjectName || deploy.vercelProjectId || undefined;
}

/** Whether what was typed confirms production. The server checks the same thing; this only enables the button. */
export function confirmsProduction(typed: string, expected: string | undefined): boolean {
  return Boolean(expected) && typed.trim() === expected;
}

export function filterChanges<T extends { status: ShipChangeStatus; priority: ShipChangePriority }>(
  items: readonly T[],
  statuses: readonly string[],
  priorities: readonly string[],
): T[] {
  return items.filter(
    (item) => (statuses.length === 0 || statuses.includes(item.status)) && (priorities.length === 0 || priorities.includes(item.priority)),
  );
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That screenshot could not be read."));
    reader.readAsDataURL(file);
  });
}
