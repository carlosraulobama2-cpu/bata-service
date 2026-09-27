import { Redirect, Stack } from 'expo-router';
import { usePushListeners } from '../../features/push';
import { useIntegrityReport } from '../../features/useIntegrityReport';
import { useSession } from '../../state/session';

export default function AppLayout() {
  const status = useSession((s) => s.status);
  if (status !== 'signedIn') return <Redirect href="/login" />;
  return <SignedIn />;
}

function SignedIn() {
  usePushListeners();
  useIntegrityReport();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      {/* Operation flows cover the tabs: one task, one exit. */}
      <Stack.Screen name="cash-out/index" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="cash-in/index" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="qr/index" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="qr/scan" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      <Stack.Screen name="qr/collect" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      <Stack.Screen name="qr/mine" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      <Stack.Screen name="notification-settings" />
      <Stack.Screen name="security/pin" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
    </Stack>
  );
}
