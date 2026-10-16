// Runs in Hydra's main process (scripts/extension.ts compiles it to one plain script): Steam data for the
// "More like this" patches. Must not import anything at runtime.
const STEAM_ASSET_BASE_URL = "https://shared.steamstatic.com/store_item_assets/";

export interface SteamRecommendation {
  objectId: string;
  title: string;
  tagIds: number[];
  coverImageUrl: string | null;
  libraryImageUrl: string | null;
}

export interface SteamStoreItem {
  appid?: number;
  success?: number;
  type?: number;
  name?: string;
  tagids?: number[];
  assets?: {
    asset_url_format?: string;
    library_capsule?: string;
    library_capsule_2x?: string;
    header?: string;
  };
}

export interface BridgeLogger {
  error(message: string, details: { message?: string }): void;
}

export const CHANNELS = { tags: "revamp:getSteamAppTags", recommendations: "revamp:getSteamRecommendations" } as const;

// The store's /recommended/morelike page opens with Steam's "More like this"
// grid; the grids after the first section divider are upcoming, free, demo
// and new releases, so they are cut off.
export const parseMoreLikeAppIds = (html: string, objectId: string) => {
  const grid = html.split("recommendation_area_ctn")[1]?.split("morelike_section_divider")[0] ?? "";
  const appIds = [...grid.matchAll(/data-ds-appid="(\d+)"/g)].map(([, appId]) => appId);

  return [...new Set(appIds)].filter((appId) => appId !== objectId);
};

const assetUrl = (item: SteamStoreItem, file: string | undefined) => {
  const format = item.assets?.asset_url_format;
  if (!format || !file) return null;

  return STEAM_ASSET_BASE_URL + format.replace("${FILENAME}", file);
};

// Keeps the page order; drops anything that is not a visible game.
export const toSteamRecommendations = (appIds: string[], items: SteamStoreItem[]): SteamRecommendation[] => {
  const itemsById = new Map(items.map((item) => [String(item.appid), item]));

  return appIds.flatMap((objectId) => {
    const item = itemsById.get(objectId);
    if (!item?.name || item.success !== 1 || item.type !== 0) return [];

    return [
      {
        objectId,
        title: item.name,
        tagIds: (item.tagids ?? []).filter(Number.isInteger),
        coverImageUrl: assetUrl(item, item.assets?.library_capsule_2x ?? item.assets?.library_capsule),
        libraryImageUrl: assetUrl(item, item.assets?.header),
      },
    ];
  });
};

const getJson = async (url: string, fetchImpl: typeof fetch) => {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
};

const getSteamStoreItems = async (appIds: string[], dataRequest: Record<string, unknown>, fetchImpl: typeof fetch) => {
  const input = JSON.stringify({
    ids: appIds.map((appId) => ({ appid: Number(appId) })),
    context: { language: "english", country_code: "US" },
    data_request: dataRequest,
  });
  const response = await getJson(
    `https://api.steampowered.com/IStoreBrowseService/GetItems/v1?input_json=${encodeURIComponent(input)}`,
    fetchImpl,
  );
  const data = (await response.json()) as { response?: { store_items?: SteamStoreItem[] } };
  return data.response?.store_items ?? [];
};

// Store user tag ids in vote order. Tag ids are language-independent.
export const getSteamAppTags = async (objectId: string, fetchImpl: typeof fetch, logger: BridgeLogger): Promise<number[]> => {
  if (!/^\d+$/.test(objectId)) return [];

  try {
    const [item] = await getSteamStoreItems([objectId], { include_tag_count: 20 }, fetchImpl);
    return (item?.tagids ?? []).filter(Number.isInteger);
  } catch (err) {
    logger.error("Error on getSteamAppTags", { message: (err as Error)?.message });
    return [];
  }
};

// Steam's own "More like this" list for a game, in Steam's order.
export const getSteamRecommendations = async (
  objectId: string,
  fetchImpl: typeof fetch,
  logger: BridgeLogger,
): Promise<SteamRecommendation[]> => {
  if (!/^\d+$/.test(objectId)) return [];

  try {
    const page = await getJson(`https://store.steampowered.com/recommended/morelike/app/${objectId}/`, fetchImpl);
    const appIds = parseMoreLikeAppIds(await page.text(), objectId);
    if (appIds.length === 0) return [];

    const items = await getSteamStoreItems(appIds, { include_tag_count: 20, include_assets: true }, fetchImpl);
    return toSteamRecommendations(appIds, items);
  } catch (err) {
    logger.error("Error on getSteamRecommendations", { message: (err as Error)?.message });
    return [];
  }
};

export function registerSteamBridge(
  registerEvent: (name: string, listener: (event: unknown, objectId: unknown) => unknown) => void,
  logger: BridgeLogger,
  fetchImpl: typeof fetch = globalThis.fetch,
): void {
  registerEvent(CHANNELS.tags, (_e, id) => getSteamAppTags(typeof id === "string" ? id : "", fetchImpl, logger));
  registerEvent(CHANNELS.recommendations, (_e, id) =>
    getSteamRecommendations(typeof id === "string" ? id : "", fetchImpl, logger),
  );
}
