import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight, Bell, Settings, Wallet } from 'lucide-react-native';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/endpoints';
import type { AppNotification } from '../../api/types';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { EmptyState, ErrorState, Skeleton } from '../../components/States';
import { Text } from '../../components/Text';
import { useNotifications } from '../../features/queries';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { formatRelative } from '../../utils/format';

/** Notice types Velynt sends to an agent account (the text itself comes from the server). */
const ICONS: Record<string, typeof Bell> = {
  cash_in: ArrowDownLeft,
  cash_out: ArrowUpRight,
  agent_low_float: Wallet
};
const ALERTS = new Set(['agent_low_float', 'security', 'cashout_locked']);

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const q = useNotifications();
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const unread = q.data?.pages[0]?.unread_count ?? 0;

  const refreshBadge = () => qc.invalidateQueries({ queryKey: ['notifications'] });

  const open = async (n: AppNotification) => {
    if (!n.read_at) await endpoints.readNotification(n.id).catch(() => undefined);
    void refreshBadge();
    if (n.related_operation_id) router.push(`/transaction/${n.related_operation_id}`);
  };

  const text = (n: AppNotification, part: 'title' | 'body') => n[part] || (part === 'title' ? t('notifications.fallbackTitle') : '');

  return (
    <Screen
      header={
        <Header
          title={t('notifications.title')}
          trailing={
            <Pressable onPress={() => router.push('/notification-settings')} accessibilityRole="button" accessibilityLabel={t('notifications.settings')} hitSlop={10} testID="notifications-settings">
              <Settings size={22} color={colors.text} />
            </Pressable>
          }
        />
      }
      padded={false}
      footer={
        unread > 0 ? (
          <Button
            variant="secondary"
            label={t('notifications.readAll')}
            onPress={async () => {
              await endpoints.readAllNotifications().catch(() => undefined);
              await refreshBadge();
            }}
            testID="notifications-read-all"
          />
        ) : undefined
      }
    >
      <FlatList
        data={rows}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => q.refetch()} tintColor={colors.primary} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ margin: space.lg }} /> : null}
        ListEmptyComponent={
          q.isLoading ? (
            <View style={{ gap: space.md }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={64} />
              ))}
            </View>
          ) : q.error ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <EmptyState message={t('notifications.empty')} />
          )
        }
        renderItem={({ item }) => {
          const Icon = ICONS[item.type] ?? Bell;
          const isUnread = !item.read_at;
          const alert = ALERTS.has(item.type);
          return (
            <Pressable
              onPress={() => void open(item)}
              accessibilityRole="button"
              accessibilityLabel={`${isUnread ? `${t('notifications.unread')}. ` : ''}${text(item, 'title')}. ${text(item, 'body')}`}
              style={({ pressed }) => [styles.item, { backgroundColor: isUnread ? colors.primarySoft : colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
            >
              <View style={[styles.icon, { backgroundColor: alert ? colors.warningSoft : colors.surfaceAlt }]}>
                <Icon size={20} color={alert ? colors.warning : colors.text} />
              </View>
              <View style={styles.texts}>
                <View style={styles.titleRow}>
                  <Text variant="bodyStrong" style={styles.flex} numberOfLines={1}>
                    {text(item, 'title')}
                  </Text>
                  <Text variant="caption" color="textMuted">
                    {formatRelative(item.created_at, t)}
                  </Text>
                </View>
                <Text variant="caption" color="textMuted" numberOfLines={2}>
                  {text(item, 'body')}
                </Text>
              </View>
              {isUnread ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.sm, flexGrow: 1 },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 }
});
