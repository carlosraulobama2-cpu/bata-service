import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { endpoints } from '../api/endpoints';

/**
 * Push notifications (expo-notifications -> Expo push service -> FCM/APNs).
 * The permission is never asked cold at launch: the agent turns it on from
 * a banner that explains why ("saber al momento cuándo te pagan").
 */
export type PushStatus = 'unsupported' | 'undetermined' | 'granted' | 'denied';

const projectId = (): string | undefined =>
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

let configured = false;

/** Foreground presentation and Android channels (same ids the backend sends). */
async function configure(): Promise<void> {
  if (configured || Platform.OS === 'web') return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false })
  });
  if (Platform.OS === 'android') {
    await Promise.all([
      Notifications.setNotificationChannelAsync('operations', { name: 'Operaciones', importance: Notifications.AndroidImportance.HIGH }),
      Notifications.setNotificationChannelAsync('security', { name: 'Seguridad', importance: Notifications.AndroidImportance.HIGH }),
      Notifications.setNotificationChannelAsync('general', { name: 'Avisos', importance: Notifications.AndroidImportance.DEFAULT })
    ]);
  }
}

export async function getPushStatus(): Promise<PushStatus> {
  if (Platform.OS === 'web' || !projectId()) return 'unsupported';
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

/** Gets this phone's token and gives it to the server. `ask`: show the system prompt if needed. */
export async function enablePush(ask: boolean): Promise<PushStatus> {
  if (Platform.OS === 'web' || !projectId()) return 'unsupported';
  await configure();
  let p = await Notifications.getPermissionsAsync();
  if (!p.granted && ask && p.canAskAgain) p = await Notifications.requestPermissionsAsync();
  if (!p.granted) return p.canAskAgain ? 'undetermined' : 'denied';
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
  await endpoints.registerPushToken(token);
  return 'granted';
}

/** Where a tapped notification takes the agent. */
export function routeForNotification(data: Record<string, unknown> | undefined): string {
  const tx = data?.transaction_id;
  return typeof tx === 'string' && /^[0-9a-f-]{36}$/i.test(tx) ? `/transaction/${tx}` : '/notifications';
}

/** Status of push on this phone and a way to turn it on (for banners and settings). */
export function usePushPermission(): { status: PushStatus | null; enable: () => Promise<void> } {
  const [status, setStatus] = useState<PushStatus | null>(null);
  useEffect(() => {
    const check = () => void getPushStatus().then(setStatus, () => setStatus('unsupported'));
    check();
    if (Platform.OS === 'web') return;
    // The agent may enable notifications in the system settings and come back.
    const sub = AppState.addEventListener('change', (state) => state === 'active' && check());
    return () => sub.remove();
  }, []);
  const enable = useCallback(async () => {
    setStatus(await enablePush(true).catch(() => 'undetermined' as const));
  }, []);
  return { status, enable };
}

/**
 * Mounted ONCE while signed in (app layout): re-registers the token
 * silently when the permission is already granted (tokens can rotate),
 * refreshes data when a push arrives and opens the operation when a push
 * is tapped.
 */
export function usePushListeners(): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void configure().then(() => enablePush(false)).catch(() => undefined);
    const received = Notifications.addNotificationReceivedListener(() => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['balance'] });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
    });
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      router.push(routeForNotification(response.notification.request.content.data as Record<string, unknown>) as never);
    });
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [qc]);
}
