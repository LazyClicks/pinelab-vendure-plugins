import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import {
  Channel,
  Collection,
  CollectionEvent,
  CollectionService,
  EventBus,
  ID,
  LanguageCode,
  Logger,
  Product,
  ProductEvent,
  ProductService,
  RequestContext,
  TransactionalConnection,
} from '@vendure/core';
import { asError } from 'catch-unknown';
import {
  checkHreflang,
  checkJsonLdTypes,
  checkMetaDescriptionLength,
  checkMetaTitleLength,
  checkSitemapInclusion,
  extractHreflangTags,
  extractJsonLdTypes,
  extractMetaDescription,
  extractTitle,
  HreflangTag,
  sitemapUnavailableMessage,
} from '../checks';
import { loggerCtx, PLUGIN_INIT_OPTIONS } from '../constants';
import { ContentCheckResult } from '../entities/content-check-result.entity';
import { ChannelContentScanCompletedEvent } from '../events/channel-content-scan-completed-event';
import {
  ChannelScanFindingEntry,
  ContentCheckEntityType,
  ContentCheckMessage,
  ContentHealthPluginOptions,
} from '../types';
import { ContentCheckResultService } from './content-check-result.service';
import { SitemapFetcher, SitemapFetchResult } from './sitemap-fetcher';
import { StorefrontPageFetcher } from './storefront-page-fetcher';

@Injectable()
export class ContentCheckService implements OnApplicationBootstrap {
  /** Cleared at the start of every full scan; reused across entities within a scan. */
  private readonly sitemapCache = new Map<string, SitemapFetchResult>();

  constructor(
    private connection: TransactionalConnection,
    private productService: ProductService,
    private collectionService: CollectionService,
    private eventBus: EventBus,
    private pageFetcher: StorefrontPageFetcher,
    private sitemapFetcher: SitemapFetcher,
    private resultService: ContentCheckResultService,
    @Inject(PLUGIN_INIT_OPTIONS)
    private options: ContentHealthPluginOptions
  ) {}

  /**
   * Triggers a single-entity check whenever a product or collection is
   * updated, across all of its resolved channel/language combinations.
   * Decoupled from whatever caused the update, and cannot recurse into
   * itself since writing a `ContentCheckResult` does not touch the
   * `Product`/`Collection` entities.
   */
  onApplicationBootstrap(): void {
    this.eventBus.ofType(ProductEvent).subscribe((event) => {
      if (event.type !== 'updated') {
        return;
      }
      this.checkProduct(event.ctx, event.entity.id).catch((e) => {
        Logger.error(
          `Failed to run content check for product ${event.entity.id}: ${
            asError(e).message
          }`,
          loggerCtx,
          asError(e).stack
        );
      });
    });
    this.eventBus.ofType(CollectionEvent).subscribe((event) => {
      if (event.type !== 'updated') {
        return;
      }
      this.checkCollection(event.ctx, event.entity.id).catch((e) => {
        Logger.error(
          `Failed to run content check for collection ${event.entity.id}: ${
            asError(e).message
          }`,
          loggerCtx,
          asError(e).stack
        );
      });
    });
  }

  /**
   * Runs a full scan: every enabled channel (isolated by try/catch), every
   * non-excluded product/collection, every enabled language. Publishes one
   * `ChannelContentScanCompletedEvent` per channel at the end of its pass.
   */
  async runFullScan(): Promise<{
    channelsScanned: number;
    entitiesChecked: number;
  }> {
    this.sitemapCache.clear();
    const channels = await this.connection.getRepository(Channel).find();
    let entitiesChecked = 0;
    let channelsScanned = 0;
    for (const channel of channels) {
      try {
        entitiesChecked += await this.scanChannel(channel);
        channelsScanned++;
      } catch (e) {
        Logger.error(
          `Failed to scan channel '${channel.code}': ${asError(e).message}`,
          loggerCtx,
          asError(e).stack
        );
      }
    }
    return { channelsScanned, entitiesChecked };
  }

  private async scanChannel(channel: Channel): Promise<number> {
    const ctx = this.createCtxForChannel(channel);
    const languages = this.getEnabledLanguages(channel);
    const [products, collections] = await Promise.all([
      this.findAllNonExcludedProducts(ctx),
      this.findAllNonExcludedCollections(ctx),
    ]);

    interface Task {
      entityType: ContentCheckEntityType;
      entityId: ID;
      languageCode: LanguageCode;
    }
    const tasks: Task[] = [];
    for (const product of products) {
      for (const languageCode of languages) {
        tasks.push({ entityType: 'product', entityId: product.id, languageCode });
      }
    }
    for (const collection of collections) {
      for (const languageCode of languages) {
        tasks.push({
          entityType: 'collection',
          entityId: collection.id,
          languageCode,
        });
      }
    }

    const findings: ChannelScanFindingEntry[] = [];
    const concurrency = this.options.concurrency ?? 5;
    await runWithConcurrency(tasks, concurrency, async (task) => {
      const langCtx = this.createCtxForChannel(channel, task.languageCode);
      const entity = await this.reloadTranslated(
        langCtx,
        task.entityType,
        task.entityId
      );
      if (!entity) {
        return;
      }
      const result = await this.checkEntity(
        langCtx,
        task.entityType,
        entity,
        channel,
        task.languageCode
      );
      if (result) {
        findings.push(toFindingEntry(task.entityType, result));
      }
    });

    await this.eventBus.publish(
      new ChannelContentScanCompletedEvent(ctx, channel, findings)
    );
    return tasks.length;
  }

  /**
   * Runs checks for a single product across all of its resolved
   * channel/language combinations. Does not publish a scan-completed event.
   * Used for the automatic recheck on product update, per the
   * `catalog-scan-triggers` spec — editing shared product content can affect
   * the check outcome in every channel that content is used in, not just
   * the channel the edit was made from.
   */
  async checkProduct(ctx: RequestContext, productId: ID): Promise<void> {
    const entity = await this.productService.findOne(ctx, productId, [
      'channels',
    ]);
    if (!entity) {
      return;
    }
    for (const channel of entity.channels ?? []) {
      await this.checkSingleEntityInChannel(ctx, 'product', productId, channel);
    }
  }

  /**
   * Runs checks for a single collection across all of its resolved
   * channel/language combinations. Does not publish a scan-completed event.
   */
  async checkCollection(ctx: RequestContext, collectionId: ID): Promise<void> {
    const entity = await this.collectionService.findOne(ctx, collectionId, [
      'channels',
    ]);
    if (!entity) {
      return;
    }
    for (const channel of entity.channels ?? []) {
      await this.checkSingleEntityInChannel(
        ctx,
        'collection',
        collectionId,
        channel
      );
    }
  }

  /**
   * Runs checks for a single product, scoped to the active channel only —
   * used by the manual "Check now" mutation. Unlike `checkProduct`, this
   * never writes results for a channel other than the one the request is
   * scoped to.
   */
  async checkProductInCurrentChannel(
    ctx: RequestContext,
    productId: ID
  ): Promise<void> {
    await this.checkSingleEntityInChannel(ctx, 'product', productId, ctx.channel);
  }

  /**
   * Runs checks for a single collection, scoped to the active channel only —
   * used by the manual "Check now" mutation.
   */
  async checkCollectionInCurrentChannel(
    ctx: RequestContext,
    collectionId: ID
  ): Promise<void> {
    await this.checkSingleEntityInChannel(
      ctx,
      'collection',
      collectionId,
      ctx.channel
    );
  }

  private async checkSingleEntityInChannel(
    ctx: RequestContext,
    entityType: ContentCheckEntityType,
    entityId: ID,
    channel: Channel
  ): Promise<void> {
    // Unlike `runFullScan` (where the cache is deliberately reused across
    // many entities within one pass), a single-entity check should always
    // see the current sitemap rather than one cached from an unrelated,
    // possibly much earlier, scan.
    this.sitemapCache.clear();
    const languages = this.getEnabledLanguages(channel);
    for (const languageCode of languages) {
      const langCtx = this.createCtxForChannel(channel, languageCode);
      const entity = await this.reloadTranslated(langCtx, entityType, entityId);
      if (!entity) {
        continue;
      }
      await this.checkEntity(langCtx, entityType, entity, channel, languageCode);
    }
  }

  private async reloadTranslated(
    ctx: RequestContext,
    entityType: ContentCheckEntityType,
    entityId: ID
  ): Promise<Product | Collection | undefined> {
    return entityType === 'product'
      ? this.productService.findOne(ctx, entityId)
      : this.collectionService.findOne(ctx, entityId);
  }

  /**
   * Runs the full check pipeline for a single entity/channel/language
   * combination, per design.md §4: exclusion short-circuit, URL resolution,
   * page fetch, built-in page checks, sitemap check, configurable checks,
   * aggregate, upsert.
   */
  async checkEntity(
    ctx: RequestContext,
    entityType: ContentCheckEntityType,
    entity: Product | Collection,
    channel: Channel,
    languageCode: LanguageCode
  ): Promise<ContentCheckResult | undefined> {
    if (entity.customFields?.excludedFromContentChecks) {
      return undefined;
    }

    const messages: ContentCheckMessage[] = [];
    let resolvedUrl: string | undefined;
    try {
      resolvedUrl = await this.options.getStorefrontUrl(ctx, {
        entityType,
        entity,
        channel,
        languageCode,
      });
    } catch (e) {
      messages.push(internalErrorMessage('url-resolution', e));
    }

    if (!resolvedUrl) {
      messages.push({
        source: 'url-resolution',
        severity: 'error',
        code: 'URL_UNRESOLVABLE',
        message: `Could not resolve a storefront URL for this ${entityType} in channel '${channel.code}' and language '${languageCode}'.`,
      });
    } else {
      const fetchResult = await this.pageFetcher.fetch(resolvedUrl, {
        maxRedirects: this.options.maxRedirects ?? 5,
        timeoutMs: this.options.requestTimeoutMs ?? 10000,
      });
      if (!fetchResult.ok) {
        messages.push({
          source: 'page-fetch',
          severity: 'error',
          code: 'PAGE_FETCH_FAILED',
          message: fetchResult.error,
        });
      } else {
        messages.push(
          ...(await this.runPageChecks(
            entityType,
            channel,
            resolvedUrl,
            fetchResult.html
          ))
        );
      }
      messages.push(
        ...(await this.runSitemapCheck(ctx, channel, languageCode, resolvedUrl))
      );
    }

    const configuredChecks = this.options.checks?.[entityType] ?? [];
    for (const check of configuredChecks) {
      try {
        const result = await check(ctx, {
          entityType,
          entity,
          channel,
          languageCode,
        });
        messages.push(...result);
      } catch (e) {
        messages.push(internalErrorMessage('configurable-check', e));
      }
    }

    return this.resultService.saveResult(ctx, {
      entityType,
      entityId: entity.id,
      channelId: channel.id,
      languageCode,
      url: resolvedUrl,
      messages,
      checkedAt: new Date(),
    });
  }

  private async runPageChecks(
    entityType: ContentCheckEntityType,
    channel: Channel,
    pageUrl: string,
    html: string
  ): Promise<ContentCheckMessage[]> {
    const messages: ContentCheckMessage[] = [];
    try {
      messages.push(...checkMetaTitleLength(extractTitle(html)));
    } catch (e) {
      messages.push(internalErrorMessage('meta-title', e));
    }
    try {
      messages.push(...checkMetaDescriptionLength(extractMetaDescription(html)));
    } catch (e) {
      messages.push(internalErrorMessage('meta-description', e));
    }
    try {
      messages.push(...(await this.runHreflangCheck(channel, pageUrl, html)));
    } catch (e) {
      messages.push(internalErrorMessage('hreflang', e));
    }
    try {
      messages.push(...checkJsonLdTypes(entityType, extractJsonLdTypes(html)));
    } catch (e) {
      messages.push(internalErrorMessage('json-ld', e));
    }
    return messages;
  }

  private async runHreflangCheck(
    channel: Channel,
    pageUrl: string,
    html: string
  ): Promise<ContentCheckMessage[]> {
    const hreflangTags = extractHreflangTags(html);
    const enabledLanguageCodes = this.getEnabledLanguages(channel);
    const linkedPageTags = new Map<string, HreflangTag[] | undefined>();
    const hrefsToFetch = new Set(
      hreflangTags
        .filter(
          (t) => t.hreflang.toLowerCase() !== 'x-default' && t.href !== pageUrl
        )
        .map((t) => t.href)
    );
    for (const href of hrefsToFetch) {
      const fetchResult = await this.pageFetcher.fetch(href, {
        maxRedirects: this.options.maxRedirects ?? 5,
        timeoutMs: this.options.requestTimeoutMs ?? 10000,
      });
      linkedPageTags.set(
        href,
        fetchResult.ok ? extractHreflangTags(fetchResult.html) : undefined
      );
    }
    return checkHreflang({
      pageUrl,
      hreflangTags,
      enabledLanguageCodes,
      linkedPageTags,
    });
  }

  private async runSitemapCheck(
    ctx: RequestContext,
    channel: Channel,
    languageCode: LanguageCode,
    resolvedUrl: string
  ): Promise<ContentCheckMessage[]> {
    if (!this.options.getSitemapUrl) {
      return [];
    }
    let sitemapUrl: string | undefined;
    try {
      sitemapUrl = await this.options.getSitemapUrl(ctx, {
        channel,
        languageCode,
      });
    } catch (e) {
      return [internalErrorMessage('sitemap', e)];
    }
    if (!sitemapUrl) {
      return [];
    }
    let result = this.sitemapCache.get(sitemapUrl);
    if (!result) {
      result = await this.sitemapFetcher.fetch(
        sitemapUrl,
        this.options.requestTimeoutMs ?? 10000
      );
      this.sitemapCache.set(sitemapUrl, result);
    }
    if (!result.ok) {
      return [sitemapUnavailableMessage(result.error)];
    }
    return checkSitemapInclusion(resolvedUrl, result.urls);
  }

  private createCtxForChannel(
    channel: Channel,
    languageCode?: LanguageCode
  ): RequestContext {
    return new RequestContext({
      apiType: 'admin',
      isAuthorized: true,
      authorizedAsOwnerOnly: false,
      channel,
      languageCode,
    });
  }

  private getEnabledLanguages(channel: Channel): LanguageCode[] {
    return channel.availableLanguageCodes?.length
      ? channel.availableLanguageCodes
      : [channel.defaultLanguageCode];
  }

  private async findAllNonExcludedProducts(
    ctx: RequestContext
  ): Promise<Product[]> {
    const products: Product[] = [];
    const take = 100;
    let skip = 0;
    for (;;) {
      const page = await this.productService.findAll(ctx, { take, skip });
      products.push(
        ...page.items.filter((p) => !p.customFields?.excludedFromContentChecks)
      );
      skip += take;
      if (skip >= page.totalItems) {
        break;
      }
    }
    return products;
  }

  private async findAllNonExcludedCollections(
    ctx: RequestContext
  ): Promise<Collection[]> {
    const collections: Collection[] = [];
    const take = 100;
    let skip = 0;
    for (;;) {
      const page = await this.collectionService.findAll(ctx, { take, skip });
      collections.push(
        ...page.items.filter(
          (c) => !c.isRoot && !c.customFields?.excludedFromContentChecks
        )
      );
      skip += take;
      if (skip >= page.totalItems) {
        break;
      }
    }
    return collections;
  }
}

function internalErrorMessage(source: string, e: unknown): ContentCheckMessage {
  const err = asError(e);
  return {
    source,
    severity: 'error',
    code: 'INTERNAL_CHECK_ERROR',
    message: `Unexpected error while running the '${source}' check: ${err.message}`,
  };
}

function toFindingEntry(
  entityType: ContentCheckEntityType,
  result: ContentCheckResult
): ChannelScanFindingEntry {
  return {
    entityType,
    entityId: result.entityId,
    languageCode: result.languageCode,
    url: result.url,
    hasError: result.hasError,
    hasWarning: result.hasWarning,
    messages: result.messages,
    checkedAt: result.checkedAt,
  };
}

/**
 * Runs `task` over `items` with at most `concurrency` in flight at once.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await task(current);
    }
  });
  await Promise.all(workers);
}
