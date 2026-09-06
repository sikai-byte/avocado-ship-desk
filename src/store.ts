import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { LabelRecord, ShipSettings } from "./types.js";
import { defaultSettings } from "./defaults.js";

export interface Override {
  boxId?: string;
  serviceId?: string;
  /** hold this order back from today's batch */
  hold?: boolean;
}

interface State {
  settings: ShipSettings;
  overrides: Record<string, Override>;
  labels: LabelRecord[];
}

function file(name: string) {
  return path.join(config.dataDir, name);
}

function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(name: string, value: unknown) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = file(name + ".tmp");
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file(name));
}

const state: State = {
  settings: readJson("settings.json", defaultSettings),
  overrides: readJson("overrides.json", {}),
  labels: readJson("labels.json", []),
};

export const store = {
  getSettings: () => state.settings,
  saveSettings(next: ShipSettings) {
    state.settings = next;
    writeJson("settings.json", next);
  },
  getOverrides: () => state.overrides,
  setOverride(orderId: string, patch: Override) {
    const merged = { ...state.overrides[orderId], ...patch };
    for (const k of Object.keys(merged) as (keyof Override)[]) {
      if (merged[k] === undefined || merged[k] === null || merged[k] === "") delete merged[k];
    }
    if (Object.keys(merged).length === 0) delete state.overrides[orderId];
    else state.overrides[orderId] = merged;
    writeJson("overrides.json", state.overrides);
  },
  clearOverride(orderId: string) {
    delete state.overrides[orderId];
    writeJson("overrides.json", state.overrides);
  },
  getLabels: () => state.labels,
  labelFor: (orderId: string) => state.labels.find((l) => l.orderId === orderId),
  addLabels(records: LabelRecord[]) {
    const ids = new Set(records.map((r) => r.orderId));
    state.labels = [...state.labels.filter((l) => !ids.has(l.orderId)), ...records];
    writeJson("labels.json", state.labels);
  },
  updateLabel(orderId: string, patch: Partial<LabelRecord>) {
    const idx = state.labels.findIndex((l) => l.orderId === orderId);
    if (idx >= 0) {
      state.labels[idx] = { ...state.labels[idx], ...patch };
      writeJson("labels.json", state.labels);
    }
  },
};
