import type { ShipChangeStatus, ShipDevStatus, ShipPreviewSource } from "@shared/ship-types";

export const SHIP_PREVIEW_OPTIONS: readonly { value: ShipPreviewSource; label: string }[] = [
  { value: "local", label: "Local" },
  { value: "live", label: "Live" },
];

export const SHIP_CHANGE_STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
] as const;

export const SHIP_CHANGE_PRIORITY_OPTIONS = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;

export function shipDevLabel(status: ShipDevStatus): string {
  switch (status) {
    case "installing":
      return "Installing";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "error":
      return "Error";
    default:
      return "Stopped";
  }
}

export function shipChangeStatusLabel(status: ShipChangeStatus): string {
  return SHIP_CHANGE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That screenshot could not be read."));
    reader.readAsDataURL(file);
  });
}
