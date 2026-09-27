import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { rememberedPhone } from '../../api/auth';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useSession } from '../../state/session';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { groupDigits } from '../../utils/format';

const PREFIX = '+240'; // Guinea Ecuatorial; other countries por confirmar
const NATIONAL_LENGTH = 9;

export default function LoginScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const setPendingLogin = useSession((s) => s.setPendingLogin);
  const [digits, setDigits] = useState('');
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    void rememberedPhone().then((p) => p?.startsWith(PREFIX) && setDigits(p.slice(PREFIX.length)));
  }, []);

  const valid = digits.length === NATIONAL_LENGTH;
  const next = () => {
    setTouched(true);
    if (!valid) return;
    setPendingLogin({ phone: `${PREFIX}${digits}` });
    router.push('/pin');
  };

  return (
    <Screen
      footer={<Button label={t('common.continue')} onPress={next} disabled={!valid} testID="login-continue" />}
      scroll
    >
      <View style={styles.brand}>
        <View style={[styles.logo, { backgroundColor: colors.primary }]}>
          <Text variant="title" style={{ color: colors.onPrimary }}>
            BS
          </Text>
        </View>
        <Text variant="overline" color="primary">
          {t('common.appName')}
        </Text>
        <Text variant="display">{t('auth.welcomeTitle')}</Text>
      </View>

      <View style={styles.field}>
        <Text variant="label" nativeID="phoneLabel">
          {t('auth.phoneLabel')}
        </Text>
        <View style={[styles.input, { backgroundColor: colors.surface, borderColor: touched && !valid ? colors.danger : focused ? colors.primary : colors.border }]}>
          <View style={[styles.prefix, { borderRightColor: colors.border }]}>
            <Text variant="bodyStrong">🇬🇶 {PREFIX}</Text>
          </View>
          <TextInput
            accessibilityLabelledBy="phoneLabel"
            value={groupDigits(digits)}
            onChangeText={(v) => setDigits(v.replace(/\D/g, '').slice(0, NATIONAL_LENGTH))}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              if (digits) setTouched(true);
            }}
            onSubmitEditing={next}
            placeholder={t('auth.phonePlaceholder')}
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            returnKeyType="next"
            style={[styles.textInput, { color: colors.text }]}
            testID="phone-input"
          />
        </View>
        <Text variant="caption" color={touched && !valid ? 'danger' : 'textMuted'}>
          {touched && !valid ? t('auth.phoneInvalid') : t('auth.phoneHint')}
        </Text>
      </View>

      <View style={styles.links}>
        <Button variant="ghost" label={t('auth.troubleSigningIn')} onPress={() => Alert.alert(t('auth.troubleSigningIn'), t('auth.recoveryHelp'))} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { gap: space.md, paddingTop: space.huge, paddingBottom: space.xxxl },
  logo: { width: 56, height: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  field: { gap: space.sm },
  input: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: radius.md, height: 60, overflow: 'hidden' },
  prefix: { paddingHorizontal: space.lg, height: '100%', justifyContent: 'center', borderRightWidth: 1 },
  textInput: { flex: 1, paddingHorizontal: space.lg, fontSize: 20, letterSpacing: 1, height: '100%' },
  links: { marginTop: space.xl, alignItems: 'center' }
});
