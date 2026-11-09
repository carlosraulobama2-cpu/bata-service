import jsQR from 'jsqr';
import { Camera } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { Button } from './Button';
import { Text } from './Text';

/**
 * Web version of the QR scanner: the browser camera (getUserMedia, back camera first) read frame by frame
 * with jsQR. Same contract as the native Scanner: each code reported once, again after a few seconds.
 */
export function Scanner({ onCode, paused }: { onCode: (data: string) => void; paused?: boolean }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const last = useRef<{ data: string; at: number } | null>(null);
  const onCodeRef = useRef(onCode);
  const pausedRef = useRef(paused);
  onCodeRef.current = onCode;
  pausedRef.current = paused;
  const [state, setState] = useState<'asking' | 'on' | 'denied' | 'unavailable'>('asking');

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setState('unavailable');
    setState('asking');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (video.current) {
        video.current.srcObject = stream.current;
        await video.current.play().catch(() => undefined);
      }
      setState('on');
    } catch (err) {
      setState((err as { name?: string })?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
    }
  }, []);

  useEffect(() => {
    void start();
    return () => stream.current?.getTracks().forEach((track) => track.stop());
  }, [start]);

  useEffect(() => {
    if (state !== 'on') return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let frame = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const v = video.current;
      if (ctx && v && v.readyState >= 2 && !pausedRef.current) {
        // Downscale: enough pixels for a phone-screen QR, fast on slow phones.
        const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
        if (code?.data) {
          const now = Date.now();
          if (!last.current || last.current.data !== code.data || now - last.current.at > 3000) {
            last.current = { data: code.data, at: now };
            onCodeRef.current(code.data);
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [state]);

  return (
    <View style={styles.frame}>
      <video ref={video} playsInline muted autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover', display: state === 'on' ? 'block' : 'none' }} />
      {state === 'on' ? (
        <View style={styles.overlay} pointerEvents="none">
          <View style={[styles.window, { borderColor: '#FFFFFF' }]} />
        </View>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.permission, { backgroundColor: colors.surfaceAlt }]}>
          <Camera size={36} color={colors.textMuted} />
          <Text variant="headline" align="center">
            {state === 'asking' ? t('cashOut.cameraPermissionTitle') : state === 'denied' ? 'Sin permiso de cámara' : 'No hay cámara disponible'}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {state === 'denied'
              ? 'Permite la cámara para esta página en el candado de la barra de direcciones y vuelve a intentarlo.'
              : state === 'unavailable'
                ? 'Este navegador no deja usar la cámara. Escribe el teléfono y el código del cliente.'
                : t('cashOut.cameraPermissionBody')}
          </Text>
          {state !== 'asking' ? <Button label={t('common.retry')} onPress={() => void start()} /> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: 1, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000' },
  permission: { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  window: { width: '65%', aspectRatio: 1, borderWidth: 3, borderRadius: radius.lg }
});
