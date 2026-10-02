import { CheckCircle2, Clock3, XCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { ReactNode, useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { Text } from './Text';

type Tone = 'success' | 'pending' | 'failure';

/** Big, unambiguous outcome block used at the end of every operation. */
export function ResultView({ tone, title, amount, instruction, children }: { tone: Tone; title: string; amount?: string; instruction?: string; children?: ReactNode }) {
  const { colors } = useTheme();
  useEffect(() => {
    // Felt, not only seen: the agent is often looking at the customer, not the screen.
    if (Platform.OS === 'web' || tone === 'pending') return;
    void Haptics.notificationAsync(tone === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => undefined);
  }, [tone]);
  const cfg = {
    success: { Icon: CheckCircle2, fg: colors.success, bg: colors.successSoft },
    pending: { Icon: Clock3, fg: colors.warning, bg: colors.warningSoft },
    failure: { Icon: XCircle, fg: colors.danger, bg: colors.dangerSoft }
  }[tone];
  return (
    <View style={styles.wrap} accessibilityLiveRegion="assertive">
      <View style={[styles.halo, { backgroundColor: cfg.bg }]}>
        <cfg.Icon size={56} color={cfg.fg} strokeWidth={2} />
      </View>
      <Text variant="overline" style={{ color: cfg.fg }} align="center">
        {title}
      </Text>
      {amount ? (
        <Text variant="display" numeric align="center">
          {amount}
        </Text>
      ) : null}
      {instruction ? (
        <View style={[styles.instruction, { backgroundColor: cfg.bg }]}>
          <Text variant="bodyStrong" align="center" style={{ color: cfg.fg }}>
            {instruction}
          </Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.md, paddingTop: space.xxl },
  halo: { width: 104, height: 104, borderRadius: 52, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  instruction: { borderRadius: radius.md, paddingVertical: space.md, paddingHorizontal: space.lg, alignSelf: 'stretch' }
});
