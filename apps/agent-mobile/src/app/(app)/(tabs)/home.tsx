import { router } from 'expo-router';
import { ArrowDownToLine, ArrowUpFromLine, Bell, Info, ScanLine } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../../api/client';
import { ActionTile } from '../../../components/ActionTile';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Screen } from '../../../components/Screen';
import { EmptyState, ErrorState, Skeleton } from '../../../components/States';
import { Text } from '../../../components/Text';
import { TransactionRow } from '../../../components/TransactionRow';
import { usePushPermission } from '../../../features/push';
import { useMe, useToday, useUnreadCount } from '../../../features/queries';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { formatTime, localHour, money } from '../../../utils/format';

/** Same threshold as the server's default low-float notice (agent_low_float_alert_minor). */
const LOW_FLOAT = 100_000;

export default function Dashboard() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const me = useMe();
  const today = useToday();
  const unread = useUnreadCount().data?.unread_count ?? 0;
  const push = usePushPermission();
  const [infoOpen, setInfoOpen] = useState(false);

  const refreshing = me.isRefetching || today.isRefetching;
  const refresh = () => Promise.all([me.refetch(), today.refetch()]);
  const offline = [me.error, today.error].some((e) => e instanceof ApiError && e.isNetwork);

  const agent = me.data?.agent;
  const user = me.data?.user;
  const hasPin = !!user?.has_pin;
  const canOperate = agent?.status === 'active' && hasPin;
  const hour = localHour();
  const greetingKey = hour < 12 ? 'dashboard.greetingMorning' : hour < 20 ? 'dashboard.greetingAfternoon' : 'dashboard.greetingEvening';
  const firstName = user?.name.split(' ')[0] ?? '';

  return (
    <Screen scroll edges={['top']} refreshing={refreshing} onRefresh={refresh} padded={false}>
      {/* Hero: who I am + what I can operate with */}
      <View style={[styles.hero, { backgroundColor: colors.hero }]}>
        <View style={styles.heroTop}>
          <View style={styles.flex}>
            <Text variant="overline" style={{ color: colors.heroMuted }} numberOfLines={1}>
              {agent ? `${t('common.appName')} · ${agent.code}` : t('common.appName')}
            </Text>
            {user ? (
              <Text variant="headline" style={{ color: colors.heroText }} numberOfLines={1}>
                {t(greetingKey, { name: firstName })}
              </Text>
            ) : (
              <Skeleton width={180} height={22} style={{ opacity: 0.3 }} />
            )}
          </View>
          <Pressable
            onPress={() => router.push('/notifications')}
            accessibilityRole="button"
            accessibilityLabel={t('notifications.bellLabel', { count: unread })}
            hitSlop={8}
            style={styles.bell}
            testID="home-bell"
          >
            <Bell size={24} color={colors.heroText} />
            {unread > 0 ? (
              <View style={[styles.badge, { backgroundColor: colors.danger, borderColor: colors.hero }]}>
                <Text variant="caption" style={styles.badgeText}>
                  {unread > 9 ? '9+' : unread}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        <Pressable style={styles.balanceLabel} onPress={() => setInfoOpen(true)} accessibilityRole="button" accessibilityLabel={t('dashboard.balancesInfoTitle')}>
          <Text variant="label" style={{ color: colors.heroMuted }}>
            {t('dashboard.floatLabel')}
          </Text>
          <Info size={16} color={colors.heroMuted} />
        </Pressable>
        {me.data ? (
          <Text variant="display" numeric style={{ color: colors.heroText }} adjustsFontSizeToFit numberOfLines={1} accessibilityLiveRegion="polite">
            {money(me.data.float)}
          </Text>
        ) : me.isLoading ? (
          <Skeleton width={220} height={40} style={{ opacity: 0.3 }} />
        ) : (
          <Text variant="display" style={{ color: colors.heroMuted }}>
            —
          </Text>
        )}
        <Text variant="caption" style={{ color: colors.heroMuted }}>
          {t('dashboard.floatCaption')}
          {me.data ? `  ·  ${t('common.updatedAt', { time: formatTime(me.data.as_of) })}` : ''}
        </Text>
      </View>

      <View style={styles.body}>
        {/* Primary actions: always visible, big, two taps from any operation */}
        <View style={styles.actions}>
          <View style={styles.actionRow}>
            <ActionTile label={t('dashboard.actionDeposit')} Icon={ArrowDownToLine} onPress={() => router.push('/cash-in')} disabled={!canOperate || offline} emphasis />
            <ActionTile label={t('dashboard.actionWithdraw')} Icon={ArrowUpFromLine} onPress={() => router.push('/cash-out')} disabled={!canOperate || offline} emphasis />
          </View>
          <View style={styles.actionRow}>
            <ActionTile label={t('dashboard.actionScan')} Icon={ScanLine} onPress={() => router.push('/qr/scan')} disabled={!canOperate || offline} />
          </View>
        </View>

        {offline ? <Banner tone="offline">{t('common.offline')}</Banner> : null}
        <AgentStateBanner />
        {agent?.status === 'active' && user && !hasPin ? (
          <Banner tone="warning" onPress={() => router.push('/security/pin')} action={t('pinChange.createAction')}>
            {t('dashboard.pinMissing')}
          </Banner>
        ) : null}
        {push.status === 'undetermined' && canOperate ? (
          <Banner tone="info" onPress={() => void push.enable()} action={t('notifications.enableAction')}>
            {t('notifications.enableBanner')}
          </Banner>
        ) : null}
        {canOperate && me.data && me.data.float < LOW_FLOAT ? <Banner tone="warning">{t('dashboard.lowFloat')}</Banner> : null}

        {/* Today at a glance: numbers, not charts */}
        <Card>
          <Text variant="overline" color="textMuted" style={styles.cardTitle}>
            {t('dashboard.today')}
          </Text>
          {today.data ? (
            <View style={styles.grid}>
              <Stat label={t('dashboard.cashIn')} value={money(today.data.totals.cash_in.volume)} />
              <Stat label={t('dashboard.cashOut')} value={money(today.data.totals.cash_out.volume)} />
              <Stat label={t('dashboard.netCash')} value={money(today.data.totals.cash_in.volume - today.data.totals.cash_out.volume)} />
              <Stat label={t('dashboard.commissions')} value={money(today.data.totals.commission)} accent />
            </View>
          ) : today.error && !offline ? (
            <ErrorState error={today.error} onRetry={() => today.refetch()} />
          ) : (
            <View style={styles.grid}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={styles.stat}>
                  <Skeleton width={70} height={12} />
                  <Skeleton width={110} height={20} />
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card padded={false}>
          <View style={styles.sectionHeader}>
            <Text variant="overline" color="textMuted">
              {t('dashboard.recent')}
            </Text>
            <Pressable onPress={() => router.push('/operations')} hitSlop={12} accessibilityRole="link">
              <Text variant="label" color="primary">
                {t('common.seeAll')}
              </Text>
            </Pressable>
          </View>
          <View style={styles.list}>
            {today.data?.data.length === 0 ? <EmptyState message={t('dashboard.noOperations')} /> : null}
            {today.data?.data.map((tx) => <TransactionRow key={tx.id} tx={tx} onPress={() => router.push(`/transaction/${tx.id}`)} />)}
            {!today.data && today.isLoading
              ? [0, 1, 2].map((i) => (
                  <View key={i} style={styles.skeletonRow}>
                    <Skeleton width={40} height={40} style={{ borderRadius: 20 }} />
                    <View style={{ flex: 1, gap: 6 }}>
                      <Skeleton width="50%" />
                      <Skeleton width="30%" height={12} />
                    </View>
                  </View>
                ))
              : null}
          </View>
        </Card>
      </View>

      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
          <Card style={styles.modalCard}>
            <Text variant="headline">{t('dashboard.balancesInfoTitle')}</Text>
            <Text variant="body">{t('dashboard.balancesInfoFloat')}</Text>
            <Text variant="body">{t('dashboard.balancesInfoCommissions')}</Text>
            <Text variant="body">{t('dashboard.balancesInfoCash')}</Text>
            <Button label={t('common.done')} onPress={() => setInfoOpen(false)} />
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

/** Why the agent cannot operate yet (no application, under review, rejected, suspended). */
function AgentStateBanner() {
  const { t } = useTranslation();
  const me = useMe();
  if (!me.data) return null;
  const agent = me.data.agent;
  if (!agent) {
    return (
      <Banner tone="info" onPress={() => router.push('/apply')} action={t('apply.action')}>
        {t('apply.notAnAgent')}
      </Banner>
    );
  }
  if (agent.status === 'pending') return <Banner tone="info">{t('apply.pending', { code: agent.code })}</Banner>;
  if (agent.status === 'rejected') {
    return (
      <Banner tone="warning" onPress={() => router.push('/apply')} action={t('apply.again')}>
        {agent.status_note ? `${t('apply.rejected')} ${agent.status_note}` : t('apply.rejected')}
      </Banner>
    );
  }
  if (agent.status === 'suspended') {
    return (
      <Banner tone="danger" onPress={() => router.push('/help')} action={t('support.contact')}>
        {t('errors.agent_not_active')}
      </Banner>
    );
  }
  return null;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <Text variant="headline" numeric color={accent ? 'success' : 'text'} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxxl + space.lg, gap: space.xs, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xl },
  bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: space.sm },
  badge: { position: 'absolute', top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  badgeText: { color: '#FFFFFF', fontSize: 10, lineHeight: 12, fontWeight: '700' },
  balanceLabel: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', minHeight: 32 },
  body: { paddingHorizontal: space.lg, marginTop: -space.xxxl, gap: space.lg, paddingBottom: space.xxl },
  actions: { gap: space.sm },
  actionRow: { flexDirection: 'row', gap: space.sm },
  cardTitle: { marginBottom: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg },
  stat: { width: '50%', gap: 4, paddingRight: space.sm },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs },
  list: { paddingHorizontal: space.sm, paddingBottom: space.sm },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: space.xl },
  modalCard: { gap: space.md }
});
