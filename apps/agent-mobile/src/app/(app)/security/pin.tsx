import { useNoScreenCapture } from '../../../security/useNoScreenCapture';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Header } from '../../../components/Header';
import { Keypad } from '../../../components/Keypad';
import { PinDots } from '../../../components/PinDots';
import { ResultView } from '../../../components/ResultView';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { errorMessage } from '../../../features/errors';
import { useMe } from '../../../features/queries';
import { forgetBiometricPin } from '../../../security/biometrics';
import { useSession } from '../../../state/session';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { isAcceptablePin, PIN_LENGTH } from '../../../utils/pin';

type Step = 'password' | 'next' | 'confirm';

/**
 * Create or change the payment PIN: account password -> new PIN -> repeat. The password (not the
 * old PIN) proves it is the owner, so a forgotten PIN can be replaced too. The PIN never goes
 * through the system keyboard. It is the same PIN as in the Velynt app (one account).
 */
export default function ChangePinScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const me = useMe();
  const creating = me.data ? !me.data.user.has_pin : false;
  const [step, setStep] = useState<Step>('password');
  useNoScreenCapture();
  const [password, setPassword] = useState('');
  const [next, setNext] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const restartNew = (message: string) => {
    setNext('');
    setValue('');
    setError(message);
    setStep('next');
  };

  const submit = async (pin: string) => {
    setBusy(true);
    try {
      await endpoints.setPin({ password, pin });
      // The PIN kept behind fingerprint/face is the old one: it must be entered once more.
      await forgetBiometricPin();
      useSession.getState().setBiometricEnabled(false);
      void qc.invalidateQueries({ queryKey: ['me'] });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_password') {
        setPassword('');
        setNext('');
        setValue('');
        setError(errorMessage(err, t));
        setStep('password');
      } else restartNew(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const add = (d: string) => {
    if (busy || value.length >= PIN_LENGTH) return;
    const v = value + d;
    setValue(v);
    setError(null);
    if (v.length < PIN_LENGTH) return;
    if (step === 'next') {
      if (!isAcceptablePin(v)) return restartNew(t('pinChange.weak'));
      setNext(v);
      setValue('');
      setStep('confirm');
    } else {
      if (v !== next) return restartNew(t('pinChange.mismatch'));
      void submit(v);
    }
  };

  const title = creating ? t('pinChange.createTitle') : t('pinChange.title');

  if (done) {
    return (
      <Screen header={<Header leading="close" onLeading={() => router.back()} />} footer={<Button label={t('common.done')} onPress={() => router.back()} testID="pin-change-done" />}>
        <ResultView tone="success" title={creating ? t('pinChange.createdTitle') : t('pinChange.doneTitle')} instruction={t('pinChange.doneBody')} />
      </Screen>
    );
  }

  if (step === 'password') {
    return (
      <Screen
        header={<Header leading="close" onLeading={() => router.back()} title={title} />}
        footer={<Button label={t('common.continue')} disabled={!password} onPress={() => { setError(null); setStep('next'); }} testID="pin-password-continue" />}
      >
        <View style={styles.form}>
          <Text variant="caption" color="textMuted">
            1 / 3
          </Text>
          <Text variant="title">{t('pinChange.password')}</Text>
          <Text variant="body" color="textMuted">
            {t('pinChange.passwordHint')}
          </Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoFocus
            autoCapitalize="none"
            textContentType="password"
            style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border }]}
            accessibilityLabel={t('pinChange.password')}
            testID="pin-password"
          />
          {error ? <Banner tone="danger">{error}</Banner> : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen header={<Header leading="close" onLeading={() => router.back()} title={title} />}>
      <View style={styles.top}>
        <Text variant="caption" color="textMuted" align="center">
          {step === 'next' ? '2 / 3' : '3 / 3'}
        </Text>
        <Text variant="title" align="center" accessibilityLiveRegion="polite">
          {step === 'next' ? t('pinChange.next') : t('pinChange.confirm')}
        </Text>
        {step === 'next' ? (
          <Text variant="body" color="textMuted" align="center">
            {t('pinChange.nextHint')}
          </Text>
        ) : null}
        <PinDots length={PIN_LENGTH} filled={value.length} error={!!error} />
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
      <Keypad disabled={busy} onDigit={add} onDelete={() => setValue((p) => p.slice(0, -1))} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.md, paddingTop: space.lg },
  input: { height: 56, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 17 },
  top: { flex: 1, justifyContent: 'center', gap: space.md },
  status: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.lg }
});
