import { describe, expect, test } from "bun:test";
import {
  readBrowserSettings,
  writeBrowserSettings,
  type BrowserSettings,
} from "./browserSettings.ts";

const defaults: BrowserSettings = {
  theme: "light",
  terminalAppearance: "application",
  motion: false,
  view: "atlas",
};

const memoryStorage = (initial?: string) => {
  let value = initial ?? null;
  return {
    getItem: (_key: string): string | null => value,
    setItem: (_key: string, next: string): void => {
      value = next;
    },
    value: (): string | null => value,
  };
};

describe("browser settings", () => {
  test("round-trips the versioned settings record", () => {
    const storage = memoryStorage();
    const settings: BrowserSettings = {
      theme: "dark",
      terminalAppearance: "light",
      motion: true,
      view: "ledger",
    };

    writeBrowserSettings(settings, storage);

    expect(readBrowserSettings(defaults, storage)).toEqual(settings);
    expect(storage.value()).toBe(
      '{"version":2,"settings":{"theme":"dark","terminalAppearance":"light","motion":true,"view":"ledger"}}',
    );
  });

  test("migrates the prior settings record to application-following terminals", () => {
    expect(
      readBrowserSettings(
        defaults,
        memoryStorage('{"version":1,"settings":{"theme":"dark","motion":true,"view":"ledger"}}'),
      ),
    ).toEqual({
      theme: "dark",
      terminalAppearance: "application",
      motion: true,
      view: "ledger",
    });
  });

  test("uses current defaults for missing, malformed, or unsupported records", () => {
    expect(readBrowserSettings(defaults, memoryStorage())).toEqual(defaults);
    expect(readBrowserSettings(defaults, memoryStorage("not json"))).toEqual(defaults);
    expect(
      readBrowserSettings(
        defaults,
        memoryStorage(
          '{"version":3,"settings":{"theme":"dark","terminalAppearance":"dark","motion":true,"view":"ledger"}}',
        ),
      ),
    ).toEqual(defaults);
    expect(
      readBrowserSettings(
        defaults,
        memoryStorage('{"version":1,"settings":{"theme":"sepia","motion":true,"view":"ledger"}}'),
      ),
    ).toEqual(defaults);
  });

  test("keeps settings in memory when browser storage is unavailable", () => {
    const unavailable = {
      getItem: (_key: string): string | null => {
        throw new Error("disabled");
      },
      setItem: (_key: string, _value: string): void => {
        throw new Error("disabled");
      },
    };

    expect(readBrowserSettings(defaults, unavailable)).toEqual(defaults);
    expect(() => writeBrowserSettings(defaults, unavailable)).not.toThrow();
    expect(readBrowserSettings(defaults, undefined)).toEqual(defaults);
  });
});
