import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/endpoints';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { ErrorState, Skeleton } from '../../components/States';
import { Text } from '../../components/Text';
import { space } from '../../theme/tokens';

/**
 * The Velynt terms or privacy policy, inside the agents app (also before signing in, from the sign-up form). The app
 * never opens the customer web for this: that site could open another account signed in on the same browser.
 */
export default function LegalScreen() {
  const { t } = useTranslation();
  const { kind } = useLocalSearchParams<{ kind: string }>();
  const doc = useQuery({ queryKey: ['legal', kind], queryFn: () => endpoints.legal(kind === 'privacy' ? 'privacy' : 'terms'), staleTime: 60 * 60_000 });
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <Screen header={<Header leading="back" onLeading={close} title={kind === 'privacy' ? t('legal.privacy') : t('legal.terms')} />} scroll>
      {doc.error ? <ErrorState error={doc.error} onRetry={() => doc.refetch()} /> : null}
      {!doc.data && !doc.error ? (
        <View style={{ gap: space.md }}>
          <Skeleton height={28} width="70%" />
          <Skeleton height={80} />
          <Skeleton height={80} />
        </View>
      ) : null}
      {doc.data ? (
        <View style={{ gap: space.lg, paddingBottom: space.xxl }}>
          <View style={{ gap: space.xs }}>
            <Text variant="title">{doc.data.title}</Text>
            <Text variant="caption" color="textMuted">
              {t('legal.version', { version: doc.data.version, updated: doc.data.updated })}
            </Text>
          </View>
          {doc.data.intro ? <Text variant="body">{doc.data.intro}</Text> : null}
          {doc.data.sections.map((section) => (
            <View key={section.heading} style={{ gap: space.sm }}>
              <Text variant="bodyStrong">{section.heading}</Text>
              {section.paragraphs.map((paragraph, index) => (
                <Text key={index} variant="body" color="textMuted">
                  {paragraph}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
