import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { signUp } from '../../api/auth';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { errorMessage } from '../../features/errors';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TERMS_URL = 'https://velyntpay.vercel.app/legal/terms';
type Field = 'name' | 'phone' | 'email' | 'password';

/**
 * A new Velynt account from the agents app: the same account the customer app uses. Signed in at once; to become an
 * agent they then verify their identity and send the application.
 */
export default function RegisterScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<Field | null>(null);

  const digits = phone.replace(/\D/g, '');
  const valid = name.trim().length >= 2 && digits.length >= 6 && EMAIL.test(email.trim()) && password.length >= 8 && accepted;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signUp({ name, email, phoneNumber: `+240${digits.replace(/^240/, '')}`, password });
      // Signed in: the auth layout takes the agent to the dashboard (and from there to the application).
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = (field: Field) => [
    styles.input,
    { color: colors.text, backgroundColor: colors.surface, borderColor: focused === field ? colors.primary : colors.border },
  ];
  const close = () => (router.canGoBack() ? router.back() : router.replace('/login'));

  return (
    <Screen
      header={<Header leading="back" onLeading={close} />}
      footer={<Button label={t('register.submit')} onPress={() => void submit()} disabled={!valid} loading={busy} testID="register-submit" />}
      scroll
    >
      <View style={styles.intro}>
        <Text variant="display">{t('register.title')}</Text>
        <Text variant="body" color="textMuted">
          {t('register.body')}
        </Text>
      </View>

      <View style={styles.field}>
        <Text variant="label">{t('register.nameLabel')}</Text>
        <TextInput value={name} onChangeText={setName} onFocus={() => setFocused('name')} onBlur={() => setFocused(null)} autoComplete="name" textContentType="name" style={inputStyle('name')} testID="register-name" />
      </View>
      <View style={styles.field}>
        <Text variant="label">{t('register.phoneLabel')}</Text>
        <View style={styles.phoneRow}>
          <Text variant="bodyStrong">+240</Text>
          <TextInput
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/[^\d ]/g, '').slice(0, 15))}
            onFocus={() => setFocused('phone')}
            onBlur={() => setFocused(null)}
            keyboardType="phone-pad"
            placeholder="222 000 000"
            placeholderTextColor={colors.textMuted}
            style={[inputStyle('phone'), { flex: 1 }]}
            testID="register-phone"
          />
        </View>
      </View>
      <View style={styles.field}>
        <Text variant="label">{t('register.emailLabel')}</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          onFocus={() => setFocused('email')}
          onBlur={() => setFocused(null)}
          placeholder="nombre@correo.com"
          placeholderTextColor={colors.textMuted}
          keyboardType="email-address"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect={false}
          style={inputStyle('email')}
          testID="register-email"
        />
      </View>
      <View style={styles.field}>
        <Text variant="label">{t('register.passwordLabel')}</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          onFocus={() => setFocused('password')}
          onBlur={() => setFocused(null)}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          autoCapitalize="none"
          style={inputStyle('password')}
          testID="register-password"
        />
        <Text variant="caption" color="textMuted">
          {t('register.passwordHint')}
        </Text>
      </View>

      <Pressable style={styles.check} onPress={() => setAccepted((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} testID="register-terms">
        <View style={[styles.box, { borderColor: accepted ? colors.primary : colors.border, backgroundColor: accepted ? colors.primary : colors.surface }]}>
          {accepted ? <Check size={14} color={colors.onPrimary} /> : null}
        </View>
        <Text variant="body" style={{ flex: 1 }}>
          {t('register.terms')}
        </Text>
      </Pressable>
      <Button variant="ghost" label={t('register.readTerms')} onPress={() => void Linking.openURL(TERMS_URL)} />

      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Button variant="ghost" label={t('register.haveAccount')} onPress={close} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space.sm, paddingTop: space.md, paddingBottom: space.xl },
  field: { gap: space.sm, marginBottom: space.lg },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  input: { height: 56, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 17 },
  check: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
