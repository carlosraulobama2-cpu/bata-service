import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';

/**
 * A group, the Velynt way: the cream fill (surfaceAlt) and space, not lines. `floating` is for what sits over
 * something else (a modal's card): white with a soft warm shadow.
 */
export function Card({ children, style, padded = true, floating }: { children: ReactNode; style?: ViewStyle; padded?: boolean; floating?: boolean }) {
  const { colors, scheme } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: floating ? colors.surface : colors.surfaceAlt },
        floating && scheme === 'light' && styles.shadow,
        padded && { padding: space.lg },
        style
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg },
  shadow: { shadowColor: '#4A2040', shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 }
});
