import { Shell, Screen, Skeleton, Stack } from '../ui';

export function LoadingScreen() {
  return (
    <Shell>
      <Screen>
        <Stack>
          <Skeleton height={52} />
          <Skeleton height={120} />
          <Skeleton height={120} />
          <Skeleton height={120} />
        </Stack>
      </Screen>
    </Shell>
  );
}
