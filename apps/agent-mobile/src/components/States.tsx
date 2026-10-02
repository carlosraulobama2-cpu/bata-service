import { CloudOff, Inbox } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { Button } from './Button';
import { Text } from './Text';

export function Skeleton({ width = '100%', height = 16, style }: { width?: number | `${number}%`; height?: number; style?: ViewStyle }) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ width, height, borderRadius: radius.sm, backgroundColor: colors.skeleton, opacity }, style]} />;
}

export function EmptyState({ message }: { message: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <Inbox size={36} color={colors.textMuted} />
      <Text variant="body" color="textMuted" align="center">
        {message}
      </Text>
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
  return (
    <View style={styles.center}>
      <CloudOff size={36} color={colors.textMuted} />
      <Text variant="body" color="textMuted" align="center">
        {t(`errors.${code}`, { defaultValue: t('errors.INTERNAL_ERROR') })}
      </Text>
      {onRetry ? <Button label={t('common.retry')} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: space.md, paddingVertical: space.huge, paddingHorizontal: space.xl }
});
