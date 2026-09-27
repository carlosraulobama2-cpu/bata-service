import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';
import { Text } from './Text';

export function InfoRow({ label, value, strong, last }: { label: string; value: ReactNode; strong?: boolean; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <Text variant="body" color="textMuted">
        {label}
      </Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text variant={strong ? 'bodyStrong' : 'body'} numeric style={styles.value} selectable>
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.md, gap: space.lg, minHeight: 48 },
  value: { flexShrink: 1, textAlign: 'right' }
});
