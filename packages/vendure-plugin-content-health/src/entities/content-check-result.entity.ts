import { DeepPartial, ID, LanguageCode, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, Unique } from 'typeorm';
import { ContentCheckEntityType, ContentCheckMessage } from '../types';

// Fully replaced on every re-check (no history kept), so one row per
// (entityType, entityId, channelId, languageCode) is enforced below.
@Entity()
@Unique(['entityType', 'entityId', 'channelId', 'languageCode'])
export class ContentCheckResult extends VendureEntity {
  constructor(input?: DeepPartial<ContentCheckResult>) {
    super(input);
  }

  @Column('varchar')
  entityType!: ContentCheckEntityType;

  @Index()
  @Column({ type: 'varchar' })
  entityId!: ID;

  @Index()
  @Column({ type: 'varchar' })
  channelId!: ID;

  @Column('varchar')
  languageCode!: LanguageCode;

  @Column({ nullable: true })
  url?: string;

  // Denormalized from `messages`, so the overview/alert queries can filter
  // on a plain column instead of scanning the JSON blob.
  @Column({ default: false })
  hasError!: boolean;

  @Column({ default: false })
  hasWarning!: boolean;

  @Column('simple-json')
  messages!: ContentCheckMessage[];

  @Column()
  checkedAt!: Date;
}
