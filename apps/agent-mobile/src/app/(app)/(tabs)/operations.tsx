import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ArrowDownToLine, ArrowUpFromLine, Coins, type LucideIcon } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Period } from '../../../api/endpoints';
import type { Transaction } from '../../../api/types';
import { Card } from '../../../components/Card';
import { Screen } from '../../../components/Screen';
import { EmptyState, ErrorState, Skeleton } from '../../../components/States';
import { Text } from '../../../components/Text';
import { TransactionRow } from '../../../components/TransactionRow';
import { useMe, useTransactionList } from '../../../features/queries';
import { useSettings } from '../../../state/settings';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space, tintBg, tints } from '../../../theme/tokens';
import { formatDate, formatTime, money } from '../../../utils/format';

type TypeFilter = 'all' | 'cash_in' | 'cash_out';
type Entry = { kind: 'day'; key: string; label: string } | { kind: 'tx'; key: string; tx: Transaction; first: boolean; last: boolean };

/** Operaciones: the period's summary (earnings, deposits, withdrawals) and every operation, grouped by day. */
export default function OperationsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const me = useMe();
  const active = me.data?.agent?.status === 'active';
  // Deposit and withdraw need the payment PIN (the home screen asks to create it).
  const canOperate = active && !!me.data?.user.has_pin;
  const hidden = useSettings((s) => s.hideBalance);
  const show = (amount: number) => (hidden ? t('dashboard.hidden') : money(amount));
  const [period, setPeriod] = useState<Period>('today');
  const [type, setType] = useState<TypeFilter>('all');
  const q = useTransactionList(period, type === 'all' ? undefined : type);
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const totals = q.data?.pages[0]?.totals;
  const multiDay = period !== 'today' && period !== 'yesterday';

  // Day headers between the rows; each day's rows sit in one rounded group.
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    let day = '';
    rows.forEach((tx, i) => {
      const d = formatDate(tx.created_at);
      if (multiDay && d !== day) {
        day = d;
        out.push({ kind: 'day', key: `day-${d}`, label: d });
      }
      const next = rows[i + 1];
      out.push({ kind: 'tx', key: tx.id, tx, first: !multiDay ? i === 0 : out[out.length - 1]?.kind === 'day', last: !next || (multiDay && formatDate(next.created_at) !== d) });
    });
    return out;
  }, [rows, multiDay]);

  const inVol = totals?.cash_in.volume ?? 0;
  const outVol = totals?.cash_out.volume ?? 0;
  const inShare = inVol + outVol > 0 ? inVol / (inVol + outVol) : 0.5;
  const periods: { value: Period; label: string }[] = [
    { value: 'today', label: t('operations.today') },
    { value: 'yesterday', label: t('operations.yesterday') },
    { value: 'last_7_days', label: t('operations.last7') },
    { value: 'this_month', label: t('operations.month') }
  ];

  const header = (
    <View style={styles.headerWrap}>
      <LinearGradient colors={[colors.hero, colors.heroEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={[styles.heroIcon, { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
            <Coins size={18} color={colors.heroText} />
          </View>
          <Text variant="overline" style={{ color: colors.heroMuted }}>
            Tus ganancias · {periods.find((p) => p.value === period)?.label}
          </Text>
        </View>
        {totals ? (
          <Text variant="display" numeric style={{ color: colors.heroText }} numberOfLines={1} adjustsFontSizeToFit>
            {show(totals.commission)}
          </Text>
        ) : (
          <Skeleton width={180} height={40} />
        )}
        <View style={styles.heroTiles}>
          <HeroTile Icon={ArrowDownToLine} tint="#7BE0A6" label={t('operations.filterIn')} count={totals?.cash_in.count} value={totals ? show(inVol) : '—'} />
          <HeroTile Icon={ArrowUpFromLine} tint="#FFB48F" label={t('operations.filterOut')} count={totals?.cash_out.count} value={totals ? show(outVol) : '—'} />
        </View>
        {/* Share of deposits vs withdrawals in the period. */}
        <View style={styles.split} accessibilityLabel={`${Math.round(inShare * 100)} % depósitos`}>
          <View style={{ flex: Math.max(inShare, 0.02), backgroundColor: '#7BE0A6', borderRadius: radius.pill }} />
          <View style={{ flex: Math.max(1 - inShare, 0.02), backgroundColor: '#FFB48F', borderRadius: radius.pill }} />
        </View>
      </LinearGradient>

      {canOperate ? (
        <View style={styles.actions}>
          <ActionPill Icon={ArrowDownToLine} tint={tints.green} label="Depositar" onPress={() => router.push('/cash-in')} />
          <ActionPill Icon={ArrowUpFromLine} tint={tints.orange} label="Retirar" onPress={() => router.push('/cash-out')} />
        </View>
      ) : null}

      <View style={[styles.segment, { backgroundColor: colors.surfaceAlt }]} accessibilityRole="tablist">
        {periods.map((p) => {
          const on = p.value === period;
          return (
            <Pressable
              key={p.value}
              onPress={() => setPeriod(p.value)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={[styles.segmentItem, on && { backgroundColor: colors.surface, shadowColor: '#4A2040', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }]}
            >
              <Text variant="label" color={on ? 'primary' : 'textMuted'} style={on ? { fontWeight: '700' } : undefined}>
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.filters}>
        {(
          [
            { value: 'all', label: t('operations.all'), tint: colors.primary },
            { value: 'cash_in', label: t('operations.filterIn'), tint: tints.green },
            { value: 'cash_out', label: t('operations.filterOut'), tint: tints.orange }
          ] as { value: TypeFilter; label: string; tint: string }[]
        ).map((f) => {
          const on = f.value === type;
          return (
            <Pressable
              key={f.value}
              onPress={() => setType(f.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.filter, { backgroundColor: on ? tintBg(f.tint) : 'transparent', borderColor: on ? f.tint : colors.border }]}
            >
              <View style={[styles.filterDot, { backgroundColor: f.tint }]} />
              <Text variant="label" style={{ color: on ? f.tint : colors.textMuted, fontWeight: on ? '700' : '500' }}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
        <Text variant="caption" color="textMuted" style={{ marginLeft: 'auto' }}>
          {totals ? `${(totals.cash_in.count ?? 0) + (totals.cash_out.count ?? 0)} op.` : ''}
        </Text>
      </View>
    </View>
  );

  // Not an active agent yet: the operations API answers agent_not_active, so say what it means instead.
  if (me.data && !active) {
    return (
      <Screen edges={['top']}>
        <Text variant="title" style={{ paddingTop: space.lg }} accessibilityRole="header">
          {t('operations.title')}
        </Text>
        <EmptyState message="Cuando Velynt te dé de alta como agente, aquí verás tus depósitos, retiros y ganancias." />
      </Screen>
    );
  }

  return (
    <Screen edges={['top']} padded={false}>
      <View style={styles.titleRow}>
        <Text variant="title" accessibilityRole="header">
          {t('operations.title')}
        </Text>
        <Text variant="caption" color="textMuted">
          Depósitos y retiros de tu local
        </Text>
      </View>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.key}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => q.refetch()} tintColor={colors.primary} />}
        ListHeaderComponent={header}
        renderItem={({ item }) =>
          item.kind === 'day' ? (
            <Text variant="overline" color="textMuted" style={styles.day}>
              {item.label}
            </Text>
          ) : (
            <View
              style={[
                styles.rowWrap,
                { backgroundColor: colors.surfaceAlt },
                item.first && styles.rowFirst,
                item.last && styles.rowLast,
                !item.last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }
              ]}
            >
              <TransactionRow tx={item.tx} onPress={() => router.push(`/transaction/${item.tx.id}`)} showDate={multiDay ? formatTime(item.tx.created_at) : undefined} />
            </View>
          )
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ margin: space.lg }} /> : null}
        ListEmptyComponent={
          q.isLoading ? (
            <Card style={{ gap: space.lg }}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={44} />
              ))}
            </Card>
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

function HeroTile({ Icon, tint, label, count, value }: { Icon: LucideIcon; tint: string; label: string; count?: number; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.heroTile, { backgroundColor: 'rgba(255,255,255,0.10)' }]}>
      <View style={styles.heroTileTop}>
        <Icon size={16} color={tint} />
        <Text variant="caption" style={{ color: colors.heroMuted }}>
          {label}
          {count !== undefined ? ` · ${count}` : ''}
        </Text>
      </View>
      <Text variant="bodyStrong" numeric style={{ color: colors.heroText }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function ActionPill({ Icon, tint, label, onPress }: { Icon: LucideIcon; tint: string; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.actionPill, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.7 }]}>
      <View style={[styles.actionIcon, { backgroundColor: tintBg(tint) }]}>
        <Icon size={16} color={tint} />
      </View>
      <Text variant="bodyStrong">{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titleRow: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.sm, gap: 2 },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  headerWrap: { gap: space.md, marginBottom: space.md },
  hero: { borderRadius: radius.card, padding: space.xl, gap: space.md },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  heroIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  heroTiles: { flexDirection: 'row', gap: space.sm },
  heroTile: { flex: 1, borderRadius: radius.lg, padding: space.md, gap: 4 },
  heroTileTop: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  split: { flexDirection: 'row', height: 6, gap: 3 },
  actions: { flexDirection: 'row', gap: space.sm },
  actionPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: 52, borderRadius: radius.pill, borderWidth: 1 },
  actionIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', borderRadius: radius.pill, padding: 4 },
  segmentItem: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 40, borderRadius: radius.pill },
  filters: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  filter: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, minHeight: 36, borderRadius: radius.pill, borderWidth: 1 },
  filterDot: { width: 8, height: 8, borderRadius: 4 },
  day: { marginTop: space.md, marginBottom: space.sm, marginLeft: space.xs },
  rowWrap: { paddingHorizontal: space.sm },
  rowFirst: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: space.xs },
  rowLast: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, paddingBottom: space.xs }
});
