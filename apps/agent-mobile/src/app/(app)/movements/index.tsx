import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react-native';
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

/** Float movements: what Velynt assigned or withdrew (with its VLN number) and transfers with other agents. */
export default function MovementsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const list = useQuery({ queryKey: ['float-movements'], queryFn: endpoints.floatMovements });
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  return (
    <Screen header={<Header leading="close" onLeading={close} title={t('movements.title')} />} scroll refreshing={list.isRefetching} onRefresh={() => list.refetch()}>
      <View style={styles.content}>
        <Button variant="secondary" label={t('movements.seeOperations')} onPress={() => router.push('/operations')} />
        <Text variant="title">{t('movements.float')}</Text>
        {list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
        {list.data && list.data.length === 0 ? <EmptyState message={t('movements.empty')} /> : null}
        {list.data?.map((m) => (
          <Card key={m.id}>
            <View style={styles.row}>
              <View style={[styles.icon, { backgroundColor: m.direction === 'in' ? colors.successSoft : colors.neutralSoft }]}>
                {m.direction === 'in' ? <ArrowDownLeft size={20} color={colors.success} /> : <ArrowUpRight size={20} color={colors.text} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{m.label}</Text>
                <Text variant="caption" color="textMuted">
                  {m.code} · {formatDateTime(m.created_at)}
                </Text>
                {m.other_agent ? (
                  <Text variant="caption">{m.direction === 'in' ? t('movements.from', { name: m.other_agent.business_name }) : t('movements.to', { name: m.other_agent.business_name })}</Text>
                ) : null}
                {m.reason ? <Text variant="caption" color="textMuted">{m.reason}</Text> : null}
              </View>
              <Text variant="bodyStrong" numeric color={m.direction === 'in' ? 'success' : 'text'}>
                {m.direction === 'in' ? '+' : '−'}
                {money(m.amount)}
              </Text>
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm, paddingBottom: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }
});
