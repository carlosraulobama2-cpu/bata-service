import { useNoScreenCapture } from '../../security/useNoScreenCapture';
import { Redirect, router } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { verifyOtp } from '../../api/auth';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { OtpInput } from '../../components/OtpInput';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { errorMessage } from '../../features/errors';
import { useSession } from '../../state/session';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';

const RESEND_AFTER = 60;

export default function OtpScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const pending = useSession((s) => s.pendingLogin);
  const [code, setCode] = useState('');
  useNoScreenCapture();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(RESEND_AFTER);

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (code.length === 6 && !busy) void submit(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (!pending?.challengeId) return <Redirect href="/login" />;

  async function submit(value: string) {
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(value); // the auth layout redirects once signed in
    } catch (err) {
      setError(errorMessage(err, t));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen header={<Header />} scroll>
      <View style={styles.content}>
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <ShieldCheck size={32} color={colors.primary} />
        </View>
        <Text variant="title">{t('auth.otpTitle')}</Text>
        <Text variant="body" color="textMuted">
          {t('auth.otpNewDevice')}
        </Text>
        <Text variant="bodyStrong">{t('auth.otpSubtitle', { destination: pending.destination })}</Text>
        <View style={styles.otp}>
          <OtpInput value={code} onChange={setCode} error={!!error} />
        </View>
        <View style={styles.status}>
          {busy ? <ActivityIndicator color={colors.primary} /> : error ? <Text variant="label" color="danger" accessibilityRole="alert">{error}</Text> : null}
        </View>
        {seconds > 0 ? (
          <Text variant="caption" color="textMuted" align="center">
            {t('auth.otpResendIn', { seconds })}
          </Text>
        ) : (
          // A new code needs the PIN again: the server only sends codes after a correct PIN.
          <Button variant="ghost" label={t('auth.otpResend')} onPress={() => router.replace('/pin')} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.lg },
  icon: { width: 64, height: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  otp: { marginTop: space.lg },
  status: { minHeight: 32, justifyContent: 'center' }
});
