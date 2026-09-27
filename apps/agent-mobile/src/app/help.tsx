import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../api/endpoints';
import { Header } from '../components/Header';
import { Screen } from '../components/Screen';
import { SupportPanel } from '../components/SupportPanel';
import { Text } from '../components/Text';
import { useSession } from '../state/session';
import { space } from '../theme/tokens';

/**
 * Help & support. Reachable WITHOUT signing in (from the login and PIN
 * screens): an agent with a locked or blocked account can still call.
 * `?tx=<id>` pre-writes the WhatsApp message about that operation.
 */
export default function HelpScreen() {
  const { t } = useTranslation();
  const { tx: txId } = useLocalSearchParams<{ tx?: string }>();
  const signedIn = useSession((s) => s.status === 'signedIn');
  const me = useQuery({ queryKey: ['me'], queryFn: endpoints.me, enabled: signedIn, staleTime: 60_000 });
  const tx = useQuery({ queryKey: ['transaction', txId], queryFn: () => endpoints.transaction(txId!).then((r) => r.transaction), enabled: signedIn && !!txId });

  return (
    <Screen header={<Header title={txId ? t('support.reportTitle') : t('support.title')} />} scroll>
      <Text variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
        {txId ? t('support.reportIntro') : t('support.intro')}
      </Text>
      <SupportPanel agentCode={me.data?.agent.agent_code} tx={tx.data} />
    </Screen>
  );
}
