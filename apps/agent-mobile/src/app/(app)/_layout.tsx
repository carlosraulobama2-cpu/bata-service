import { Redirect, Stack } from 'expo-router';
import { useSession } from '../../state/session';

export default function AppLayout() {
  const status = useSession((s) => s.status);
  if (status !== 'signedIn') return <Redirect href="/login" />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      {/* Operation flows cover the tabs: one task, one exit. */}
      <Stack.Screen name="cash-out/index" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="cash-in/index" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
    </Stack>
  );
}
