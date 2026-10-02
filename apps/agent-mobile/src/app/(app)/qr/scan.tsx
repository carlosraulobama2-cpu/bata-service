import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Header } from '../../../components/Header';
import { Scanner } from '../../../components/Scanner';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { classifyQr } from '../../../utils/qr';

/**
 * Unified scan: a customer's top-up QR opens a deposit of that amount, a withdrawal QR opens the
 * withdrawal review. Each flow asks the server whether the code is still valid.
 */
export default function QrScanScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));

  const handle = (data: string) => {
    setError(null);
    const kind = classifyQr(data);
    if (kind === 'topup') router.replace({ pathname: '/cash-in', params: { topup: data.trim() } });
    else if (kind === 'cashout') router.replace({ pathname: '/cash-out', params: { qr: data.trim() } });
    else setError(kind === 'other_velynt' ? t('qr.notForAgents') : t('errors.invalid_qr'));
  };

  return (
    <Screen header={<Header leading="close" onLeading={close} title={t('qr.scan')} />} scroll>
      <View style={styles.content}>
        <Text variant="title">{t('qr.scanTitle')}</Text>
        <Text variant="body" color="textMuted">
          {t('qr.scanHint')}
        </Text>
        {Platform.OS === 'web' ? (
          <>
            <Banner tone="info">{t('qr.webNoCamera')}</Banner>
            <TextInput
              value={pasted}
              onChangeText={setPasted}
              placeholder='{"schema":"equatoriana.qr.topup",…}'
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
              accessibilityLabel={t('qr.scan')}
              testID="qr-scan-paste"
            />
            <Button label={t('common.continue')} onPress={() => handle(pasted)} disabled={!pasted.trim()} />
          </>
        ) : (
          <Scanner paused={false} onCode={handle} />
        )}
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg, paddingTop: space.sm },
  input: { minHeight: 56, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 15 }
});
