import { useNoScreenCapture } from '../../security/useNoScreenCapture';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { submitPin } from '../../api/auth';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Keypad } from '../../components/Keypad';
import { PinDots } from '../../components/PinDots';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { errorMessage } from '../../features/errors';
import { useSession } from '../../state/session';
import { space } from '../../theme/tokens';
import { ActivityIndicator } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

const LENGTH = 6;

export default function PinScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const pending = useSession((s) => s.pendingLogin);
  const [pin, setPin] = useState('');
  useNoScreenCapture();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pending) return <Redirect href="/login" />;

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await submitPin(pending.phone, value);
      if (result === 'otp') router.replace('/otp');
      // 'signedIn': the auth layout redirects to the dashboard
    } catch (err) {
      setError(errorMessage(err, t));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const add = (d: string) => {
    if (busy || pin.length >= LENGTH) return;
    const next = pin + d;
    setPin(next);
    setError(null);
    if (next.length === LENGTH) void submit(next);
  };

  return (
    <Screen header={<Header />}>
      <View style={styles.top}>
        <Text variant="title" align="center">
          {t('auth.pinTitle')}
        </Text>
        <Text variant="body" color="textMuted" align="center">
          {t('auth.pinSubtitle')}
        </Text>
        <PinDots length={LENGTH} filled={pin.length} error={!!error} />
        <View style={styles.status}>
          {busy ? (
            <ActivityIndicator color={colors.primary} />
          ) : error ? (
            <Text variant="label" color="danger" align="center" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.bottom}>
        <Keypad disabled={busy} onDigit={add} onDelete={() => setPin((p) => p.slice(0, -1))} />
        <Button variant="ghost" label={t('auth.forgotPin')} onPress={() => router.push('/help')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flex: 1, justifyContent: 'center', gap: space.sm },
  status: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  bottom: { gap: space.sm }
});
