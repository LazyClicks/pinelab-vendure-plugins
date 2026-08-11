import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  Allow,
  CollectionService,
  Ctx,
  ID,
  Permission,
  ProductService,
  RequestContext,
} from '@vendure/core';
import { ContentCheckResult } from '../entities/content-check-result.entity';
import { ContentCheckResultService } from '../services/content-check-result.service';
import { ContentCheckService } from '../services/content-check.service';
import { ContentCheckEntityType } from '../types';
import { groupContentCheckResultsByEntity, truncate } from './overview-aggregation';
import {
  applyOverviewFilter,
  applyOverviewSort,
  ContentCheckOverviewListOptionsArg,
  paginateOverview,
} from './overview-filter-sort';

const PREVIEW_MAX_LENGTH = 160;

@Resolver()
export class ContentHealthResolver {
  constructor(
    private resultService: ContentCheckResultService,
    private checkService: ContentCheckService,
    private productService: ProductService,
    private collectionService: CollectionService
  ) {}

  @Query()
  @Allow(Permission.ReadCatalog, Permission.ReadProduct)
  async contentCheckResults(
    @Ctx() ctx: RequestContext,
    @Args('entityType') entityType: string,
    @Args('entityId') entityId: ID
  ) {
    const internalEntityType = fromGraphQlEntityType(entityType);
    const results = await this.resultService.findResultsFor(
      ctx,
      internalEntityType,
      entityId
    );
    return results.map(toGraphQlResult);
  }

  @Query()
  @Allow(Permission.ReadCatalog, Permission.ReadProduct)
  async contentCheckOverview(
    @Ctx() ctx: RequestContext,
    @Args('options') options?: ContentCheckOverviewListOptionsArg
  ) {
    const rawResults = await this.resultService.findOverview(ctx);
    const groups = groupContentCheckResultsByEntity(rawResults);

    const items: Array<{
      id: string;
      entityType: string;
      entityId: ID;
      name: string;
      hasError: boolean;
      hasWarning: boolean;
      errorCount: number;
      warningCount: number;
      languageCodes: string[];
      preview: string | null;
    }> = [];
    for (const group of groups) {
      const name = await this.getEntityDisplayName(
        ctx,
        group.entityType,
        group.entityId
      );
      if (name === undefined) {
        // The entity was deleted since the last check; omit it rather than
        // showing a broken row. It will drop out of results entirely once
        // it is re-checked (or never, if it truly no longer exists).
        continue;
      }
      const entityType = toGraphQlEntityType(group.entityType);
      items.push({
        id: `${entityType}:${group.entityId}`,
        entityType,
        entityId: group.entityId,
        name,
        hasError: group.hasError,
        hasWarning: group.hasWarning,
        errorCount: group.errorCount,
        warningCount: group.warningCount,
        languageCodes: group.languageCodes,
        preview: group.preview ? truncate(group.preview, PREVIEW_MAX_LENGTH) : null,
      });
    }

    const filtered = applyOverviewFilter(items, options?.filter);
    const sorted = applyOverviewSort(filtered, options?.sort);
    return paginateOverview(sorted, options?.skip, options?.take);
  }

  @Mutation()
  @Allow(Permission.UpdateProduct)
  async runContentCheckForProduct(
    @Ctx() ctx: RequestContext,
    @Args('productId') productId: ID
  ) {
    await this.checkService.checkProductInCurrentChannel(ctx, productId);
    const results = await this.resultService.findResultsFor(
      ctx,
      'product',
      productId
    );
    return results.map(toGraphQlResult);
  }

  @Mutation()
  @Allow(Permission.UpdateCollection)
  async runContentCheckForCollection(
    @Ctx() ctx: RequestContext,
    @Args('collectionId') collectionId: ID
  ) {
    await this.checkService.checkCollectionInCurrentChannel(ctx, collectionId);
    const results = await this.resultService.findResultsFor(
      ctx,
      'collection',
      collectionId
    );
    return results.map(toGraphQlResult);
  }

  @Mutation()
  @Allow(Permission.UpdateCatalog)
  async runContentHealthFullScan() {
    return this.checkService.runFullScan();
  }

  /**
   * Resolves a display name for the overview/detail pages, handling the
   * edge cases a raw `entity.name` can't: a deleted entity (returns
   * `undefined` so the caller can omit the row), and a blank/whitespace-only
   * name (falls back to a stable, identifiable placeholder rather than
   * rendering an empty link).
   */
  private async getEntityDisplayName(
    ctx: RequestContext,
    entityType: ContentCheckEntityType,
    entityId: ID
  ): Promise<string | undefined> {
    const entity =
      entityType === 'product'
        ? await this.productService.findOne(ctx, entityId)
        : await this.collectionService.findOne(ctx, entityId);
    if (!entity) {
      return undefined;
    }
    const trimmedName = entity.name?.trim();
    if (trimmedName) {
      return trimmedName;
    }
    return entityType === 'product'
      ? `Untitled product #${entityId}`
      : `Untitled collection #${entityId}`;
  }
}

function toGraphQlResult(result: ContentCheckResult) {
  return {
    id: result.id,
    entityType: toGraphQlEntityType(result.entityType),
    entityId: result.entityId,
    languageCode: result.languageCode,
    url: result.url,
    hasError: result.hasError,
    hasWarning: result.hasWarning,
    messages: result.messages.map((m) => ({
      source: m.source,
      severity: m.severity.toUpperCase(),
      code: m.code,
      message: m.message,
    })),
    checkedAt: result.checkedAt,
  };
}

function toGraphQlEntityType(entityType: ContentCheckEntityType): string {
  return entityType.toUpperCase();
}

function fromGraphQlEntityType(entityType: string): ContentCheckEntityType {
  return entityType.toLowerCase() as ContentCheckEntityType;
}
