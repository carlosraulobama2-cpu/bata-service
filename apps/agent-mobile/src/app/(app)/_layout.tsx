import { Redirect, Stack } from 'expo-router';
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
        <Stack.Screen name="notification-settings" />
        <Stack.Screen name="security/pin" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      </Stack>
      {/* Over the app (navigation state is kept) until PIN/biometrics are confirmed. */}
      {locked ? <LockScreen /> : null}
    </View>
  );
}
