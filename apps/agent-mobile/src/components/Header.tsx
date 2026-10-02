import { router } from 'expo-router';
import { ChevronLeft, X } from 'lucide-react-native';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { space, touch } from '../theme/tokens';
import { Text } from './Text';

interface Props {
  title?: string;
  /** 'back' arrow, 'close' X (for operation flows) or nothing. */
  leading?: 'back' | 'close' | 'none';
  onLeading?: () => void;
  trailing?: ReactNode;
}

export function Header({ title, leading = 'back', onLeading, trailing }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const Icon = leading === 'close' ? X : ChevronLeft;
  return (
    <View style={styles.row}>
      <View style={styles.side}>
        {leading !== 'none' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={leading === 'close' ? t('common.close') : t('common.back')}
            hitSlop={8}
            onPress={onLeading ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
            style={({ pressed }) => [styles.iconBtn, { backgroundColor: pressed ? colors.neutralSoft : 'transparent' }]}
          >
            <Icon size={26} color={colors.text} />
          </Pressable>
        )}
      </View>
      <Text variant="headline" numberOfLines={1} style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <View style={[styles.side, styles.trailing]}>{trailing}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, minHeight: 56 },
  side: { width: touch.min + space.sm },
  trailing: { alignItems: 'flex-end', paddingRight: space.sm },
  title: { flex: 1, textAlign: 'center' },
  iconBtn: { width: touch.min, height: touch.min, borderRadius: touch.min / 2, alignItems: 'center', justifyContent: 'center' }
});
