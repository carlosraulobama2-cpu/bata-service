import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/endpoints';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Header } from '../../../components/Header';
import { Scanner } from '../../../components/Scanner';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { errorMessage } from '../../../features/errors';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { looksLikeBataQr } from '../../../utils/qr';

/**
 * Unified scan: the server says what the code is. A withdrawal QR opens the
 * cash-out review; a customer's personal QR opens a deposit to that customer.
 */
export default function QrScanScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));

  const handle = async (data: string) => {
    setError(null);
    if (!looksLikeBataQr(data)) {
      setError(t('errors.QR_INVALID'));
      return;
    }
    setBusy(true);
    try {
      const result = await endpoints.scanQr(data.trim());
      if (result.action === 'cash_out') router.replace({ pathname: '/cash-out', params: { qr: data.trim() } });
      else router.replace({ pathname: '/cash-in', params: { token: result.customer.customer_token, masked: result.customer.customer_masked } });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
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
              placeholder="BSV1.…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
              accessibilityLabel={t('qr.scan')}
              testID="qr-scan-paste"
            />
            <Button label={t('common.continue')} onPress={() => void handle(pasted)} disabled={!pasted.trim()} loading={busy} />
          </>
        ) : (
          <Scanner paused={busy} onCode={(data) => void handle(data)} />
        )}
        {busy ? (
          <Text variant="label" color="textMuted" align="center">
            {t('qr.checking')}
          </Text>
        ) : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg, paddingTop: space.sm },
  input: { minHeight: 56, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 15 }
});
