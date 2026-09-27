import { useRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { Text } from './Text';

/**
 * 6 boxes over one hidden input: supports SMS autofill (Android/iOS
 * one-time-code) and paste, and keeps the numeric keyboard.
 */
export function OtpInput({ value, onChange, length = 6, error, autoFocus = true }: { value: string; onChange: (v: string) => void; length?: number; error?: boolean; autoFocus?: boolean }) {
  const { colors } = useTheme();
  const ref = useRef<TextInput>(null);
  return (
    <Pressable onPress={() => ref.current?.focus()} accessibilityLabel="Código de verificación" accessibilityHint="Introduce el código de 6 dígitos">
      <View style={styles.row}>
        {Array.from({ length }).map((_, i) => {
          const active = i === Math.min(value.length, length - 1);
          return (
            <View
              key={i}
              style={[
                styles.box,
                { backgroundColor: colors.surface, borderColor: error ? colors.danger : active ? colors.primary : colors.border, borderWidth: active || error ? 2 : 1 }
              ]}
            >
              <Text variant="title" numeric>
                {value[i] ?? ''}
              </Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus={autoFocus}
        maxLength={length}
        style={styles.hidden}
        caretHidden
        testID="otp-input"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  box: { flex: 1, aspectRatio: 0.85, maxWidth: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  hidden: { position: 'absolute', opacity: 0, width: 1, height: 1 }
});
