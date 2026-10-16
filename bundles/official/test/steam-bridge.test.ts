import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildSteamBridge } from "../scripts/extension.ts";
import {
  CHANNELS,
  getSteamAppTags,
  getSteamRecommendations,
  parseMoreLikeAppIds,
  registerSteamBridge,
  toSteamRecommendations,
} from "../src/hydra/steam-bridge/main.ts";

const capsule = (appId: string) =>
  `<a class="similar_grid_capsule" data-ds-appid="${appId}"></a>`;

describe("parseMoreLikeAppIds", () => {
  it("reads only the first grid, skipping the game itself and repeats", () => {
    const html = [
      `<div class="pageheader">${capsule("100")}</div>`,
      `<div class="recommendation_area_ctn similar_grid_ctn">`,
      capsule("1"),
      capsule("100"),
      capsule("2"),
      capsule("1"),
      `<a data-ds-appid="3,4"></a>`,
      `<h2 class="morelike_section_divider">Upcoming Releases</h2>`,
      `<div class="recommendation_area_ctn similar_grid_ctn">`,
      capsule("5"),
    ].join("\n");

    assert.deepEqual(parseMoreLikeAppIds(html, "100"), ["1", "2"]);
  });

  it("returns nothing for a page without a grid", () => {
    assert.deepEqual(parseMoreLikeAppIds("<html>agecheck</html>", "1"), []);
  });
});

describe("toSteamRecommendations", () => {
  const assets = {
    asset_url_format: "steam/apps/1/${FILENAME}?t=9",
    library_capsule_2x: "abc/library_600x900_2x.jpg",
    header: "def/header.jpg",
  };

  it("keeps the page order and builds artwork urls", () => {
    const results = toSteamRecommendations(
      ["2", "1"],
      [
        { appid: 1, success: 1, type: 0, name: "One", tagids: [5], assets },
        { appid: 2, success: 1, type: 0, name: "Two" },
      ]
    );

    assert.deepEqual(results, [
      {
        objectId: "2",
        title: "Two",
        tagIds: [],
        coverImageUrl: null,
        libraryImageUrl: null,
      },
      {
        objectId: "1",
        title: "One",
        tagIds: [5],
        coverImageUrl:
          "https://shared.steamstatic.com/store_item_assets/steam/apps/1/abc/library_600x900_2x.jpg?t=9",
        libraryImageUrl:
          "https://shared.steamstatic.com/store_item_assets/steam/apps/1/def/header.jpg?t=9",
      },
    ]);
  });

  it("drops missing, failed, nameless and non-game items", () => {
    const results = toSteamRecommendations(
      ["1", "2", "3", "4"],
      [
        { appid: 2, success: 15, type: 0, name: "Failed" },
        { appid: 3, success: 1, type: 4, name: "DLC" },
        { appid: 4, success: 1, type: 0, name: "" },
      ]
    );

    assert.deepEqual(results, []);
  });
});

// A stub fetch that records URLs and answers by URL.
function stub(answer: (url: string) => { ok?: boolean; status?: number; body: unknown } | Error) {
  const urls: string[] = [];
  const fetchImpl = (async (input: string) => {
    urls.push(String(input));
    const r = answer(String(input));
    if (r instanceof Error) throw r;
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      text: async () => String(r.body),
      json: async () => r.body,
    };
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}
const logger = () => {
  const calls: [string, { message?: string }][] = [];
  return { calls, error: (m: string, d: { message?: string }) => void calls.push([m, d]) };
};
const inputJson = (url: string) => JSON.parse(decodeURIComponent(url.split("input_json=")[1]));
const MORELIKE =
  '<div id="recommendation_area_ctn"><a data-ds-appid="3"></a><a data-ds-appid="100"></a><a data-ds-appid="2"></a></div><div class="morelike_section_divider"></div><a data-ds-appid="9"></a>';
const item = (appid: number, name: string) => ({
  appid,
  success: 1,
  type: 0,
  name,
  tagids: [1, 2],
  assets: { asset_url_format: `steam/apps/${appid}/\${FILENAME}`, library_capsule_2x: "c2x.jpg", header: "h.jpg" },
});

test("getSteamRecommendations reads Steam's grid, then names and art, in Steam's order", async () => {
  const { urls, fetchImpl } = stub((url) =>
    url.includes("/morelike/") ? { body: MORELIKE } : { body: { response: { store_items: [item(2, "Two"), item(3, "Three")] } } },
  );
  const result = await getSteamRecommendations("100", fetchImpl, logger());
  const base = "https://shared.steamstatic.com/store_item_assets/steam/apps/";
  assert.deepEqual(result, [
    { objectId: "3", title: "Three", tagIds: [1, 2], coverImageUrl: `${base}3/c2x.jpg`, libraryImageUrl: `${base}3/h.jpg` },
    { objectId: "2", title: "Two", tagIds: [1, 2], coverImageUrl: `${base}2/c2x.jpg`, libraryImageUrl: `${base}2/h.jpg` },
  ]);
  assert.equal(urls[0], "https://store.steampowered.com/recommended/morelike/app/100/");
  assert.ok(urls[1].startsWith("https://api.steampowered.com/IStoreBrowseService/GetItems/v1?input_json="));
  assert.deepEqual(inputJson(urls[1]), {
    ids: [{ appid: 3 }, { appid: 2 }],
    context: { language: "english", country_code: "US" },
    data_request: { include_tag_count: 20, include_assets: true },
  });
});

test("an empty Steam grid is an empty list and asks Steam nothing more", async () => {
  const { urls, fetchImpl } = stub(() => ({ body: "<html>nothing</html>" }));
  assert.deepEqual(await getSteamRecommendations("100", fetchImpl, logger()), []);
  assert.equal(urls.length, 1);
});

test("getSteamAppTags returns the game's tag IDs in vote order", async () => {
  const { urls, fetchImpl } = stub(() => ({ body: { response: { store_items: [{ appid: 5, tagids: [5, "x", 7] }] } } }));
  assert.deepEqual(await getSteamAppTags("5", fetchImpl, logger()), [5, 7]);
  assert.deepEqual(inputJson(urls[0]).data_request, { include_tag_count: 20 });
});

test("a game ID that isn't all digits never reaches a request", async () => {
  const { urls, fetchImpl } = stub(() => ({ body: "" }));
  for (const id of ["", "abc", "1/../2", "12 3", "７"]) {
    assert.deepEqual(await getSteamRecommendations(id, fetchImpl, logger()), []);
    assert.deepEqual(await getSteamAppTags(id, fetchImpl, logger()), []);
  }
  assert.equal(urls.length, 0);
});

test("failures return [] and log the message", async () => {
  for (const [fn, name] of [
    [getSteamRecommendations, "Error on getSteamRecommendations"],
    [getSteamAppTags, "Error on getSteamAppTags"],
  ] as const) {
    const rejected = logger();
    assert.deepEqual(await fn("1", stub(() => new Error("offline")).fetchImpl, rejected), []);
    assert.deepEqual(rejected.calls, [[name, { message: "offline" }]]);
    const http = logger();
    assert.deepEqual(await fn("1", stub(() => ({ ok: false, status: 500, body: "" })).fetchImpl, http), []);
    assert.deepEqual(http.calls, [[name, { message: "HTTP 500" }]]);
  }
});

test("registerSteamBridge registers the two channels and ignores non-string IDs", async () => {
  const { urls, fetchImpl } = stub(() => ({ body: "" }));
  const listeners = new Map<string, (event: unknown, id: unknown) => unknown>();
  registerSteamBridge((name, listener) => void listeners.set(name, listener), logger(), fetchImpl);
  assert.deepEqual([...listeners.keys()], ["revamp:getSteamAppTags", "revamp:getSteamRecommendations"]);
  assert.deepEqual([CHANNELS.tags, CHANNELS.recommendations], [...listeners.keys()]);
  for (const listener of listeners.values()) assert.deepEqual(await listener({}, 123), []);
  assert.equal(urls.length, 0);
});

test("the built bridge is one plain script that defines __revampSteamBridge", async () => {
  const code = await buildSteamBridge(fileURLToPath(new URL("../src/hydra/steam-bridge/main.ts", import.meta.url)));
  assert.ok(code.startsWith("var __revampSteamBridge = "));
  assert.doesNotMatch(code, /^\s*(import|export)\s/m);
  assert.ok(code.includes("revamp:getSteamRecommendations"));
});
