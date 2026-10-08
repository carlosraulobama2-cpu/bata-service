import { BadgeCheck, ShieldAlert } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { formatDate } from '../utils/format';
import { Text } from './Text';

/** Result of the customer check, shown before any money step. */
export function VerifiedCustomerCard({ name, phone, verifiedAt }: { name: string; phone: string; verifiedAt: string | null }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.successSoft, borderColor: colors.success }]}
      accessibilityRole="summary"
      accessibilityLabel={`${t('cashIn.verifiedTitle')}: ${name}, ${phone}`}
      accessibilityLiveRegion="polite"
      testID="customer-verified"
    >
      <View style={[styles.icon, { backgroundColor: colors.success }]}>
        <BadgeCheck size={26} color={colors.successSoft} />
      </View>
      <View style={styles.text}>
        <Text variant="overline" color="success">
          {t('cashIn.verifiedTitle')}
        </Text>
        <Text variant="headline">{name}</Text>
        <Text variant="body" color="textMuted" numeric>
          {phone}
        </Text>
        <Text variant="caption" color="success">
          {t('cashIn.verifiedBody')}
          {verifiedAt ? ` · ${t('cashIn.verifiedSince', { date: formatDate(verifiedAt) })}` : ''}
        </Text>
      </View>
    </View>
  );
}

export function NotVerifiedCard({ message }: { message: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={[styles.card, { backgroundColor: colors.warningSoft, borderColor: colors.warning }]} accessibilityRole="alert" testID="customer-not-verified">
      <View style={[styles.icon, { backgroundColor: colors.warning }]}>
        <ShieldAlert size={24} color={colors.warningSoft} />
      </View>
      <View style={styles.text}>
        <Text variant="overline" color="warning">
          {t('cashIn.notVerifiedTitle')}
        </Text>
        <Text variant="body">{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1.5, alignItems: 'flex-start' },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 }
});
