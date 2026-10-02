import { StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { groupThousands } from '../utils/format';
import { Text } from './Text';

/** A whole-franc amount typed with the number pad, shown as 1.500.000. */
export function MoneyInput({ value, onChange, testID, autoFocus }: { value: number; onChange: (v: number) => void; testID?: string; autoFocus?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TextInput
        value={groupThousands(String(value || ''))}
        onChangeText={(text) => onChange(Number(text.replace(/\D/g, '').slice(0, 11)) || 0)}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, { color: colors.text }]}
        autoFocus={autoFocus}
        testID={testID}
      />
      <Text variant="bodyStrong" color="textMuted">
        XAF
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, height: 60 },
  input: { flex: 1, minWidth: 0, fontSize: 24, fontWeight: '600', height: '100%' }
});
