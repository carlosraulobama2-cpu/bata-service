import '../i18n';
import * as Crypto from 'expo-crypto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SplashScreen, Stack } from 'expo-router';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '../api/client';
import { bootSession } from '../api/auth';
import { useSession } from '../state/session';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';

// @noble/curves may ask for randomness; route it to the OS CSPRNG.
const g = globalThis as { crypto?: { getRandomValues?: unknown } };
g.crypto ??= {};
g.crypto.getRandomValues ??= Crypto.getRandomValues;

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Auth and business errors are answers, not glitches: don't retry them.
      retry: (count, err) => count < 2 && err instanceof ApiError && err.isNetwork,
      refetchOnWindowFocus: true
    }
  }
});

function RootStack() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }} />;
}

export default function RootLayout() {
  const status = useSession((s) => s.status);

  useEffect(() => {
    void bootSession();
  }, []);

  useEffect(() => {
    if (status !== 'booting') void SplashScreen.hideAsync();
    if (status === 'signedOut') queryClient.clear(); // nothing from the previous session stays in memory
  }, [status]);

  if (status === 'booting') return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RootStack />
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
