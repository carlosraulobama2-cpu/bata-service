import * as ScreenCapture from 'expo-screen-capture';
import { useEffect, useId } from 'react';
import { Platform } from 'react-native';

/**
 * While `active`, screenshots and screen recording are blocked (Android
 * FLAG_SECURE; on iOS recording is hidden and screenshots may still be
 * possible). Used wherever a PIN or an SMS code is typed.
 */
export function useNoScreenCapture(active = true): void {
  const key = useId();
  useEffect(() => {
    if (!active || Platform.OS === 'web') return;
    void ScreenCapture.preventScreenCaptureAsync(key).catch(() => undefined);
    return () => void ScreenCapture.allowScreenCaptureAsync(key).catch(() => undefined);
  }, [active, key]);
}

/** iOS: blur the app in the app switcher so balances and codes aren't visible there. */
export function protectAppSwitcher(): void {
  if (Platform.OS === 'ios') void ScreenCapture.enableAppSwitcherProtectionAsync(0.9).catch(() => undefined);
}
