import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCENT_STORAGE_KEY,
  DEFAULT_LOOK,
  LOOK_BOOT_SCRIPT,
  legacyThemeToLook,
  parseLook,
  type Accent,
  type LookMode,
} from "../../lib/look";
import {
  DARK_THEMES,
  LIGHT_THEMES,
  buildTheme,
  parseTheme,
  type DarkThemeVariant,
  type LightThemeVariant,
} from "../../lib/theme-config";

const DARK: Record<DarkThemeVariant, Accent> = {
  deep: "purple",
  charcoal: "graphite",
  warm: "orange",
  cool: "blue",
  gray: "graphite",
  midnight: "blue",
  forest: "green",
  purple: "purple",
  ocean: "blue",
  mocha: "orange",
  graphite: "purple",
};

const LIGHT: Record<LightThemeVariant, Accent> = {
  default: "purple",
  warm: "orange",
  cool: "blue",
  soft: "graphite",
  rose: "purple",
  lavender: "purple",
  mint: "green",
  peach: "orange",
};

describe("legacyThemeToLook", () => {
  test("every dark variant", () => {
    for (const [variant, accent] of Object.entries(DARK)) {
      assert.deepEqual(legacyThemeToLook(`dark-${variant}`), {
        mode: "dark",
        accent,
      });
    }
    // Every variant the old picker offered is in the table
    assert.deepEqual(
      DARK_THEMES.map((t) => t.id).sort(),
      Object.keys(DARK).sort()
    );
  });

  test("every light variant", () => {
    for (const [variant, accent] of Object.entries(LIGHT)) {
      assert.deepEqual(legacyThemeToLook(`light-${variant}`), {
        mode: "light",
        accent,
      });
    }
    assert.deepEqual(
      LIGHT_THEMES.map((t) => t.id).sort(),
      Object.keys(LIGHT).sort()
    );
  });

  test("plain modes", () => {
    assert.deepEqual(legacyThemeToLook("dark"), {
      mode: "dark",
      accent: "purple",
    });
    assert.deepEqual(legacyThemeToLook("light"), {
      mode: "light",
      accent: "purple",
    });
    assert.deepEqual(legacyThemeToLook("system"), {
      mode: "system",
      accent: "purple",
    });
  });

  test("missing and junk", () => {
    const fallback = { mode: "dark", accent: "purple" };
    for (const value of [null, undefined, "", "junk", "Dark", "system-x"]) {
      assert.deepEqual(legacyThemeToLook(value), fallback, String(value));
    }
    // An unknown variant keeps its mode
    assert.deepEqual(legacyThemeToLook("light-neon"), {
      mode: "light",
      accent: "purple",
    });
    assert.deepEqual(legacyThemeToLook("dark-"), {
      mode: "dark",
      accent: "purple",
    });
    // Not fooled by Object.prototype
    assert.equal(
      legacyThemeToLook("dark-constructor" as string).accent,
      "purple"
    );
  });
});

describe("parseLook", () => {
  test("a full look", () => {
    const look = { mode: "light", accent: "green", textSize: 2, synced: false };
    assert.deepEqual(parseLook(look), look);
    assert.deepEqual(parseLook(JSON.stringify(look)), look);
  });

  test("missing or invalid fields take the defaults", () => {
    assert.deepEqual(parseLook({ accent: "blue" }), {
      ...DEFAULT_LOOK,
      accent: "blue",
    });
    assert.deepEqual(
      parseLook({ mode: "sepia", accent: "pink", textSize: "2", synced: 1 }),
      DEFAULT_LOOK
    );
    for (const value of [null, undefined, 42, "not json", [], "null"]) {
      assert.deepEqual(parseLook(value), DEFAULT_LOOK, String(value));
    }
  });

  test("text size is a whole step within range", () => {
    assert.equal(parseLook({ textSize: 1.6 }).textSize, 2);
    assert.equal(parseLook({ textSize: 99 }).textSize, 4);
    assert.equal(parseLook({ textSize: -99 }).textSize, -3);
    assert.equal(parseLook({ textSize: NaN }).textSize, 0);
  });
});

describe("parseTheme (deprecated, still reads every stored value)", () => {
  test("legacy and plain values", () => {
    assert.deepEqual(parseTheme("dark-graphite"), {
      mode: "dark",
      variant: "graphite",
    });
    assert.deepEqual(parseTheme("light-lavender"), {
      mode: "light",
      variant: "lavender",
    });
    assert.deepEqual(parseTheme("system"), { mode: "system", variant: null });
    assert.deepEqual(parseTheme("dark"), { mode: "dark", variant: "deep" });
    assert.deepEqual(parseTheme("light"), {
      mode: "light",
      variant: "default",
    });
  });

  test("junk is dark, an unknown variant its mode's base", () => {
    assert.deepEqual(parseTheme("junk"), { mode: "dark", variant: "deep" });
    assert.deepEqual(parseTheme(""), { mode: "dark", variant: "deep" });
    assert.deepEqual(parseTheme(null), { mode: "dark", variant: "deep" });
    assert.deepEqual(parseTheme("light-neon"), {
      mode: "light",
      variant: "default",
    });
    assert.deepEqual(parseTheme("dark-lavender"), {
      mode: "dark",
      variant: "deep",
    });
  });

  test("buildTheme round-trips", () => {
    assert.equal(buildTheme("dark", "deep"), "dark");
    assert.equal(buildTheme("light", "mint"), "light-mint");
    assert.equal(buildTheme("system", "ocean"), "system");
  });
});

/** Runs the <head> boot script against a fake page */
function boot(
  stored: Record<string, string>,
  { prefersDark = true, storageThrows = false } = {}
) {
  const storage = new Map(Object.entries(stored));
  const classes = new Set<string>(["light"]);
  const attrs = new Map<string, string>([["data-theme-variant", "graphite"]]);
  const g = globalThis as Record<string, unknown>;
  const saved = {
    document: g.document,
    localStorage: g.localStorage,
    window: g.window,
  };
  g.localStorage = {
    getItem: (k: string) => {
      if (storageThrows) throw new Error("denied");
      return storage.has(k) ? storage.get(k)! : null;
    },
    setItem: (k: string, v: string) => {
      if (storageThrows) throw new Error("denied");
      storage.set(k, v);
    },
  };
  g.document = {
    documentElement: {
      classList: {
        add: (c: string) => classes.add(c),
        remove: (...cs: string[]) => cs.forEach((c) => classes.delete(c)),
      },
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      removeAttribute: (k: string) => attrs.delete(k),
    },
  };
  g.window = { matchMedia: () => ({ matches: prefersDark }) };
  try {
    new Function(LOOK_BOOT_SCRIPT)();
  } finally {
    Object.assign(g, saved);
  }
  return {
    classes: [...classes],
    accent: attrs.get("data-accent"),
    variant: attrs.get("data-theme-variant"),
    theme: storage.get("theme"),
    storedAccent: storage.get(ACCENT_STORAGE_KEY),
  };
}

describe("LOOK_BOOT_SCRIPT", () => {
  test("every legacy value paints its mode and accent and is rewritten", () => {
    const all: [string, LookMode, Accent][] = [
      ...Object.entries(DARK).map(
        ([v, a]) => [`dark-${v}`, "dark", a] as [string, LookMode, Accent]
      ),
      ...Object.entries(LIGHT).map(
        ([v, a]) => [`light-${v}`, "light", a] as [string, LookMode, Accent]
      ),
    ];
    for (const [theme, mode, accent] of all) {
      const page = boot({ theme });
      assert.deepEqual(page.classes, [mode], theme);
      assert.equal(page.accent, accent, theme);
      assert.equal(page.variant, undefined, theme);
      assert.equal(page.theme, mode, theme);
      assert.equal(page.storedAccent, accent, theme);
    }
  });

  test("an accent already chosen wins over the legacy one", () => {
    const page = boot({ theme: "dark-ocean", [ACCENT_STORAGE_KEY]: "green" });
    assert.equal(page.accent, "green");
    assert.equal(page.storedAccent, "green");
    assert.equal(page.theme, "dark");
  });

  test("plain values are left alone", () => {
    assert.deepEqual(boot({ theme: "light" }), {
      classes: ["light"],
      accent: "purple",
      variant: undefined,
      theme: "light",
      storedAccent: undefined,
    });
    const fresh = boot({});
    assert.deepEqual(fresh.classes, ["dark"]);
    assert.equal(fresh.theme, undefined);
    assert.equal(
      boot({ theme: "dark", [ACCENT_STORAGE_KEY]: "blue" }).accent,
      "blue"
    );
  });

  test("system follows the device", () => {
    assert.deepEqual(
      boot({ theme: "system" }, { prefersDark: false }).classes,
      ["light"]
    );
    assert.deepEqual(boot({ theme: "system" }, { prefersDark: true }).classes, [
      "dark",
    ]);
    assert.equal(boot({ theme: "system" }).theme, "system");
  });

  test("junk becomes dark, unreadable storage still paints", () => {
    const junk = boot({ theme: "neon", [ACCENT_STORAGE_KEY]: "pink" });
    assert.deepEqual(junk.classes, ["dark"]);
    assert.equal(junk.accent, "purple");
    assert.equal(junk.theme, "dark");
    const blocked = boot({ theme: "light" }, { storageThrows: true });
    assert.deepEqual(blocked.classes, ["dark"]);
    assert.equal(blocked.accent, "purple");
  });
});
