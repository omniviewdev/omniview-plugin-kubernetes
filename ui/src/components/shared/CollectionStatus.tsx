import { Button, Stack, Text } from '@omniviewdev/base-ui';

interface CollectionStatusProps {
  isLoading: boolean;
  error: unknown;
  retry: () => void;
  label?: string;
}

/** Request state for a live resource collection. */
export function CollectionStatus({ isLoading, error, retry, label = 'Resources' }: CollectionStatusProps) {
  if (!isLoading && !error) return null;

  return (
    <Stack direction="row" spacing={1} align="center" style={{ flexWrap: 'wrap' }}>
      {isLoading && <Text role="status" size="xs">Loading {label.toLowerCase()}…</Text>}
      {!!error && <>
        <Text role="alert" size="xs">Could not load {label.toLowerCase()}: {error instanceof Error ? error.message : typeof error === 'string' ? error : 'Request failed'}</Text>
        <Button size="sm" variant="outline" disabled={isLoading} aria-label={`Retry ${label.toLowerCase()}`} onClick={retry}>Retry</Button>
      </>}
    </Stack>
  );
}
