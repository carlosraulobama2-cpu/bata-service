import '../i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SplashScreen, Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold } from '@expo-google-fonts/outfit';
import { useEffect } from 'react';
import { Platform, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '../api/client';
import { bootSession } from '../api/auth';
import { protectAppSwitcher } from '../security/useNoScreenCapture';
import { useSession } from '../state/session';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';

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

/** On a computer the web is a phone-wide column in the middle on Velynt's cream, with a soft shadow; on a phone, the whole screen. */
const DESKTOP_COLUMN = 520;

function RootStack() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const stack = <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }} />;
  if (Platform.OS !== 'web' || width <= DESKTOP_COLUMN + 120) return stack;
  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, paddingVertical: 16 }}>
      <View
        style={{
          flex: 1, width: '100%', maxWidth: DESKTOP_COLUMN, alignSelf: 'center', backgroundColor: colors.bg, overflow: 'hidden', borderRadius: 28,
          shadowColor: '#4A2040', shadowOpacity: 0.12, shadowRadius: 32, shadowOffset: { width: 0, height: 12 }
        }}
      >
        {stack}
      </View>
    </View>
  );
}

export default function RootLayout() {
  const status = useSession((s) => s.status);
  // Velynt's fonts (the customer app's): Space Grotesk for titles and amounts, Outfit for text.
  const [fontsLoaded, fontError] = useFonts({ SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold });
  const fontsReady = fontsLoaded || !!fontError;

  useEffect(() => {
    protectAppSwitcher();
    void bootSession();
  }, []);

  useEffect(() => {
    if (status !== 'booting' && fontsReady) void SplashScreen.hideAsync();
    if (status === 'signedOut') queryClient.clear(); // nothing from the previous session stays in memory
  }, [status, fontsReady]);

  if (status === 'booting' || !fontsReady) return null;

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
