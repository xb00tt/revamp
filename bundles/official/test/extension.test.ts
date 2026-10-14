import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildExtension } from "../scripts/extension.ts";

// The built Hydra extension, loaded the way Hydra loads it, rendered by React 18.3.1 (Hydra 4.1.6's version)
// through mount(), with stand-ins for the Hydra internals the registry patches provide.
const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
const { act, create } = require("react-test-renderer") as {
  act(fn: () => Promise<void> | void): Promise<void>;
  create(element: unknown): { root: { findAll(test: (node: { type: unknown; props: Record<string, any> }) => boolean): Array<{ props: Record<string, any> }> } };
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Revamp = { registry: Record<string, unknown>; mounts: Record<string, unknown>; mount(id: string, original: unknown): unknown };
const revamp = () => (globalThis as unknown as { __revamp: Revamp }).__revamp;

const styles: string[] = [];
(globalThis as { document?: unknown }).document = {
  createElement: () => ({ textContent: "" }),
  head: { append: (style: { textContent: string }) => styles.push(style.textContent) },
};

const entry = fileURLToPath(new URL("../src/hydra/extension/index.tsx", import.meta.url));
const file = join(mkdtempSync(join(tmpdir(), "revamp-ext-")), "revamp-hydra.js");
writeFileSync(file, await buildExtension(entry));
await import(pathToFileURL(file).href);

const game = (objectId: string) => ({ objectId, shop: "steam", title: `Game ${objectId}`, libraryImageUrl: `${objectId}.jpg`, downloadSources: [] });
// The current game (100) has six specific tags. Each catalogue search returns games for the tags it was given;
// /similar returns games without tags. Expected rank by hit count: A (3), B (2), C and D (1, C seen first), E (0).
const searches: Record<string, string[]> = { "6:popularity": ["A"], "5:popularity": ["B", "A"], "5:reviewScore": ["A", "C"], "4:popularity": ["B", "D"] };
(globalThis as { window?: unknown }).window = {
  electron: {
    hydraApi: {
      get: async (path: string) =>
        path === "/games/steam/100" ? { tags: [10, 11, 12, 13, 14, 15] } : path === "/catalogue/steam/100/similar" ? [game("E"), game("C")] : null,
      post: async (_path: string, { data }: { data: { tags: number[]; sortBy: string } }) => ({
        edges: (searches[`${data.tags.length}:${data.sortBy}`] ?? []).map(game),
      }),
    },
  },
};

const element = (type: string) => (props: Record<string, unknown>) => React.createElement(type, props, props.children as never);
function hydra(overrides: Record<string, unknown> = {}) {
  const state = { catalogueSearch: { steamUserTags: { en: { Roguelike: 10, Deckbuilder: 11, Strategy: 12 } } } };
  Object.assign(revamp().registry, {
    React,
    jsxRuntime: require("react/jsx-runtime"),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
    useNavigate: () => () => {},
    useEmblaCarousel: () => [() => {}, undefined],
    VerticalCoverCard: element("card"),
    Skeleton: element("skeleton"),
    ChevronLeftIcon: element("left"),
    ChevronRightIcon: element("right"),
    buildGameDetailsPath: (g: { objectId: string }) => `/game/steam/${g.objectId}`,
    levelDBService: { values: async () => [{ id: "source-1", createdAt: "2026-01-01" }] },
    orderBy: (items: unknown[]) => items,
    logger: { error: () => {} },
    useLibrary: () => ({ library: [{ shop: "steam", objectId: "D" }] }),
    useAppDispatch: () => () => {},
    useAppSelector: (select: (s: typeof state) => unknown) => select(state),
    setTags: (tags: unknown) => ({ type: "setTags", payload: tags }),
    getLocalizedSteamMetadata: async () => ({}),
    ...overrides,
  });
}

async function renderSimilarGames() {
  const Stock = () => React.createElement("stock");
  const Mounted = revamp().mount("hydra.similarGames", Stock) as React.FunctionComponent<{ objectId: string; shop: string }>;
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(React.createElement(Mounted, { objectId: "100", shop: "steam" }));
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 10))); // let the searches settle
  return renderer!.root;
}

test("the extension installs mount() and its stylesheet when it loads, before Hydra exists", () => {
  assert.equal(typeof revamp().mount, "function");
  assert.equal(typeof revamp().mounts["hydra.similarGames"], "function");
  assert.ok(styles[0].includes(".similar-games__caption"));
});

test("More like this ranks by shared tags, captions the shared tags, and badges owned games last", async () => {
  hydra();
  const root = await renderSimilarGames();
  assert.equal(root.findAll((n) => n.type === "stock").length, 0);
  const cards = root.findAll((n) => n.type === "card");
  assert.deepEqual(cards.map((c) => c.props.gameTitle), ["Game A", "Game B", "Game C", "Game E", "Game D"]);
  const captions = root.findAll((n) => n.type === "p").map((p) => p.props.children);
  assert.deepEqual(captions, ["Roguelike · Deckbuilder", "Roguelike · Deckbuilder", "Roguelike · Deckbuilder", "", "Roguelike · Deckbuilder"]);
  const badges = root.findAll((n) => n.type === "span" && n.props.className === "similar-games__badge");
  assert.deepEqual(badges.map((b) => b.props.children), ["already_in_library"]);
});

test("a missing registry entry shows the stock section instead", async (t) => {
  hydra({ useEmblaCarousel: undefined });
  t.after(() => hydra());
  const errors = t.mock.method(console, "error", () => {});
  const root = await renderSimilarGames();
  assert.equal(root.findAll((n) => n.type === "stock").length, 1);
  assert.ok(errors.mock.calls.some((c) => String(c.arguments[0]).includes('Revamp: "hydra.similarGames" failed')));
});
