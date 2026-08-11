import { Injectable } from '@nestjs/common';
import { ID, RequestContext, TransactionalConnection } from '@vendure/core';
import { ContentCheckResult } from '../entities/content-check-result.entity';
import { ContentCheckEntityType, ContentCheckMessage } from '../types';

export interface SaveContentCheckResultInput {
  entityType: ContentCheckEntityType;
  entityId: ID;
  channelId: ID;
  languageCode: string;
  url?: string;
  messages: ContentCheckMessage[];
  checkedAt: Date;
}

@Injectable()
export class ContentCheckResultService {
  constructor(private connection: TransactionalConnection) {}

  /**
   * Returns the latest results for a single entity, scoped to the active
   * channel, across every language it was checked in.
   */
  async findResultsFor(
    ctx: RequestContext,
    entityType: ContentCheckEntityType,
    entityId: ID
  ): Promise<ContentCheckResult[]> {
    return this.connection.getRepository(ctx, ContentCheckResult).find({
      where: {
        entityType,
        entityId: entityId.toString(),
        channelId: ctx.channelId.toString(),
      },
      order: { languageCode: 'ASC' },
    });
  }

  /**
   * Returns every result in the active channel that currently has at least
   * one warning or error.
   */
  async findOverview(ctx: RequestContext): Promise<ContentCheckResult[]> {
    return this.connection
      .getRepository(ctx, ContentCheckResult)
      .createQueryBuilder('result')
      .where('result.channelId = :channelId', {
        channelId: ctx.channelId.toString(),
      })
      .andWhere('(result.hasError = :hasError OR result.hasWarning = :hasWarning)', {
        hasError: true,
        hasWarning: true,
      })
      .orderBy('result.entityType', 'ASC')
      .addOrderBy('result.entityId', 'ASC')
      .getMany();
  }

  /**
   * Upserts the result for a single (entity, channel, language) combination
   * using the find-then-save pattern: insert when no existing row, update
   * in place (fully replacing `messages`) otherwise.
   */
  async saveResult(
    ctx: RequestContext,
    input: SaveContentCheckResultInput
  ): Promise<ContentCheckResult> {
    const repo = this.connection.getRepository(ctx, ContentCheckResult);
    const existing = await repo.findOne({
      where: {
        entityType: input.entityType,
        entityId: input.entityId.toString(),
        channelId: input.channelId.toString(),
        languageCode: input.languageCode as ContentCheckResult['languageCode'],
      },
    });
    const hasError = input.messages.some((m) => m.severity === 'error');
    const hasWarning = input.messages.some((m) => m.severity === 'warning');
    return repo.save(
      new ContentCheckResult({
        id: existing?.id,
        entityType: input.entityType,
        entityId: input.entityId,
        channelId: input.channelId,
        languageCode: input.languageCode as ContentCheckResult['languageCode'],
        url: input.url,
        hasError,
        hasWarning,
        messages: input.messages,
        checkedAt: input.checkedAt,
      })
    );
  }
}
