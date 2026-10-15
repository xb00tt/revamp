export { memoryStore } from "./sources.ts";
export { describeBundle, runJob, type BundleDescription, type BundleModule, type JobInput, type JobOutput } from "./job.ts";
export type { PatchResult, PatchStatus } from "./graph.ts";
export { loadSelection, type Selection } from "./config.ts";

export {
  describe,
  listPatches,
  newestStable,
  patchApp,
  patchCounts,
  type JobProgress,
  type JobStep,
  type PatchAppOptions,
  type PatchAppResult,
  type PatchListing,
} from "./api.ts";
export {
  checkMessage,
  checkUpdates,
  latestRelease,
  loadSkipped,
  skipVersion,
  updateApp,
  type AppCheck,
  type AppUpdate,
  type CheckResult,
  type UpdateOptions,
} from "./updates.ts";
export {
  addSource,
  bundleForApp,
  loadSources,
  prepareSource,
  refreshSources,
  removeSource,
  sourceKind,
  type BundleSource,
  type SourceCandidate,
  type SourceFetchOptions,
} from "./bundle-sources.ts";
export { listInstalls, rollback, uninstall, type InstalledApp } from "./install.ts";
export { removeStorageItem, storageUsage, type StorageItem } from "./storage.ts";
export { revampPaths, type Paths } from "./paths.ts";
export { ENGINE_VERSION } from "./version.ts";
