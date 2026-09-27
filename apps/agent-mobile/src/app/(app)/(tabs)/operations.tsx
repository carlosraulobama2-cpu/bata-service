import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Period } from '../../../api/endpoints';
import { Card } from '../../../components/Card';
import { Chips } from '../../../components/Chips';
import { Screen } from '../../../components/Screen';
import { EmptyState, ErrorState, Skeleton } from '../../../components/States';
import { Text } from '../../../components/Text';
import { TransactionRow } from '../../../components/TransactionRow';
import { useTransactionList } from '../../../features/queries';
import { useTheme } from '../../../theme/ThemeProvider';
import { space } from '../../../theme/tokens';
import { formatDate, formatTime, money } from '../../../utils/format';

type TypeFilter = 'all' | 'cash_in' | 'cash_out' | 'qr_payment';

export default function OperationsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [period, setPeriod] = useState<Period>('today');
  const [type, setType] = useState<TypeFilter>('all');
  const q = useTransactionList(period, type === 'all' ? undefined : type);
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const totals = q.data?.pages[0]?.totals;
  const multiDay = period !== 'today' && period !== 'yesterday';

  return (
    <Screen edges={['top']} padded={false}>
      <View style={styles.head}>
        <Text variant="title" accessibilityRole="header">
          {t('operations.title')}
        </Text>
        <Chips
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'today', label: t('operations.today') },
            { value: 'yesterday', label: t('operations.yesterday') },
            { value: 'last_7_days', label: t('operations.last7') },
            { value: 'this_month', label: t('operations.month') }
          ]}
        />
        <Chips
          value={type}
          onChange={setType}
          options={[
            { value: 'all', label: t('operations.all') },
            { value: 'cash_in', label: t('operations.filterIn') },
            { value: 'cash_out', label: t('operations.filterOut') },
            { value: 'qr_payment', label: t('operations.filterQr') }
          ]}
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(tx) => tx.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => q.refetch()} tintColor={colors.primary} />}
        ListHeaderComponent={
          totals ? (
            <Card style={styles.totals}>
              <Total label={t('dashboard.cashIn')} value={money(totals.cash_in)} />
              <Total label={t('dashboard.cashOut')} value={money(totals.cash_out)} />
              <Total label={t('dashboard.qrPayments')} value={money(totals.qr_payment)} />
              <Total label={t('dashboard.commissions')} value={money(totals.commissions)} accent />
            </Card>
          ) : null
        }
        renderItem={({ item }) => (
          <TransactionRow tx={item} onPress={() => router.push(`/transaction/${item.id}`)} showDate={multiDay ? `${formatDate(item.created_at)} ${formatTime(item.created_at)}` : undefined} />
        )}
        ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: colors.border }]} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ margin: space.lg }} /> : null}
        ListEmptyComponent={
          q.isLoading ? (
            <View style={{ gap: space.lg, padding: space.sm }}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={48} />
              ))}
            </View>
          ) : q.error ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <EmptyState message={t('operations.empty')} />
          )
        }
      />
    </Screen>
  );
}

function Total({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.total}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <Text variant="label" numeric color={accent ? 'success' : 'text'} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.sm, paddingBottom: space.sm },
  list: { paddingHorizontal: space.md, paddingBottom: space.xxl, flexGrow: 1 },
  totals: { flexDirection: 'row', marginHorizontal: space.sm, marginBottom: space.md },
  total: { flex: 1, gap: 2 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 64 }
});
