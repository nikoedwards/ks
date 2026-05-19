import DebugRunClient from './run-client';

export default async function DataQualityDebugPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; action?: string }>;
}) {
  const params = await searchParams;
  return (
    <DebugRunClient
      projectId={params.projectId ?? ''}
      action={params.action === 'kicktraq' ? 'kicktraq' : 'official'}
    />
  );
}
