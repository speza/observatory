import { useCallback, useEffect, useState } from "react";
import { Schema } from "effect";

export type Theme = "light" | "dark";
export type View = "atlas" | "ledger";

export type BrowserSettings = Readonly<{
  theme: Theme;
  motion: boolean;
  view: View;
}>;

type BrowserSettingsStorage = Pick<Storage, "getItem" | "setItem">;
type BrowserSettingsControl = Readonly<{
  settings: BrowserSettings;
  setSetting: <Key extends keyof BrowserSettings>(key: Key, value: BrowserSettings[Key]) => void;
  updateSetting: <Key extends keyof BrowserSettings>(
    key: Key,
    update: (current: BrowserSettings[Key]) => BrowserSettings[Key],
  ) => void;
}>;

const SETTINGS_KEY = "observatory.browser-settings";
const StoredBrowserSettingsSchema = Schema.Struct({
  version: Schema.Literal(1),
  settings: Schema.Struct({
    theme: Schema.Literal("light", "dark"),
    motion: Schema.Boolean,
    view: Schema.Literal("atlas", "ledger"),
  }),
});
const decodeStoredBrowserSettings = Schema.decodeUnknownSync(
  Schema.parseJson(StoredBrowserSettingsSchema),
);

const defaultBrowserSettings = (): BrowserSettings => ({
  theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  motion: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  view: "atlas",
});

const localStorageCapability = (): BrowserSettingsStorage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export const readBrowserSettings = (
  defaults: BrowserSettings,
  storage: BrowserSettingsStorage | undefined,
): BrowserSettings => {
  if (!storage) return defaults;
  try {
    const encoded = storage.getItem(SETTINGS_KEY);
    if (!encoded) return defaults;
    return decodeStoredBrowserSettings(encoded).settings;
  } catch {
    return defaults;
  }
};

export const writeBrowserSettings = (
  settings: BrowserSettings,
  storage: BrowserSettingsStorage | undefined,
): void => {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, settings }));
  } catch {
    // Browser privacy and quota policies can disable local storage. Settings remain in memory.
  }
};

export const useBrowserSettings = (): BrowserSettingsControl => {
  const [settings, setSettings] = useState<BrowserSettings>(() =>
    readBrowserSettings(defaultBrowserSettings(), localStorageCapability()),
  );

  useEffect(() => writeBrowserSettings(settings, localStorageCapability()), [settings]);

  const setSetting = useCallback(
    <Key extends keyof BrowserSettings>(key: Key, value: BrowserSettings[Key]): void => {
      setSettings((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const updateSetting = useCallback(
    <Key extends keyof BrowserSettings>(
      key: Key,
      update: (current: BrowserSettings[Key]) => BrowserSettings[Key],
    ): void => {
      setSettings((current) => ({ ...current, [key]: update(current[key]) }));
    },
    [],
  );

  return { settings, setSetting, updateSetting };
};
