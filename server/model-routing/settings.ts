import { DEFAULT_MODEL_ROUTING, mergeModelRouting, type ModelRoutingTable } from "../../shared/model-routing-types";
import { readAiSettingsFile, writeAiSettingsFile } from "../ai-stack/settings";

/** The operator's routing table, or the usage-saving defaults. */
export function modelRoutingTable(): ModelRoutingTable {
  return mergeModelRouting(readAiSettingsFile().modelRouting);
}

export function setModelRouting(next: unknown): ModelRoutingTable {
  const table = mergeModelRouting(next);
  writeAiSettingsFile({ modelRouting: table });
  return table;
}

export function resetModelRouting(): ModelRoutingTable {
  writeAiSettingsFile({ modelRouting: undefined });
  return DEFAULT_MODEL_ROUTING;
}
