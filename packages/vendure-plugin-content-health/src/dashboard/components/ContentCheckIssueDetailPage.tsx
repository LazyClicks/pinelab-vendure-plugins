import {
  api,
  Button,
  DashboardRouteDefinition,
  Page,
  PageActionBar,
  PageActionBarRight,
  PageBlock,
  PageLayout,
  PageTitle,
} from '@vendure/dashboard';
import { graphql } from '@/gql';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnyRoute } from '@tanstack/react-router';
import { ExternalLinkIcon, RefreshCwIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  contentCheckResultsDocument,
  runContentCheckForCollectionDocument,
  runContentCheckForProductDocument,
} from '../queries';
import { ContentCheckFindingsList } from './ContentCheckFindingsList';

const productForIssueDetailDocument = graphql(`
  query ProductForContentCheckIssueDetail($id: ID!) {
    product(id: $id) {
      id
      name
    }
  }
`);

const collectionForIssueDetailDocument = graphql(`
  query CollectionForContentCheckIssueDetail($id: ID!) {
    collection(id: $id) {
      id
      name
    }
  }
`);

type EntityType = 'PRODUCT' | 'COLLECTION';

function normalizeEntityTypeParam(value: string | undefined): EntityType {
  return value?.toLowerCase() === 'collection' ? 'COLLECTION' : 'PRODUCT';
}

/**
 * Standalone detail page for a single product/collection's SEO/content
 * findings, reachable from the issues list. The entity isn't a normal
 * editable resource here (no create/update mutation makes sense for a
 * read-only aggregation), so this is a plain read-only page rather than a
 * `useDetailPage`-backed form.
 */
export function ContentCheckIssueDetailPage({ route }: { route: AnyRoute }) {
  const params = route.useParams() as {
    entityType?: string;
    entityId?: string;
  };
  const entityType = normalizeEntityTypeParam(params.entityType);
  const entityId = params.entityId;
  const queryClient = useQueryClient();

  const entityQuery = useQuery({
    queryKey: ['content-health-issue-entity', entityType, entityId],
    queryFn: () =>
      entityType === 'PRODUCT'
        ? api.query(productForIssueDetailDocument, { id: entityId as string })
        : api.query(collectionForIssueDetailDocument, {
            id: entityId as string,
          }),
    enabled: !!entityId,
  });

  const resultsQueryKey = ['content-check-results', entityType, entityId];
  const resultsQuery = useQuery({
    queryKey: resultsQueryKey,
    queryFn: () =>
      api.query(contentCheckResultsDocument, {
        entityType,
        entityId: entityId as string,
      }),
    enabled: !!entityId,
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
      await queryClient.invalidateQueries({ queryKey: resultsQueryKey });
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

  if (!entityId) {
    return (
      <Page pageId="content-health-issue-detail">
        <PageTitle>SEO / content issue</PageTitle>
        <PageLayout>
          <PageBlock column="main" blockId="missing-id">
            <p className="text-sm text-muted-foreground">Missing entity id.</p>
          </PageBlock>
        </PageLayout>
      </Page>
    );
  }

  const entity =
    entityType === 'PRODUCT'
      ? entityQuery.data?.product
      : entityQuery.data?.collection;
  const entityNotFound =
    !entityQuery.isLoading && entityQuery.isFetched && !entity;

  // Edge cases: a blank/whitespace-only name falls back to a stable,
  // identifiable placeholder instead of an empty page title.
  const rawName = entity?.name?.trim();
  const entityLabel = entityType === 'PRODUCT' ? 'product' : 'collection';
  const displayName =
    rawName && rawName.length > 0
      ? rawName
      : `Untitled ${entityLabel} #${entityId}`;

  const results = resultsQuery.data?.contentCheckResults ?? [];
  const allMessages = results.flatMap((r) =>
    r.messages.map((m) => ({ ...m, languageCode: r.languageCode }))
  );

  const editEntityHref =
    entityType === 'PRODUCT'
      ? `/products/${entityId}`
      : `/collections/${entityId}`;

  return (
    <Page pageId="content-health-issue-detail">
      <PageTitle>
        {entityQuery.isLoading
          ? 'Loading…'
          : entityNotFound
            ? 'Not found'
            : displayName}
      </PageTitle>
      <PageActionBar>
        <PageActionBarRight>
          <Button type="button" variant="outline" render={<a href={editEntityHref} />}>
            <ExternalLinkIcon className="h-4 w-4 mr-2" />
            Go to {entityLabel}
          </Button>
          <Button
            type="button"
            disabled={checkNowMutation.isPending || entityNotFound}
            onClick={() => checkNowMutation.mutate()}
          >
            <RefreshCwIcon
              className={`h-4 w-4 mr-2 ${checkNowMutation.isPending ? 'animate-spin' : ''}`}
            />
            {checkNowMutation.isPending ? 'Checking…' : 'Check now'}
          </Button>
        </PageActionBarRight>
      </PageActionBar>
      <PageLayout>
        <PageBlock column="main" blockId="content-health-issue-findings">
          {entityNotFound ? (
            <p className="text-sm text-muted-foreground">
              This {entityLabel} could not be found — it may have been deleted
              since it was last checked.
            </p>
          ) : resultsQuery.isLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-8 bg-muted rounded-md" />
              <div className="h-8 bg-muted rounded-md" />
            </div>
          ) : (
            <ContentCheckFindingsList messages={allMessages} />
          )}
        </PageBlock>
      </PageLayout>
    </Page>
  );
}

export const contentCheckIssueDetailRoute: DashboardRouteDefinition = {
  path: '/content-health/issues/$entityType/$entityId',
  loader: () => ({
    breadcrumb: [
      { path: '/content-health/issues', label: 'SEO / content issues' },
      'Issue',
    ],
  }),
  component: (route) => <ContentCheckIssueDetailPage route={route} />,
};
