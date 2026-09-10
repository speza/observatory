import type { HostTerminalLayout } from "../types.ts";
import { isRecord, numberValue, stringValue, type JsonRecord, type JsonValue } from "./protocol.ts";

const records = (value: JsonValue | undefined): readonly JsonRecord[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const rectangle = (value: JsonValue | undefined) => {
  if (!isRecord(value)) return undefined;
  const x = numberValue(value, "x"),
    y = numberValue(value, "y");
  const width = numberValue(value, "width"),
    height = numberValue(value, "height");
  return x !== undefined &&
    y !== undefined &&
    width !== undefined &&
    height !== undefined &&
    width > 0 &&
    height > 0
    ? { x, y, width, height }
    : undefined;
};

/** Translate only complete unzoomed layouts; never invent missing pane geometry. */
export const parseTerminalLayout = (
  snapshot: JsonRecord | undefined,
  primaryId: string,
  fingerprints: ReadonlyMap<string, string>,
): HostTerminalLayout | undefined => {
  if (!snapshot || !Array.isArray(snapshot.layouts) || !Array.isArray(snapshot.tabs))
    return undefined;
  const inventory = records(snapshot.panes);
  const primary = inventory.find((pane) => stringValue(pane, "pane_id") === primaryId);
  const workspace = primary && stringValue(primary, "workspace_id");
  if (!workspace) return undefined;
  const tabs: HostTerminalLayout["tabs"][number][] = [];
  const seen = new Set<string>();
  for (const tab of records(snapshot.tabs).filter(
    (item) => stringValue(item, "workspace_id") === workspace,
  )) {
    const id = stringValue(tab, "tab_id");
    if (!id || tabs.some((existing) => existing.id === id)) return undefined;
    const candidates = records(snapshot.layouts).filter(
      (item) =>
        stringValue(item, "tab_id") === id && stringValue(item, "workspace_id") === workspace,
    );
    if (candidates.length !== 1) return undefined;
    const layout = candidates[0]!;
    if (!Array.isArray(layout.panes) || records(layout.panes).length !== layout.panes.length)
      return undefined;
    const area = rectangle(layout.area);
    if (!area || layout.zoomed !== false) return undefined;
    const panes: HostTerminalLayout["tabs"][number]["panes"][number][] = [];
    for (const item of records(layout.panes)) {
      const paneId = stringValue(item, "pane_id");
      const rect = rectangle(item.rect);
      const fingerprint = paneId && fingerprints.get(paneId);
      if (!paneId || !fingerprint || !rect || seen.has(paneId)) return undefined;
      if (
        !inventory.some(
          (pane) =>
            stringValue(pane, "pane_id") === paneId &&
            stringValue(pane, "tab_id") === id &&
            stringValue(pane, "workspace_id") === workspace,
        )
      )
        return undefined;
      if (
        rect.x < area.x ||
        rect.y < area.y ||
        rect.x + rect.width > area.x + area.width ||
        rect.y + rect.height > area.y + area.height
      )
        return undefined;
      seen.add(paneId);
      panes.push({
        primary: paneId === primaryId,
        target: { kind: "herdr-terminal-control", token: paneId, fingerprint },
        x: (rect.x - area.x) / area.width,
        y: (rect.y - area.y) / area.height,
        width: rect.width / area.width,
        height: rect.height / area.height,
      });
    }
    if (
      !panes.length ||
      panes.length !==
        inventory.filter(
          (pane) =>
            stringValue(pane, "tab_id") === id && stringValue(pane, "workspace_id") === workspace,
        ).length
    )
      return undefined;
    for (let index = 0; index < panes.length; index += 1) {
      const left = panes[index]!;
      if (
        panes
          .slice(index + 1)
          .some(
            (right) =>
              Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x) >
                1e-9 &&
              Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y) >
                1e-9,
          )
      )
        return undefined;
    }
    tabs.push({ id, label: stringValue(tab, "label") ?? "Terminal", panes });
  }
  return seen.has(primaryId) &&
    seen.size === inventory.filter((pane) => stringValue(pane, "workspace_id") === workspace).length
    ? { tabs }
    : undefined;
};
