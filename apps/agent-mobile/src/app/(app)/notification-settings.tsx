import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react-native';
import { Linking, StyleSheet, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/endpoints';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { ErrorState, Skeleton } from '../../components/States';
import { Text } from '../../components/Text';
import { errorMessage } from '../../features/errors';
import { usePushPermission } from '../../features/push';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

type Pref = { type: string; push_enabled: boolean; locked: boolean };

export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const push = usePushPermission();
  const prefs = useQuery({ queryKey: ['notifications', 'preferences'], queryFn: endpoints.notificationPreferences });
  const save = useMutation({
    mutationFn: (change: Record<string, boolean>) => endpoints.setNotificationPreferences(change),
    // Optimistic: the switch moves at once and comes back if the server says no.
    onMutate: async (change) => {
      await qc.cancelQueries({ queryKey: ['notifications', 'preferences'] });
      const previous = qc.getQueryData<{ data: Pref[] }>(['notifications', 'preferences']);
      if (previous) qc.setQueryData(['notifications', 'preferences'], { data: previous.data.map((p) => (p.type in change ? { ...p, push_enabled: change[p.type]! } : p)) });
      return { previous };
    },
    onError: (_err, _change, ctx) => ctx?.previous && qc.setQueryData(['notifications', 'preferences'], ctx.previous),
    onSuccess: (data) => qc.setQueryData(['notifications', 'preferences'], data)
  });

  return (
    <Screen header={<Header title={t('notifications.settingsTitle')} />} scroll>
      <View style={styles.content}>
        {push.status === 'granted' ? <Banner tone="success">{t('notifications.pushOn')}</Banner> : null}
        {push.status === 'undetermined' ? (
          <View style={{ gap: space.sm }}>
            <Banner tone="info">{t('notifications.pushOff')}</Banner>
            <Button label={t('notifications.enableAction')} onPress={() => void push.enable()} testID="push-enable" />
          </View>
        ) : null}
        {push.status === 'denied' ? (
          <View style={{ gap: space.sm }}>
            <Banner tone="warning">{t('notifications.pushDenied')}</Banner>
            <Button variant="secondary" label={t('notifications.openSettings')} onPress={() => void Linking.openSettings()} />
          </View>
        ) : null}
        {push.status === 'unsupported' ? <Banner tone="offline">{t('notifications.pushUnsupported')}</Banner> : null}

        <Text variant="overline" color="textMuted">
          {t('notifications.whichOnes')}
        </Text>
        {prefs.error ? <ErrorState error={prefs.error} onRetry={() => prefs.refetch()} /> : null}
        {save.error ? <Banner tone="danger">{errorMessage(save.error, t)}</Banner> : null}
        <Card>
          {prefs.isLoading ? <Skeleton height={200} /> : null}
          {prefs.data?.data.map((p, i, all) => (
            <View key={p.type} style={[styles.row, i < all.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
              <View style={styles.flex}>
                <Text variant="bodyStrong">{t(`notifications.types.${p.type}`, { defaultValue: p.type })}</Text>
                {p.locked ? (
                  <View style={styles.locked}>
                    <Lock size={12} color={colors.textMuted} />
                    <Text variant="caption" color="textMuted">
                      {t('notifications.locked')}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Switch
                value={p.push_enabled}
                disabled={p.locked}
                onValueChange={(v) => save.mutate({ [p.type]: v })}
                accessibilityLabel={t(`notifications.types.${p.type}`, { defaultValue: p.type })}
                trackColor={{ true: colors.primary, false: colors.border }}
                testID={`pref-${p.type}`}
              />
            </View>
          ))}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: 56 },
  flex: { flex: 1, gap: 2 },
  locked: { flexDirection: 'row', alignItems: 'center', gap: 4 }
});
