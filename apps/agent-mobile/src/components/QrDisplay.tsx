import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { qrPath } from '../utils/qr';
import { radius, space } from '../theme/tokens';

/**
 * Large QR for the customer to scan. Always black on white with a quiet
 * zone, whatever the app theme: dark-mode inverted codes fail on many readers.
 */
export function QrDisplay({ value, size = 260, dimmed, label }: { value: string; size?: number; dimmed?: boolean; label: string }) {
  const { size: modules, path } = useMemo(() => qrPath(value), [value]);
  const quiet = 4;
  const box = modules + quiet * 2;
  return (
    <View style={[styles.card, { opacity: dimmed ? 0.15 : 1 }]} accessible accessibilityRole="image" accessibilityLabel={label} testID="qr-display">
      <Svg width={size} height={size} viewBox={`0 0 ${box} ${box}`}>
        <Rect x={0} y={0} width={box} height={box} fill="#FFFFFF" />
        <Path d={path} fill="#000000" transform={`translate(${quiet} ${quiet})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderRadius: radius.lg, padding: space.sm, alignSelf: 'center' }
});
