import { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';

interface Props {
  children: ReactNode;
  scroll?: boolean;
  /** Fixed area at the bottom (primary action), always visible above the keyboard. */
  footer?: ReactNode;
  header?: ReactNode;
  padded?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: ('top' | 'bottom')[];
  contentStyle?: ViewStyle;
  background?: string;
}

/** Page shell: safe areas, background, optional scroll/pull-to-refresh and sticky footer. */
export function Screen({ children, scroll, footer, header, padded = true, refreshing, onRefresh, edges = ['top', 'bottom'], contentStyle, background }: Props) {
  const { colors, scheme } = useTheme();
  const bg = background ?? colors.bg;
  const body = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[padded && styles.padded, styles.grow, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.grow, padded && styles.padded, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: bg }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {header}
        {body}
        {footer ? <View style={[styles.footer, { backgroundColor: bg }]}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // The body takes the remaining height and scrolls inside it, so the footer action never leaves the screen.
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  padded: { paddingHorizontal: space.xl, paddingBottom: space.xl },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg, gap: space.sm }
});
