import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../api/endpoints';
import { errorMessage } from './errors';

export type AvatarMessage = { tone: 'success' | 'danger'; text: string } | null;

/** Take, choose or remove the agent's profile photo (Perfil and Ajustes). Always says what happened. */
export function useAvatarPicker() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<AvatarMessage>(null);

  const pick = async (from: 'camera' | 'library') => {
    setMessage(null);
    // The browser asks by itself when the file picker opens the camera.
    if (Platform.OS !== 'web') {
      const permission = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setMessage({ tone: 'danger', text: from === 'camera' ? t('verification.cameraDenied') : 'Sin permiso para ver tus fotos. Actívalo en los ajustes del teléfono.' });
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, exif: false, allowsEditing: true, aspect: [1, 1] };
    const picked = from === 'camera' ? await ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front }) : await ImagePicker.launchImageLibraryAsync(options);
    if (picked.canceled || !picked.assets[0]) return;
    setBusy(true);
    try {
      await endpoints.uploadAvatar(picked.assets[0]);
      await qc.invalidateQueries({ queryKey: ['me'] });
      setMessage({ tone: 'success', text: 'Foto de perfil actualizada.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setMessage(null);
    setBusy(true);
    try {
      await endpoints.removeAvatar();
      await qc.invalidateQueries({ queryKey: ['me'] });
      setMessage({ tone: 'success', text: 'Foto de perfil quitada.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  };

  return { pick, remove, busy, message, setMessage };
}
