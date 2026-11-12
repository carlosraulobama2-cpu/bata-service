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
  await endpoints.registerPushToken(token, Platform.OS);
  registeredToken = token;
  return 'granted';
}

let registeredToken: string | null = null;
let handledLaunchPush: string | null = null;

/** On sign-out: this phone stops receiving this account's notices. */
export async function forgetPushToken(): Promise<void> {
  if (!registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  await endpoints.unregisterPushToken(token);
}

/** Screen for each kind of notice the agents app receives (types from the server). */
const NOTICE_ROUTES: Record<string, string> = {
  agent_active: '/home',
  agent_rejected: '/apply',
  agent_suspended: '/help',
  agent_document_rejected: '/verification',
  agent_low_float: '/float-request',
  agent_float_request: '/float-request',
  agent_float: '/movements',
  agent_referral_paid: '/commissions',
  agent_fraud_check: '/operations',
  security_pin_changed: '/security'
};

/** Where a notice takes the agent: its operation when it has one, else the screen for its type. */
export function routeForNotice(type: string | undefined, operationId: unknown): string | null {
  if (typeof operationId === 'string' && /^[0-9a-f-]{36}$/i.test(operationId)) return `/transaction/${operationId}`;
  return (type && NOTICE_ROUTES[type]) || null;
}

/** Where a tapped push notification takes the agent (Velynt sends the operation as `transfer_id`). */
export function routeForNotification(data: Record<string, unknown> | undefined): string {
  return routeForNotice(typeof data?.type === 'string' ? data.type : undefined, data?.transfer_id ?? data?.transaction_id) ?? '/notifications';
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
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
    });
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      router.push(routeForNotification(response.notification.request.content.data as Record<string, unknown>) as never);
    });
    // A push tapped while the app was closed opened it cold: the listener above was not there yet.
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response || handledLaunchPush === response.notification.request.identifier) return;
        handledLaunchPush = response.notification.request.identifier;
        router.push(routeForNotification(response.notification.request.content.data as Record<string, unknown>) as never);
      })
      .catch(() => undefined);
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [qc]);
}
