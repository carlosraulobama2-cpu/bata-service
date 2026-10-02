import { CameraView, useCameraPermissions } from 'expo-camera';
import { Camera } from 'lucide-react-native';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { Button } from './Button';
import { Text } from './Text';

/** QR scanner with a clear viewfinder; reports each code once. */
export function Scanner({ onCode, paused }: { onCode: (data: string) => void; paused?: boolean }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const last = useRef<string | null>(null);

  if (!permission) return <View style={[styles.frame, { backgroundColor: '#000' }]} />;

  if (!permission.granted) {
    return (
      <View style={[styles.frame, styles.permission, { backgroundColor: colors.surfaceAlt }]}>
        <Camera size={36} color={colors.textMuted} />
        <Text variant="headline" align="center">
          {t('cashOut.cameraPermissionTitle')}
        </Text>
        <Text variant="body" color="textMuted" align="center">
          {t('cashOut.cameraPermissionBody')}
        </Text>
        <Button label={t('cashOut.cameraPermissionAllow')} onPress={requestPermission} />
      </View>
    );
  }

  return (
    <View style={styles.frame}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={
          paused
            ? undefined
            : ({ data }) => {
                if (data === last.current) return;
                last.current = data;
                onCode(data);
              }
        }
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={[styles.window, { borderColor: '#FFFFFF' }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: 1, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000' },
  permission: { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  window: { width: '65%', aspectRatio: 1, borderWidth: 3, borderRadius: radius.lg }
});
