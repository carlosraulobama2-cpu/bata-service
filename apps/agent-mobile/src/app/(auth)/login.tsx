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
    void rememberedEmail().then((e) => e && setEmail((current) => current || e));
  }, []);

  const valid = EMAIL.test(email.trim()) && password.length > 0;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
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
    <Screen footer={<Button label={t('auth.signIn')} onPress={() => void submit()} disabled={!valid} loading={busy} testID="login-submit" />} scroll>
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
          placeholder="nombre@correo.com"
          placeholderTextColor={colors.textMuted}
          keyboardType="email-address"
          textContentType="username"
          autoComplete="email"
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
  links: { marginTop: space.xl, alignItems: 'center' }
});
