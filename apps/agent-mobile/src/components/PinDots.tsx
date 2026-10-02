import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';

export function PinDots({ length, filled, error }: { length: number; filled: number; error?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} accessibilityLabel={`${filled} de ${length} dígitos`} accessibilityLiveRegion="polite">
      {Array.from({ length }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            { borderColor: error ? colors.danger : i < filled ? colors.primary : colors.border, backgroundColor: i < filled ? (error ? colors.danger : colors.primary) : 'transparent' }
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: space.lg, paddingVertical: space.lg },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 }
});
