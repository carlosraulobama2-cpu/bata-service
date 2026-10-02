import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/endpoints';
import type { Preferences } from '../../../api/types';
import { Avatar } from '../../../components/Avatar';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Chips } from '../../../components/Chips';
import { Header } from '../../../components/Header';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { errorMessage } from '../../../features/errors';
import { useMe } from '../../../features/queries';
import { useSettings } from '../../../state/settings';
import { space } from '../../../theme/tokens';
import { money } from '../../../utils/format';

/** Ajustes: profile photo, theme, hidden balance and notices. Saved on the server (they follow the agent). */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: endpoints.preferences });
  const apply = useSettings((s) => s.apply);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  const user = me.data?.user;
  const agent = me.data?.agent;

  const save = async (change: Partial<Preferences>) => {
    apply(change); // right away on screen; the server keeps it
    try {
      const saved = await endpoints.savePreferences(change);
      qc.setQueryData(['preferences'], saved);
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err, t) });
    }
  };
  const photo = async (from: 'camera' | 'library') => {
    const permission = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, exif: false, allowsEditing: true, aspect: [1, 1] };
    const picked = from === 'camera' ? await ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front }) : await ImagePicker.launchImageLibraryAsync(options);
    if (picked.canceled || !picked.assets[0]) return;
    setBusy(true);
    setMessage(null);
    try {
      await endpoints.uploadAvatar(picked.assets[0]);
      await qc.invalidateQueries({ queryKey: ['me'] });
      setMessage({ tone: 'success', text: t('settings.saved') });
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  };
  const p = prefs.data;
  const toggle = (label: string, value: boolean, onChange?: (v: boolean) => void) => (
    <View style={styles.toggle}>
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
      <Switch value={value} onValueChange={onChange} disabled={!onChange} accessibilityLabel={label} />
    </View>
  );

  return (
    <Screen header={<Header leading="close" onLeading={close} title={t('settings.title')} />} scroll>
      <View style={styles.content}>
        {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
        <Card style={styles.photoCard}>
          {user ? <Avatar name={user.name} version={user.avatar_version} size={96} /> : null}
          <Text variant="bodyStrong">{user?.name}</Text>
          <Text variant="caption" color="textMuted" align="center">
            {t('settings.photoHint')}
          </Text>
          <View style={styles.photoActions}>
            <Button label={t('settings.takePhoto')} onPress={() => void photo('camera')} loading={busy} />
            <Button variant="secondary" label={t('settings.changePhoto')} onPress={() => void photo('library')} disabled={busy} />
            {user?.has_avatar ? (
              <Button
                variant="ghost"
                label={t('settings.removePhoto')}
                onPress={() => void endpoints.removeAvatar().then(() => qc.invalidateQueries({ queryKey: ['me'] }))}
                disabled={busy}
              />
            ) : null}
          </View>
        </Card>

        <Text variant="title">{t('settings.appearance')}</Text>
        <Card style={{ gap: space.md }}>
          <Text variant="label">{t('settings.theme')}</Text>
          <Chips<Preferences['theme']>
            value={p?.theme ?? 'system'}
            onChange={(theme) => void save({ theme })}
            options={[
              { value: 'system', label: t('settings.themeSystem') },
              { value: 'light', label: t('settings.themeLight') },
              { value: 'dark', label: t('settings.themeDark') }
            ]}
          />
          {toggle(t('settings.hideBalance'), !!p?.hide_balance, (v) => void save({ hide_balance: v }))}
          <Text variant="caption" color="textMuted">
            {t('settings.hideBalanceHint')}
          </Text>
        </Card>

        <Text variant="title">{t('settings.notifications')}</Text>
        <Card style={{ gap: space.sm }}>
          {toggle(t('settings.notifyPayments'), p?.notify_payments ?? true, (v) => void save({ notify_payments: v }))}
          {toggle(t('settings.notifyFloat'), p?.notify_agent_float ?? true, (v) => void save({ notify_agent_float: v }))}
          {toggle(t('settings.notifySecurity'), true)}
          {toggle(t('settings.notifyMarketing'), !!p?.notify_marketing, (v) => void save({ notify_marketing: v }))}
        </Card>

        {agent ? (
          <>
            <Text variant="title">{t('settings.level')}</Text>
            <Card>
              <Text variant="body">{t('settings.levelBody', { level: t(`levels.${agent.level}`), max: money(agent.max_float) })}</Text>
            </Card>
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm, paddingBottom: space.xl },
  photoCard: { alignItems: 'center', gap: space.sm },
  photoActions: { width: '100%', gap: space.xs, marginTop: space.sm },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 }
});
