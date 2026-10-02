import { router } from 'expo-router';
import { ChevronRight, Fingerprint, KeyRound, LogOut, Smartphone } from 'lucide-react-native';
import { ReactNode } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { signOut } from '../../../api/auth';
import { Card } from '../../../components/Card';
import { Header } from '../../../components/Header';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { useMe } from '../../../features/queries';
import { forgetBiometricPin } from '../../../security/biometrics';
import { useSession } from '../../../state/session';
import { useTheme } from '../../../theme/ThemeProvider';
import { space } from '../../../theme/tokens';

/**
 * Account security in the agents app: the payment PIN, fingerprint/face on this phone and the
 * session. One session per agent: signing in on another phone closes this one.
 */
export default function SecurityScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const me = useMe();
  const biometricEnabled = useSession((s) => s.biometricEnabled);
  const hasPin = !!me.data?.user.has_pin;

  const turnOffBiometrics = async () => {
    await forgetBiometricPin();
    useSession.getState().setBiometricEnabled(false);
  };

  const confirmSignOut = () => {
    if (Platform.OS === 'web') return void signOut();
    Alert.alert(t('auth.signOut'), t('auth.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.signOut'), style: 'destructive', onPress: () => void signOut() }
    ]);
  };

  return (
    <Screen header={<Header title={t('security.title')} />} scroll>
      <View style={styles.content}>
        <Card padded={false} style={{ overflow: 'hidden' }}>
          <Row
            icon={<KeyRound size={20} color={colors.text} />}
            label={hasPin ? t('security.changePin') : t('pinChange.createTitle')}
            caption={t('security.pinCaption')}
            onPress={() => router.push('/security/pin')}
            testID="security-change-pin"
          />
          <Row
            icon={<Fingerprint size={20} color={colors.text} />}
            label={t('security.biometrics')}
            caption={biometricEnabled ? t('security.biometricsOn') : t('security.biometricsOff')}
            onPress={biometricEnabled ? () => void turnOffBiometrics() : undefined}
            action={biometricEnabled ? t('security.turnOff') : undefined}
          />
          <Row icon={<Smartphone size={20} color={colors.text} />} label={t('security.oneSession')} caption={t('security.oneSessionBody')} last />
        </Card>
        <Text variant="caption" color="textMuted">
          {t('security.notYou')}
        </Text>
        <Card padded={false} style={{ overflow: 'hidden' }}>
          <Row icon={<LogOut size={20} color={colors.danger} />} label={t('auth.signOut')} danger onPress={confirmSignOut} last />
        </Card>
      </View>
    </Screen>
  );
}

function Row({ icon, label, caption, onPress, action, danger, last, testID }: { icon: ReactNode; label: string; caption?: string; onPress?: () => void; action?: string; danger?: boolean; last?: boolean; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      testID={testID}
      style={({ pressed }) => [styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, pressed && { backgroundColor: colors.neutralSoft }]}
    >
      {icon}
      <View style={styles.flex}>
        <Text variant="bodyStrong" color={danger ? 'danger' : 'text'}>
          {label}
        </Text>
        {caption ? (
          <Text variant="caption" color="textMuted">
            {caption}
          </Text>
        ) : null}
      </View>
      {action ? (
        <Text variant="label" color="primary">
          {action}
        </Text>
      ) : onPress && !danger ? (
        <ChevronRight size={20} color={colors.textMuted} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm },
  flex: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 60, paddingVertical: space.md }
});
