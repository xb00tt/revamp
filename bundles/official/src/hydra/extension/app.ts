// Hydra internals the extension uses, read from the registry at call time (see @revamp/sdk/shims/registry).
// The registry patches in ../registry.ts fill these names; the ported fork code imports them from here
// instead of from @renderer/*, react-i18next, react-router-dom and the UI libraries Hydra bundles.
import type { ReactNode } from "react";
import { jsx } from "@revamp/sdk/shims/jsx-runtime";
import { need } from "@revamp/sdk/shims/registry";

// Types: the parts of Hydra's types the ported code relies on.
export type GameShop = "steam" | "launchbox" | "custom";
export interface DownloadSource {
  id: string;
  createdAt: string;
}
interface LibraryGame {
  shop: GameShop;
  objectId: string;
}
interface HydraState {
  catalogueSearch: { steamUserTags: Record<string, Record<string, number> | undefined> };
}
interface EmblaApi {
  canScrollPrev(): boolean;
  canScrollNext(): boolean;
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
  scrollTo(index: number, jump?: boolean): void;
  scrollPrev(): void;
  scrollNext(): void;
}
export interface VerticalCoverCardProps {
  gameTitle: string;
  coverImageUrls: Array<string | null>;
  className?: string;
  useClassicsLayout?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}

// Hooks and functions: called through, so the app's own instance runs.
export const useTranslation = (ns?: string) =>
  need<(ns?: string) => { t: (key: string) => string; i18n: { language: string } }>("useTranslation")(ns);
export const useNavigate = () => need<() => (path: string) => void>("useNavigate")();
export const useEmblaCarousel = (options: Record<string, unknown>) =>
  need<(options: Record<string, unknown>) => [(node: HTMLElement | null) => void, EmblaApi | undefined]>("useEmblaCarousel")(options);
export const useLibrary = () => need<() => { library: LibraryGame[] }>("useLibrary")();
export const useAppDispatch = () => need<() => (action: unknown) => void>("useAppDispatch")();
export const useAppSelector = <T,>(selector: (state: HydraState) => T): T =>
  need<(selector: (state: HydraState) => T) => T>("useAppSelector")(selector);
export const setTags = (tags: unknown) => need<(tags: unknown) => unknown>("setTags")(tags);
export const getLocalizedSteamMetadata = <T,>(endpoint: string, locale: string) =>
  need<(endpoint: string, locale: string) => Promise<T>>("getLocalizedSteamMetadata")(endpoint, locale);
export const buildGameDetailsPath = (game: { shop: string; objectId: string; title: string }) =>
  need<(game: { shop: string; objectId: string; title: string }) => string>("buildGameDetailsPath")(game);
export const orderBy = <T,>(items: T[], key: string, order: "asc" | "desc") =>
  need<(items: T[], key: string, order: string) => T[]>("orderBy")(items, key, order);
export const logger = {
  error: (...args: unknown[]) => need<{ error(...args: unknown[]): void }>("logger").error(...args),
};
export const levelDBService = {
  values: (sublevel: string) => need<{ values(sublevel: string): Promise<unknown[]> }>("levelDBService").values(sublevel),
};

// Components: thin wrappers that render the app's own component.
const component =
  <P,>(name: string) =>
  (props: P) =>
    jsx(need(name), props) as ReactNode;
export const VerticalCoverCard = component<VerticalCoverCardProps>("VerticalCoverCard");
export const Skeleton = component<{ className?: string }>("Skeleton");
export const ChevronLeftIcon = component<{ size?: number }>("ChevronLeftIcon");
export const ChevronRightIcon = component<{ size?: number }>("ChevronRightIcon");
