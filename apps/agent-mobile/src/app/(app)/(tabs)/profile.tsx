import { router } from 'expo-router';
import { Bell, ChevronRight, Gauge, LifeBuoy, LogOut, ShieldCheck } from 'lucide-react-native';
import { ReactNode } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { signOut } from '../../../api/auth';
import { Card } from '../../../components/Card';
import { InfoRow } from '../../../components/InfoRow';
import { Screen } from '../../../components/Screen';
import { Skeleton } from '../../../components/States';
import { Text } from '../../../components/Text';
import { config } from '../../../config';
import { useMe } from '../../../features/queries';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const me = useMe();
  const agent = me.data?.agent;
  const user = me.data?.user;
  const initials = (user?.name ?? '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w.charAt(0)).join('');
  const statusColor = agent?.status === 'active' ? colors.success : agent?.status === 'suspended' ? colors.danger : colors.warning;

  const confirmSignOut = () => {
    if (Platform.OS === 'web') return void signOut();
    Alert.alert(t('auth.signOut'), t('auth.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.signOut'), style: 'destructive', onPress: () => void signOut() }
    ]);
  };

  return (
    <Screen scroll edges={['top']} refreshing={me.isRefetching} onRefresh={() => me.refetch()}>
      <Text variant="title" style={styles.title} accessibilityRole="header">
        {t('profile.title')}
      </Text>

      <Card style={styles.identity}>
        <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
          <Text variant="title" color="primary">
            {initials}
          </Text>
        </View>
        {user ? (
          <View style={styles.flex}>
            <Text variant="headline">{user.name}</Text>
            <Text variant="label" color="textMuted">
              {agent?.code ?? user.email}
            </Text>
            {agent ? (
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text variant="caption" style={{ color: statusColor, fontWeight: '700' }}>
                  {t(`profile.agentStatus.${agent.status}`, { defaultValue: agent.status }).toUpperCase()}
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={[styles.flex, { gap: 8 }]}>
            <Skeleton width={140} height={20} />
            <Skeleton width={90} height={14} />
          </View>
        )}
      </Card>

      {agent ? (
        <Card>
          <InfoRow label={t('profile.agentId')} value={agent.code} strong />
          <InfoRow label={t('profile.business')} value={agent.business_name} />
          <InfoRow label={t('profile.location')} value={`${agent.address}, ${agent.city}`} />
          <InfoRow label={t('profile.email')} value={user?.email ?? '—'} last />
        </Card>
      ) : null}

      <Text variant="overline" color="textMuted" style={styles.section}>
        {t('profile.security')}
      </Text>
      <Card padded={false} style={{ overflow: 'hidden' }}>
        <Row icon={<Gauge size={20} color={colors.text} />} label={t('profile.limits')} onPress={() => router.push('/limits')} />
        <Row icon={<ShieldCheck size={20} color={colors.text} />} label={t('profile.securityRow')} onPress={() => router.push('/security')} />
        <Row icon={<Bell size={20} color={colors.text} />} label={t('profile.notifications')} onPress={() => router.push('/notifications')} />
        <Row icon={<LifeBuoy size={20} color={colors.text} />} label={t('profile.help')} onPress={() => router.push('/help')} />
        <Row icon={<LogOut size={20} color={colors.danger} />} label={t('auth.signOut')} danger onPress={confirmSignOut} last />
      </Card>

      <Text variant="caption" color="textMuted" align="center" style={{ marginTop: space.xl }}>
        {t('common.appName')} · {t('profile.version', { version: config.appVersion })}
      </Text>
    </Screen>
  );
}

function Row({ icon, label, caption, onPress, danger, last }: { icon: ReactNode; label: string; caption?: string; onPress?: () => void; danger?: boolean; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, pressed && { backgroundColor: colors.neutralSoft }]}
    >
      {icon}
      <View style={styles.flex}>
        <Text variant="bodyStrong" color={danger ? 'danger' : 'text'}>
          {label}
        </Text>
        {caption ? (
          <Text variant="caption" color="textMuted">
            {caption}
          </Text>
        ) : null}
      </View>
      {onPress && !danger ? <ChevronRight size={20} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { paddingTop: space.lg, paddingBottom: space.lg },
  flex: { flex: 1 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginBottom: space.lg },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  section: { marginTop: space.xl, marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 60, paddingVertical: space.md }
});
