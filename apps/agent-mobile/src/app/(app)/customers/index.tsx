import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/endpoints';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Header } from '../../../components/Header';
import { Screen } from '../../../components/Screen';
import { EmptyState, ErrorState } from '../../../components/States';
import { Text } from '../../../components/Text';
import { useTheme } from '../../../theme/ThemeProvider';
import { space } from '../../../theme/tokens';
import { formatDateTime, money } from '../../../utils/format';

/** Customers served (masked) and the other agents of the city, to send a customer there. */
export default function CustomersScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const customers = useInfiniteQuery({
    queryKey: ['customers'],
    queryFn: ({ pageParam }) => endpoints.customers(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined
  });
  const nearby = useQuery({ queryKey: ['nearby-agents'], queryFn: endpoints.nearbyAgents });
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  const rows = customers.data?.pages.flatMap((p) => p.customers) ?? [];
  return (
    <Screen header={<Header leading="close" onLeading={close} title={t('customers.title')} />} scroll>
      <View style={styles.content}>
        <Text variant="body" color="textMuted">
          {t('customers.intro')}
        </Text>
        {customers.error ? <ErrorState error={customers.error} onRetry={() => customers.refetch()} /> : null}
        {customers.data && rows.length === 0 ? <EmptyState message={t('customers.empty')} /> : null}
        {rows.map((c, index) => (
          <Card key={`${c.customer_id}-${index}`}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{c.name}</Text>
                <Text variant="caption" color="textMuted">
                  {[c.customer_id, c.phone_number].filter(Boolean).join(' · ')}
                </Text>
                <Text variant="caption" color="textMuted">
                  {t('customers.operations', { count: c.operations })} · {t('customers.lastAt', { date: formatDateTime(c.last_at) })}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="caption" color="success">
                  +{money(c.deposits)}
                </Text>
                <Text variant="caption">−{money(c.withdrawals)}</Text>
              </View>
            </View>
          </Card>
        ))}
        {customers.hasNextPage ? <Button variant="ghost" label={t('common.seeAll')} onPress={() => void customers.fetchNextPage()} loading={customers.isFetchingNextPage} /> : null}

        <Text variant="title" style={{ marginTop: space.lg }}>
          {t('customers.nearby')}
        </Text>
        <Text variant="caption" color="textMuted">
          {t('customers.nearbyHint')}
        </Text>
        {nearby.data && nearby.data.length === 0 ? <EmptyState message={t('customers.noNearby')} /> : null}
        {nearby.data?.map((a) => (
          <Card key={a.code}>
            <View style={styles.row}>
              <MapPin size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{a.business_name}</Text>
                <Text variant="caption" color="textMuted">
                  {a.code} · {a.address}
                </Text>
                {a.opening_hours ? <Text variant="caption">{a.opening_hours}</Text> : null}
              </View>
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm, paddingBottom: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md }
});
