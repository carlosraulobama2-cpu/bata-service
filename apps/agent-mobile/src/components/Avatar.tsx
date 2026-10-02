import { useQuery } from '@tanstack/react-query';
import { Image, StyleSheet, View } from 'react-native';
import { imageDataUrl } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/** The agent's face (or initials). Fetched again only when `version` changes (a new photo). */
export function Avatar({ name, version, size = 48 }: { name: string; version?: number | null; size?: number }) {
  const { colors } = useTheme();
  const photo = useQuery({
    queryKey: ['avatar', version ?? 0],
    queryFn: () => imageDataUrl('/agent/v1/me/avatar'),
    enabled: !!version,
    staleTime: Infinity
  });
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (version && photo.data) {
    return <Image source={{ uri: photo.data }} style={[box, styles.image]} accessibilityLabel={name} />;
  }
  return (
    <View style={[box, styles.initials, { backgroundColor: colors.primarySoft }]} accessibilityLabel={name}>
      <Text variant="bodyStrong" color="primary" style={{ fontSize: size * 0.38 }}>
        {initials || '?'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: '#ddd' },
  initials: { alignItems: 'center', justifyContent: 'center' }
});
