import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { rememberedEmail, signIn } from '../../api/auth';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { errorMessage } from '../../features/errors';
import { useNoScreenCapture } from '../../security/useNoScreenCapture';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The agent's Velynt account (the same email and password as the Velynt app). */
export default function LoginScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<'email' | 'password' | null>(null);
  useNoScreenCapture();

  useEffect(() => {
    // A phone-only account has an internal address (…@id.velynt.app): not shown as if it were the customer's email.
    void rememberedEmail().then((e) => e && !e.endsWith('@id.velynt.app') && setEmail((current) => current || e));
  }, []);

  // The phone or the email: many Velynt accounts have no email (they signed up with the phone and 4 numbers).
  const phoneDigits = email.replace(/\D/g, '').replace(/^(00)?240(?=\d{9}$)/, '');
  const isPhone = !email.includes('@') && phoneDigits.length === 9;
  const identifier = isPhone ? `+240${phoneDigits}` : email.trim();
  const missing = !(isPhone || EMAIL.test(email.trim())) ? t('auth.missingIdentifier') : password.length === 0 ? t('auth.missingPassword') : null;
  const valid = missing === null;
  const submit = async () => {
    if (busy) return;
    if (missing) {
      setError(missing);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier, password);
      // Signed in: the auth layout redirects to the dashboard.
    } catch (err) {
      setError(errorMessage(err, t));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = (name: 'email' | 'password') => [
    styles.input,
    { color: colors.text, backgroundColor: colors.surface, borderColor: focused === name ? colors.primary : error ? colors.danger : colors.border }
  ];

  return (
    <Screen footer={<Button label={t('auth.signIn')} onPress={() => void submit()} loading={busy} style={valid ? undefined : { opacity: 0.6 }} testID="login-submit" />} scroll>
      <View style={styles.brand}>
        <View style={[styles.logo, { backgroundColor: colors.primary }]}>
          <Text variant="title" style={{ color: colors.onPrimary }}>
            VS
          </Text>
        </View>
        <Text variant="overline" color="primary">
          {t('common.appName')}
        </Text>
        <Text variant="display">{t('auth.welcomeTitle')}</Text>
        <Text variant="body" color="textMuted">
          {t('auth.welcomeBody')}
        </Text>
      </View>

      <View style={styles.field}>
        <Text variant="label" nativeID="emailLabel">
          {t('auth.emailLabel')}
        </Text>
        <TextInput
          accessibilityLabelledBy="emailLabel"
          value={email}
          onChangeText={setEmail}
          onFocus={() => setFocused('email')}
          onBlur={() => setFocused(null)}
          placeholder="222 000 000 o nombre@correo.com"
          placeholderTextColor={colors.textMuted}
          keyboardType="default"
          textContentType="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          style={inputStyle('email')}
          testID="email-input"
        />
      </View>
      <View style={styles.field}>
        <Text variant="label" nativeID="passwordLabel">
          {t('auth.passwordLabel')}
        </Text>
        <TextInput
          accessibilityLabelledBy="passwordLabel"
          value={password}
          onChangeText={setPassword}
          onFocus={() => setFocused('password')}
          onBlur={() => setFocused(null)}
          onSubmitEditing={() => void submit()}
          secureTextEntry
          textContentType="password"
          autoComplete="password"
          autoCapitalize="none"
          returnKeyType="go"
          style={inputStyle('password')}
          testID="password-input"
        />
      </View>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Text variant="caption" color="textMuted">
        {t('auth.oneSessionHint')}
      </Text>

      <View style={styles.links}>
        <Text variant="body" color="textMuted">{t('auth.noAccount')}</Text>
        <Button variant="secondary" label={t('auth.createAccount')} onPress={() => router.push('/register')} testID="login-create-account" />
        <Button variant="ghost" label={t('auth.troubleSigningIn')} onPress={() => router.push('/help')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { gap: space.md, paddingTop: space.huge, paddingBottom: space.xxl },
  logo: { width: 56, height: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  field: { gap: space.sm, marginBottom: space.lg },
  input: { height: 56, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 17 },
  links: { marginTop: space.xl, alignItems: 'center', gap: space.sm }
});
