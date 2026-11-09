import { useQuery } from '@tanstack/react-query';
import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';
import { endpoints } from '../../api/endpoints';
import { useSettings } from '../../state/settings';
import { StyleSheet, View } from 'react-native';
import { LockScreen } from '../../components/LockScreen';
import { usePushListeners } from '../../features/push';
import { useMe } from '../../features/queries';
import { useInactivityLock } from '../../features/useInactivityLock';
import { useSession } from '../../state/session';
import { useTheme } from '../../theme/ThemeProvider';

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
  const me = useMe();
  const { colors } = useTheme();
  const hasPin = me.data?.user.has_pin;
  // No payment PIN yet: nothing to unlock with, so the app opens (the agent creates it in Seguridad).
  useEffect(() => {
    if (locked && hasPin === false) useSession.getState().setLocked(false);
  }, [locked, hasPin]);
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
      {locked && (hasPin || me.isError) ? <LockScreen /> : null}
      {/* Locked while the account is still loading: cover the balances until we know. */}
      {locked && hasPin === undefined && !me.isError ?<View style={[StyleSheet.absoluteFill, { backgroundColor: colors.hero, zIndex: 1000 }]} /> : null}
    </View>
  );
}
