import { api, Button } from '@vendure/dashboard';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  contentCheckResultsDocument,
  runContentCheckForCollectionDocument,
  runContentCheckForProductDocument,
} from '../queries';
import { ContentCheckFindingsList } from './ContentCheckFindingsList';

interface ContentCheckFindingsBlockInnerProps {
  context: { entity?: { id?: string; customFields?: Record<string, unknown> } };
  entityType: 'PRODUCT' | 'COLLECTION';
}

/**
 * Shared implementation for the product-detail and collection-detail page
 * blocks: shows the exclusion notice when the entity is excluded, otherwise
 * the entity's current warnings/errors across every checked channel/language,
 * plus a button to manually re-check just this entity right now.
 */
function ContentCheckFindingsBlockInner({
  context,
  entityType,
}: ContentCheckFindingsBlockInnerProps) {
  const entity = context.entity;
  const entityId = entity?.id;
  const excluded = !!entity?.customFields?.excludedFromContentChecks;
  const queryClient = useQueryClient();
  const queryKey = ['content-check-results', entityType, entityId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      api.query(contentCheckResultsDocument, {
        entityType,
        entityId: entityId as string,
      }),
    enabled: !!entityId && !excluded,
  });

  const checkNowMutation = useMutation({
    mutationFn: () => {
      if (!entityId) {
        return Promise.reject(new Error('Missing entity id'));
      }
      return entityType === 'PRODUCT'
        ? api.mutate(runContentCheckForProductDocument, { productId: entityId })
        : api.mutate(runContentCheckForCollectionDocument, {
            collectionId: entityId,
          });
    },
    onSuccess: async () => {
      toast.success('SEO/content check complete');
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.invalidateQueries({
        queryKey: ['content-health-overview'],
      });
      await queryClient.invalidateQueries({
        queryKey: ['content-health-issues'],
      });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Check failed'),
  });

  const checkNowButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={!entityId || checkNowMutation.isPending}
      onClick={() => checkNowMutation.mutate()}
    >
      <RefreshCwIcon
        className={`h-3.5 w-3.5 mr-2 ${checkNowMutation.isPending ? 'animate-spin' : ''}`}
      />
      {checkNowMutation.isPending ? 'Checking…' : 'Check now'}
    </Button>
  );

  if (excluded) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-sm">
        <AlertTriangleIcon className="h-4 w-4 shrink-0 text-yellow-600" />
        <span>Excluded from SEO/content checks — probably not live.</span>
      </div>
    );
  }

  if (!entityId || isLoading) {
    return null;
  }

  const results = data?.contentCheckResults ?? [];
  const allMessages = results.flatMap((r) =>
    r.messages.map((m) => ({ ...m, languageCode: r.languageCode }))
  );

  return (
    <div className="space-y-2">
      {checkNowButton}
      <ContentCheckFindingsList messages={allMessages} />
    </div>
  );
}

export function ProductContentCheckFindingsBlock({
  context,
}: {
  context: ContentCheckFindingsBlockInnerProps['context'];
}) {
  return (
    <ContentCheckFindingsBlockInner context={context} entityType="PRODUCT" />
  );
}

export function CollectionContentCheckFindingsBlock({
  context,
}: {
  context: ContentCheckFindingsBlockInnerProps['context'];
}) {
  return (
    <ContentCheckFindingsBlockInner context={context} entityType="COLLECTION" />
  );
}
