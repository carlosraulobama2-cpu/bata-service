import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { newIdempotencyKey } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import { Card } from '../../../components/Card';
import { Header } from '../../../components/Header';
import { InfoRow } from '../../../components/InfoRow';
import { QrDisplay } from '../../../components/QrDisplay';
import { Screen } from '../../../components/Screen';
import { ErrorState, Skeleton } from '../../../components/States';
import { Text } from '../../../components/Text';
import { useMe } from '../../../features/queries';
import { space } from '../../../theme/tokens';

/** Static agent QR: identifies the service point, never carries an amount. */
export default function MyQrScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const q = useQuery({ queryKey: ['qr', 'static'], queryFn: () => endpoints.staticQr(newIdempotencyKey()), staleTime: Infinity });
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  const agent = me.data?.agent;
  return (
    <Screen header={<Header leading="close" onLeading={close} title={t('qr.mineTitle')} />} scroll>
      <View style={styles.content}>
        {q.isLoading ? <Skeleton height={280} /> : null}
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {q.data ? <QrDisplay value={q.data.payload} label={t('qr.mineTitle')} /> : null}
        {agent ? (
          <Card>
            <InfoRow label={t('profile.agentId')} value={agent.agent_code} strong />
            <InfoRow label={t('profile.business')} value={agent.business?.trade_name ?? '—'} last />
          </Card>
        ) : null}
        <Text variant="body" color="textMuted" align="center">
          {t('qr.mineBody')}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.xl, paddingTop: space.md }
});
