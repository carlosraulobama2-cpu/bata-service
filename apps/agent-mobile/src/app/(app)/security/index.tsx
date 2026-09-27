import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ChevronRight, KeyRound, LogIn, MonitorSmartphone, ShieldAlert, Smartphone } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ApiError, newIdempotencyKey } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import type { StepUp } from '../../../api/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ConfirmSheet } from '../../../components/ConfirmSheet';
import { Header } from '../../../components/Header';
import { Screen } from '../../../components/Screen';
import { ErrorState, Skeleton } from '../../../components/States';
import { Text } from '../../../components/Text';
import { errorMessage } from '../../../features/errors';
import { useAccessHistory, useDevices, useSecurityOverview, useSessions } from '../../../features/queries';
import { useTheme } from '../../../theme/ThemeProvider';
import { space } from '../../../theme/tokens';
import { formatDate, formatDateTime } from '../../../utils/format';

const FAILURE_EVENTS = new Set(['login_failed', 'otp_failed', 'account_locked', 'new_device_detected']);

export default function SecurityScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const overview = useSecurityOverview();
  const sessions = useSessions();
  const devices = useDevices();
  const history = useAccessHistory();
  const [sheet, setSheet] = useState<{ busy: boolean; error: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  const o = overview.data;
  const others = (sessions.data?.data ?? []).filter((x) => !x.current);
  const events = history.data?.pages.flatMap((p) => p.data) ?? [];

  const revokeOthers = async (stepUp: StepUp) => {
    keyRef.current ??= newIdempotencyKey();
    setSheet({ busy: true, error: null });
    try {
      const res = await endpoints.revokeOtherSessions({ key: keyRef.current, stepUp, prompt: t('confirm.biometricPrompt') });
      keyRef.current = null;
      setSheet(null);
      setNotice(t('security.revokeOthersDone', { count: res.revoked }));
      void qc.invalidateQueries({ queryKey: ['security'] });
    } catch (err) {
      if (!(err instanceof ApiError && err.isNetwork)) keyRef.current = null;
      setSheet({ busy: false, error: err instanceof ApiError && err.code === 'BIOMETRIC_CANCELLED' ? null : errorMessage(err, t) });
    }
  };

  return (
    <Screen
      header={<Header title={t('security.title')} />}
      scroll
      refreshing={overview.isRefetching}
      onRefresh={() => Promise.all([overview.refetch(), sessions.refetch(), devices.refetch(), history.refetch()])}
    >
      {overview.error ? <ErrorState error={overview.error} onRetry={() => overview.refetch()} /> : null}
      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {o && o.failed_attempts_last_7_days > 0 ? (
        <View style={{ marginBottom: space.md }}>
          <Banner tone="warning">{`${t('security.failedAttempts', { count: o.failed_attempts_last_7_days })} ${t('security.notYou')}`}</Banner>
        </View>
      ) : null}

      <Card>
        {o ? (
          <>
            <Item icon={<Smartphone size={20} color={colors.text} />} title={t('security.thisDevice')} caption={`${o.this_device.model ?? o.this_device.platform}${o.this_device.trusted_at ? ` · ${t('security.trustedSince', { date: formatDate(o.this_device.trusted_at) })}` : ''}`} />
            <Item
              icon={<LogIn size={20} color={colors.text} />}
              title={t('security.previousLogin')}
              caption={o.previous_login ? [formatDateTime(o.previous_login.at), o.previous_login.device_model, o.previous_login.ip_masked].filter(Boolean).join(' · ') : t('security.noPreviousLogin')}
            />
            <Item icon={<KeyRound size={20} color={colors.primary} />} title={t('security.changePin')} caption={t('security.pinSetAt', { date: formatDate(o.pin.set_at) })} onPress={() => router.push('/security/pin')} last testID="security-change-pin" />
          </>
        ) : (
          <Skeleton height={140} />
        )}
      </Card>

      <Text variant="overline" color="textMuted" style={styles.section}>
        {t('security.sessions')}
      </Text>
      <Card>
        {(sessions.data?.data ?? []).map((x, i, all) => (
          <Item
            key={x.id}
            icon={<MonitorSmartphone size={20} color={x.current ? colors.success : colors.text} />}
            title={`${x.device_model ?? x.platform}${x.current ? ` · ${t('security.currentSession')}` : ''}`}
            caption={[t('security.lastUsed', { date: formatDateTime(x.last_used_at ?? x.created_at) }), x.ip_masked].filter(Boolean).join(' · ')}
            last={i === all.length - 1}
          />
        ))}
        {sessions.isLoading ? <Skeleton height={48} /> : null}
      </Card>
      <View style={{ marginTop: space.sm }}>
        {others.length > 0 ? (
          <Button variant="danger" label={t('security.revokeOthers')} onPress={() => setSheet({ busy: false, error: null })} testID="security-revoke-others" />
        ) : sessions.data ? (
          <Text variant="caption" color="textMuted" align="center">
            {t('security.noOtherSessions')}
          </Text>
        ) : null}
      </View>

      <Text variant="overline" color="textMuted" style={styles.section}>
        {t('security.devices')}
      </Text>
      <Card>
        {(devices.data?.data ?? []).map((d, i, all) => (
          <Item
            key={d.id}
            icon={<Smartphone size={20} color={d.status === 'revoked' ? colors.textMuted : colors.text} />}
            title={`${d.model ?? d.platform}${d.current ? ` · ${t('security.thisDevice')}` : ''}`}
            caption={d.status === 'revoked' ? `${t('security.deviceRevoked')}${d.revoked_at ? ` · ${formatDate(d.revoked_at)}` : ''}` : [d.os_version, d.app_version && `v${d.app_version}`, d.last_seen_at && t('security.lastUsed', { date: formatDateTime(d.last_seen_at) })].filter(Boolean).join(' · ')}
            last={i === all.length - 1}
          />
        ))}
        {devices.isLoading ? <Skeleton height={48} /> : null}
      </Card>

      <Text variant="overline" color="textMuted" style={styles.section}>
        {t('security.history')}
      </Text>
      <Card>
        {events.map((e, i) => {
          const bad = FAILURE_EVENTS.has(e.event);
          return (
            <Item
              key={e.id}
              icon={bad ? <ShieldAlert size={20} color={colors.warning} /> : <LogIn size={20} color={colors.textMuted} />}
              title={t(`security.events.${e.event}`, { defaultValue: e.event })}
              caption={[formatDateTime(e.at), e.device_model, e.ip_masked].filter(Boolean).join(' · ')}
              last={i === events.length - 1}
            />
          );
        })}
        {history.isLoading ? <Skeleton height={48} /> : null}
      </Card>
      {history.hasNextPage ? <Button variant="ghost" label={t('security.loadMore')} loading={history.isFetchingNextPage} onPress={() => void history.fetchNextPage()} /> : null}

      <ConfirmSheet
        visible={!!sheet}
        busy={!!sheet?.busy}
        error={sheet?.error ?? null}
        onSubmit={revokeOthers}
        onClose={() => setSheet((x) => (x?.busy ? x : null))}
        summary={
          <Text variant="headline" align="center">
            {t('security.revokeOthers')}
          </Text>
        }
      />
    </Screen>
  );
}

function Item({ icon, title, caption, onPress, last, testID }: { icon: React.ReactNode; title: string; caption?: string; onPress?: () => void; last?: boolean; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      testID={testID}
      style={({ pressed }) => [styles.item, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, pressed && { opacity: 0.7 }]}
    >
      {icon}
      <View style={styles.flex}>
        <Text variant="bodyStrong">{title}</Text>
        {caption ? (
          <Text variant="caption" color="textMuted">
            {caption}
          </Text>
        ) : null}
      </View>
      {onPress ? <ChevronRight size={20} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: space.xl, marginBottom: space.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: 56 },
  flex: { flex: 1, gap: 2 }
});
