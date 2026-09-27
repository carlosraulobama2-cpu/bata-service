import { useNoScreenCapture } from '../../../security/useNoScreenCapture';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ApiError, newIdempotencyKey } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import { Button } from '../../../components/Button';
import { Header } from '../../../components/Header';
import { Keypad } from '../../../components/Keypad';
import { PinDots } from '../../../components/PinDots';
import { ResultView } from '../../../components/ResultView';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { errorMessage } from '../../../features/errors';
import { useTheme } from '../../../theme/ThemeProvider';
import { space } from '../../../theme/tokens';
import { isAcceptablePin } from '../../../utils/pin';

const LENGTH = 6;
type Step = 'current' | 'next' | 'confirm';

/** Current PIN -> new PIN -> repeat. The PIN never goes through the system keyboard. */
export default function ChangePinScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('current');
  useNoScreenCapture();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ revoked: number } | null>(null);
  const keyRef = useRef<string | null>(null);

  const restartNew = (message: string) => {
    setNext('');
    setValue('');
    setError(message);
    setStep('next');
  };

  const submit = async (confirmed: string) => {
    keyRef.current ??= newIdempotencyKey();
    setBusy(true);
    try {
      const res = await endpoints.changePin({ currentPin: current, newPin: confirmed, key: keyRef.current });
      void qc.invalidateQueries({ queryKey: ['security'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      setDone({ revoked: res.other_sessions_revoked });
    } catch (err) {
      if (err instanceof ApiError && err.isNetwork) {
        setError(errorMessage(err, t)); // same key on retry: never changes twice
        setValue('');
        return;
      }
      keyRef.current = null;
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'PIN_INVALID' || code === 'ACCOUNT_LOCKED') {
        setCurrent('');
        setNext('');
        setValue('');
        setError(errorMessage(err, t));
        setStep('current');
      } else restartNew(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const add = (d: string) => {
    if (busy || value.length >= LENGTH) return;
    const v = value + d;
    setValue(v);
    setError(null);
    if (v.length < LENGTH) return;
    if (step === 'current') {
      setCurrent(v);
      setValue('');
      setStep('next');
    } else if (step === 'next') {
      if (!isAcceptablePin(v)) return restartNew(t('pinChange.weak'));
      if (v === current) return restartNew(t('pinChange.sameAsCurrent'));
      setNext(v);
      setValue('');
      setStep('confirm');
    } else {
      if (v !== next) return restartNew(t('pinChange.mismatch'));
      void submit(v);
    }
  };

  if (done) {
    return (
      <Screen header={<Header leading="close" onLeading={() => router.back()} />} footer={<Button label={t('common.done')} onPress={() => router.back()} testID="pin-change-done" />}>
        <ResultView tone="success" title={t('pinChange.doneTitle')} instruction={done.revoked > 0 ? `${t('pinChange.doneBody')} ${t('pinChange.doneSessions', { count: done.revoked })}` : t('pinChange.doneBody')} />
      </Screen>
    );
  }

  const title = step === 'current' ? t('pinChange.current') : step === 'next' ? t('pinChange.next') : t('pinChange.confirm');
  return (
    <Screen header={<Header leading="close" onLeading={() => router.back()} title={t('pinChange.title')} />}>
      <View style={styles.top}>
        <Text variant="caption" color="textMuted" align="center">
          {`${['current', 'next', 'confirm'].indexOf(step) + 1} / 3`}
        </Text>
        <Text variant="title" align="center" accessibilityLiveRegion="polite">
          {title}
        </Text>
        {step === 'next' ? (
          <Text variant="body" color="textMuted" align="center">
            {t('pinChange.nextHint')}
          </Text>
        ) : null}
        <PinDots length={LENGTH} filled={value.length} error={!!error} />
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
  top: { flex: 1, justifyContent: 'center', gap: space.md },
  status: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.lg }
});
