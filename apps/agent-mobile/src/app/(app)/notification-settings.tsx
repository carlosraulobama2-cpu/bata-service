import { Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { usePushPermission } from '../../features/push';
import { space } from '../../theme/tokens';

/** Push on this phone: on, off (and how to turn it on), or not available in this build. */
export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const push = usePushPermission();

  return (
    <Screen header={<Header title={t('notifications.settingsTitle')} />} scroll>
      <View style={styles.content}>
        {push.status === 'granted' ? <Banner tone="success">{t('notifications.pushOn')}</Banner> : null}
        {push.status === 'undetermined' ? (
          <View style={{ gap: space.sm }}>
            <Banner tone="info">{t('notifications.pushOff')}</Banner>
            <Button label={t('notifications.enableAction')} onPress={() => void push.enable()} testID="push-enable" />
          </View>
        ) : null}
        {push.status === 'denied' ? (
          <View style={{ gap: space.sm }}>
            <Banner tone="warning">{t('notifications.pushDenied')}</Banner>
            <Button variant="secondary" label={t('notifications.openSettings')} onPress={() => void Linking.openSettings()} />
          </View>
        ) : null}
        {push.status === 'unsupported' ? <Banner tone="offline">{t('notifications.pushUnsupported')}</Banner> : null}
        <Text variant="body" color="textMuted">
          {t('notifications.whatYouGet')}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm }
});
