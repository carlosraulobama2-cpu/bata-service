import { useNoScreenCapture } from '../security/useNoScreenCapture';
import { Fingerprint } from 'lucide-react-native';
import { ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { StepUp } from '../api/types';
import { useSession } from '../state/session';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { Keypad } from './Keypad';
import { PinDots } from './PinDots';
import { Text } from './Text';

const PIN_LENGTH = 6;

interface Props {
  visible: boolean;
  summary: ReactNode;
  busy: boolean;
  error: string | null;
  onSubmit: (stepUp: StepUp) => void;
  onClose: () => void;
}

/**
 * Agent confirmation for a money operation: PIN on our own keypad or
 * biometrics. The summary stays visible so the agent confirms exactly what
 * they read.
 */
export function ConfirmSheet({ visible, summary, busy, error, onSubmit, onClose }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const biometricEnabled = useSession((s) => s.biometricEnabled);
  const [pin, setPin] = useState('');
  useNoScreenCapture(visible);

  useEffect(() => {
    if (!visible || error) setPin('');
  }, [visible, error]);

  const add = (d: string) => {
    if (busy || pin.length >= PIN_LENGTH) return;
    const next = pin + d;
    setPin(next);
    if (next.length === PIN_LENGTH) onSubmit({ method: 'pin', pin: next });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={styles.flex} onPress={busy ? undefined : onClose} accessibilityLabel={t('common.close')} />
        <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.summary}>{summary}</View>
          <Text variant="headline" align="center">
            {t('confirm.title')}
          </Text>
          <PinDots length={PIN_LENGTH} filled={pin.length} error={!!error} />
          <View style={styles.status}>
            {busy ? (
              <ActivityIndicator color={colors.primary} />
            ) : error ? (
              <Text variant="label" color="danger" align="center" accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
          </View>
          <Keypad
            disabled={busy}
            onDigit={add}
            onDelete={() => setPin((p) => p.slice(0, -1))}
            extra={
              biometricEnabled
                ? { icon: <Fingerprint size={30} color={colors.primary} />, accessibilityLabel: t('confirm.useBiometrics'), onPress: () => onSubmit({ method: 'biometric' }) }
                : undefined
            }
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  flex: { flex: 1 },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.xs },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginVertical: space.md },
  summary: { marginBottom: space.md },
  status: { minHeight: 28, alignItems: 'center', justifyContent: 'center' }
});
