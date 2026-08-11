import {
  Channel,
  Collection,
  ID,
  LanguageCode,
  Product,
  RequestContext,
  ScheduledTaskConfig,
} from '@vendure/core';

/**
 * @description
 * The kind of catalog entity a content check result belongs to.
 */
export type ContentCheckEntityType = 'product' | 'collection';

/**
 * @description
 * The severity of a single {@link ContentCheckMessage}.
 */
export type ContentCheckSeverity = 'warning' | 'error';

/**
 * @description
 * A single finding produced by a built-in or configurable content check.
 */
export interface ContentCheckMessage {
  /**
   * The check that produced this message, e.g. `meta-title` or `hreflang`.
   * For configurable checks, this defaults to `configurable-check`.
   */
  source: string;
  severity: ContentCheckSeverity;
  /**
   * A stable machine-readable code identifying the kind of violation,
   * e.g. `META_TITLE_LENGTH`.
   */
  code: string;
  message: string;
}

/**
 * @description
 * The arguments passed to a {@link ContentCheck} and to
 * `getStorefrontUrl`/`getSitemapUrl`.
 */
export interface ContentCheckArgs {
  entityType: ContentCheckEntityType;
  entity: Product | Collection;
  channel: Channel;
  languageCode: LanguageCode;
}

/**
 * @description
 * A site-owner-supplied check against Vendure catalog data (as opposed to
 * the built-in storefront page checks, which operate on the rendered HTML).
 *
 * Return zero or more messages. Throwing is caught by the pipeline and
 * turned into a single internal error message; it does not abort the scan.
 */
export type ContentCheck = (
  ctx: RequestContext,
  args: ContentCheckArgs
) => Promise<ContentCheckMessage[]> | ContentCheckMessage[];

/**
 * @description
 * A single entry of a channel's scan findings, as published on
 * {@link ChannelContentScanCompletedEvent}. Shaped like a
 * `ContentCheckResult` row.
 */
export interface ChannelScanFindingEntry {
  entityType: ContentCheckEntityType;
  entityId: ID;
  languageCode: LanguageCode;
  url?: string;
  hasError: boolean;
  hasWarning: boolean;
  messages: ContentCheckMessage[];
  checkedAt: Date;
}

/**
 * @description
 * The plugin can be configured using the following options:
 */
export interface ContentHealthPluginOptions {
  /**
   * @description
   * Resolves the storefront URL for a given product/collection, channel and
   * language. Returning `undefined` for a non-excluded entity is treated as
   * an unresolvable-URL error, not a silent skip.
   */
  getStorefrontUrl: (
    ctx: RequestContext,
    args: ContentCheckArgs
  ) => string | undefined | Promise<string | undefined>;
  /**
   * @description
   * Resolves the sitemap URL to check URL inclusion against, for a given
   * channel and language. When omitted (or when it resolves to `undefined`
   * for a given channel/language), the sitemap-inclusion check is skipped
   * for that channel/language.
   */
  getSitemapUrl?: (
    ctx: RequestContext,
    args: { channel: Channel; languageCode: LanguageCode }
  ) => string | undefined | Promise<string | undefined>;
  /**
   * @description
   * The maximum number of redirects to follow when fetching a storefront
   * page. Any final response with a 2xx status is treated as success.
   *
   * @default 5
   */
  maxRedirects?: number;
  /**
   * @description
   * Timeout in milliseconds for fetching storefront pages and sitemaps.
   *
   * @default 10000
   */
  requestTimeoutMs?: number;
  /**
   * @description
   * The number of entity/channel/language combinations to check
   * concurrently during a full scan.
   *
   * @default 5
   */
  concurrency?: number;
  /**
   * @description
   * The full scan is always registered as a `ScheduledTask`. Use this to
   * change when it runs, or its timeout. Defaults to nightly at 3:00 AM.
   */
  scheduledTask?: Partial<Pick<ScheduledTaskConfig, 'schedule' | 'timeout'>>;
  /**
   * @description
   * Site-owner-supplied Vendure content checks. No built-in Vendure-data
   * checks ship with the plugin, so an empty/omitted list is valid.
   */
  checks?: {
    product?: ContentCheck[];
    collection?: ContentCheck[];
  };
}
