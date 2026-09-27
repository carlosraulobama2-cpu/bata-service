import { router } from 'expo-router';
import { ChevronRight, LucideIcon, QrCode, ScanLine, Store } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Header } from '../../../components/Header';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';

/** The central QR button: three big choices, one tap each (docs/02-ux-ui.md §4.7). */
export default function QrHubScreen() {
  const { t } = useTranslation();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  return (
    <Screen header={<Header leading="close" onLeading={close} title={t('qr.title')} />} scroll>
      <View style={styles.content}>
        <Text variant="title">{t('qr.hubSubtitle')}</Text>
        <Option Icon={ScanLine} title={t('qr.scan')} body={t('qr.scanBody')} onPress={() => router.replace('/qr/scan')} testID="qr-hub-scan" primary />
        <Option Icon={QrCode} title={t('qr.collect')} body={t('qr.collectBody')} onPress={() => router.replace('/qr/collect')} testID="qr-hub-collect" />
        <Option Icon={Store} title={t('qr.mine')} body={t('qr.mineHint')} onPress={() => router.replace('/qr/mine')} testID="qr-hub-mine" />
      </View>
    </Screen>
  );
}

function Option({ Icon, title, body, onPress, primary, testID }: { Icon: LucideIcon; title: string; body: string; onPress: () => void; primary?: boolean; testID?: string }) {
  const { colors } = useTheme();
  const fg = primary ? colors.onPrimary : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.option, { backgroundColor: primary ? colors.primary : colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[styles.icon, { backgroundColor: primary ? 'rgba(255,255,255,0.18)' : colors.primarySoft }]}>
        <Icon size={28} color={primary ? colors.onPrimary : colors.primary} />
      </View>
      <View style={styles.texts}>
        <Text variant="headline" style={{ color: fg }}>
          {title}
        </Text>
        <Text variant="caption" style={{ color: primary ? colors.onPrimary : colors.textMuted, opacity: primary ? 0.85 : 1 }}>
          {body}
        </Text>
      </View>
      <ChevronRight size={22} color={primary ? colors.onPrimary : colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, minHeight: 96 },
  icon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, gap: 2 }
});
