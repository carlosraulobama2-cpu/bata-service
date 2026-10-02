import { useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { signOut } from '../api/auth';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { StepUp } from '../api/types';
import { errorMessage } from '../features/errors';
import { useSession } from '../state/session';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';
import { Button } from './Button';
import { ConfirmSheet } from './ConfirmSheet';
import { Text } from './Text';

/** Covers the whole app until the agent confirms with the payment PIN or biometrics (checked by the server). */
export function LockScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (stepUp: StepUp) => {
    setBusy(true);
    setError(null);
    try {
      await endpoints.unlock({ stepUp, prompt: t('lock.biometricPrompt') });
      useSession.getState().setLocked(false);
      void qc.invalidateQueries(); // show fresh balances, not what was on screen before
    } catch (err) {
      if (err instanceof ApiError && err.code === 'biometric_cancelled') return;
      // No payment PIN on this account yet: the password is the only proof left, so sign in again.
      if (err instanceof ApiError && err.code === 'pin_required') return void signOut();
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap, { backgroundColor: colors.hero }]} accessibilityViewIsModal>
      <View style={styles.top}>
        <Lock size={48} color={colors.heroText} />
      </View>
      <ConfirmSheet
        visible
        busy={busy}
        error={error}
        onSubmit={(s) => void submit(s)}
        onClose={() => undefined}
        summary={
          <View style={styles.summary}>
            <Text variant="title" align="center">
              {t('lock.title')}
            </Text>
            <Text variant="caption" color="textMuted" align="center">
              {t('lock.body')}
            </Text>
            <Button variant="ghost" label={t('lock.notMe')} onPress={() => void signOut()} testID="lock-sign-out" />
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { zIndex: 1000, padding: space.xl },
  top: { flex: 1, alignItems: 'center', paddingTop: space.huge },
  summary: { alignItems: 'center', gap: space.xs }
});
