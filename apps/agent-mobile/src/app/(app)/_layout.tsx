import { useQuery } from '@tanstack/react-query';
import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';
import { endpoints } from '../../api/endpoints';
import { useSettings } from '../../state/settings';
import { View } from 'react-native';
import { LockScreen } from '../../components/LockScreen';
import { usePushListeners } from '../../features/push';
import { useInactivityLock } from '../../features/useInactivityLock';
import { useSession } from '../../state/session';

export default function AppLayout() {
  const status = useSession((s) => s.status);
  if (status !== 'signedIn') return <Redirect href="/login" />;
  return <SignedIn />;
}

function SignedIn() {
  usePushListeners();
  useInactivityLock();
  // The agent's saved settings (theme, hidden balance) apply as soon as the session opens.
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: endpoints.preferences, staleTime: 60_000 });
  const apply = useSettings((s) => s.apply);
  useEffect(() => {
    if (prefs.data) apply(prefs.data);
  }, [prefs.data, apply]);
  const locked = useSession((s) => s.locked);
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        {/* Operation flows cover the tabs: one task, one exit. */}
        <Stack.Screen name="cash-out/index" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="cash-in/index" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="qr/scan" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        <Stack.Screen name="apply" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="verification/index" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="verification/business" />
        <Stack.Screen name="transfer/index" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="float-request/index" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="cash/index" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="movements/index" />
        <Stack.Screen name="customers/index" />
        <Stack.Screen name="stats/index" />
        <Stack.Screen name="settings/index" />
        <Stack.Screen name="notification-settings" />
        <Stack.Screen name="security/pin" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      </Stack>
      {/* Over the app (navigation state is kept) until PIN/biometrics are confirmed. */}
      {locked ? <LockScreen /> : null}
    </View>
  );
}
