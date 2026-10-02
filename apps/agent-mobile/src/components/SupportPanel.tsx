import { MessageCircle, Phone, ShieldAlert } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Transaction } from '../api/types';
import { callSupport, problemMessage, supportContacts, whatsappSupport } from '../features/support';
import { formatPhone } from '../utils/format';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { Banner } from './Banner';
import { Button } from './Button';
import { Card } from './Card';
import { InfoRow } from './InfoRow';
import { Text } from './Text';

/**
 * How to reach support: call or WhatsApp (numbers set in the build with
 * EXPO_PUBLIC_SUPPORT_*; hidden while unset), what to have ready, and the
 * anti-scam rule. `tx` pre-writes the WhatsApp message about an operation.
 */
export function SupportPanel({ agentCode, tx }: { agentCode?: string; tx?: Transaction }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const support = supportContacts();
  const message = problemMessage(t, agentCode ?? '', tx);
  const none = !support.phone && !support.whatsapp;

  return (
    <View style={styles.wrap}>
      <View style={[styles.scam, { backgroundColor: colors.warningSoft, borderColor: colors.warning }]} accessibilityRole="alert">
        <ShieldAlert size={22} color={colors.warning} />
        <View style={styles.flex}>
          <Text variant="bodyStrong" style={{ color: colors.warning }}>
            {t('support.scamTitle')}
          </Text>
          <Text variant="caption" style={{ color: colors.warning }}>
            {t('support.scamBody')}
          </Text>
        </View>
      </View>

      {none ? <Banner tone="info">{t('support.notConfigured')}</Banner> : null}
      {support.whatsapp ? (
        <Button icon={<MessageCircle size={20} color={colors.onPrimary} />} label={tx ? t('support.whatsappAbout') : t('support.whatsapp')} onPress={() => void whatsappSupport(support.whatsapp!, message)} testID="support-whatsapp" />
      ) : null}
      {support.phone ? <Button variant="secondary" icon={<Phone size={20} color={colors.primary} />} label={t('support.call', { phone: formatPhone(support.phone) })} onPress={() => void callSupport(support.phone!)} testID="support-call" /> : null}
      {support.hours ? (
        <Text variant="caption" color="textMuted" align="center">
          {t('support.hours', { hours: support.hours })}
        </Text>
      ) : null}

      <Card>
        <Text variant="overline" color="textMuted" style={{ marginBottom: space.xs }}>
          {t('support.haveReady')}
        </Text>
        {agentCode ? <InfoRow label={t('profile.agentId')} value={agentCode} strong last={!tx} /> : null}
        {tx ? <InfoRow label="Transaction ID" value={tx.reference} last /> : null}
        <Text variant="caption" color="textMuted" style={{ marginTop: space.sm }}>
          {tx ? t('support.haveReadyOperation') : agentCode ? t('support.haveReadyGeneral') : t('support.haveReadySignedOut')}
        </Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  scam: { flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1 },
  flex: { flex: 1, gap: 2 }
});
