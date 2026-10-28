/**
 * The data layer: the single data owner, its message protocol and its router.
 * See docs/design.md, decision 11.
 */
export * from './protocol';
export {
  ACTIVE_RANGE_MS,
  MAX_DELETE_DELAY_MS,
  TEMP_NOTE_PREFIX,
  createDataOwner,
  type BrowserTrigger,
  type Clock,
  type DataOwner,
  type DataOwnerDeps,
  type DataStore,
  type RefreshResult,
  type RefreshSource,
  type StoredValue,
  type Timers,
} from './owner';
export {
  routeDataMessage,
  senderPageOrigin,
  wireDataRouter,
  browserRouterHost,
  type RouterHost,
  type SenderInfo,
} from './router';
export { FULL_REFRESH_INTERVAL_MS, REFRESH_LIMIT_MS, TIMER_FULL_AFTER_MS } from './policy';
export {
  CACHE_VERSION,
  sessionCacheItem,
  setupStatusItem,
  type SessionCache,
  type SetupStatus,
} from './cache';
