import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Camera, CheckCircle2, Circle, Clock, Image as ImageIcon, RotateCcw, XCircle } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/endpoints';
import type { RequirementStatus } from '../../../api/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Header } from '../../../components/Header';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { errorMessage } from '../../../features/errors';
import { useMe } from '../../../features/queries';
import { useOnboarding } from '../../../features/verification';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { formatDate } from '../../../utils/format';

function StateIcon({ status }: { status: RequirementStatus }) {
  const { colors } = useTheme();
  if (status === 'done') return <CheckCircle2 size={20} color={colors.success} />;
  if (status === 'rejected') return <XCircle size={20} color={colors.danger} />;
  if (status === 'in_review') return <Clock size={20} color={colors.warning} />;
  return <Circle size={20} color={colors.textMuted} />;
}

/**
 * Reinforced agent verification. The server says what is missing (velynt/backend/agent_onboarding.py);
 * the app only shows it and sends the data and photos.
 */
export default function VerificationScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const me = useMe();
  const { data, error, refetch, isLoading } = useOnboarding();
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  const editable = me.data?.agent?.status === 'pending' || me.data?.agent?.status === 'rejected';

  const pick = async (kind: string, from: 'camera' | 'library') => {
    setMessage(null);
    const permission = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage({ tone: 'danger', text: t('verification.cameraDenied') });
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, exif: false, allowsEditing: false };
    const result = from === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets[0]) return;
    setBusyKind(kind);
    try {
      await endpoints.uploadDocument(kind, result.assets[0]);
      setMessage({ tone: 'success', text: t('verification.uploaded') });
      await qc.invalidateQueries({ queryKey: ['onboarding'] });
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err, t) });
    } finally {
      setBusyKind(null);
    }
  };

  const header = <Header leading="close" onLeading={close} title={t('verification.title')} />;
  if (isLoading) {
    return (
      <Screen header={header}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: space.xxl }} />
      </Screen>
    );
  }
  if (error || !data) {
    return (
      <Screen header={header} footer={<Button label={t('common.retry')} onPress={() => void refetch()} />}>
        <Banner tone="danger">{errorMessage(error, t)}</Banner>
      </Screen>
    );
  }

  const done = data.requirements.filter((r) => r.status === 'done').length;
  const label = (status: RequirementStatus) =>
    ({ done: t('verification.done'), rejected: t('verification.rejected'), in_review: t('verification.inReview'), missing: t('verification.missing') })[status];
  const business = data.requirements.filter((r) => r.code === 'business' || r.code === 'declarations');
  const businessDone = business.every((r) => r.status === 'done');

  return (
    <Screen header={header} scroll>
      <View style={styles.content}>
        <Text variant="body" color="textMuted">
          {t('verification.intro')}
        </Text>
        <View style={[styles.progressTrack, { backgroundColor: colors.neutralSoft }]} accessibilityLabel={t('verification.progress', { done, total: data.requirements.length })}>
          <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${Math.round((done / data.requirements.length) * 100)}%` }]} />
        </View>
        <Text variant="label" color="textMuted">
          {t('verification.progress', { done, total: data.requirements.length })}
        </Text>
        {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
        {!editable ? <Banner tone="info">{t('verification.closed')}</Banner> : data.complete_for_applicant ? <Banner tone="success">{t('verification.allSent')}</Banner> : null}
        {data.profile?.next_review_at ? (
          <Text variant="caption" color="textMuted">
            {t('verification.nextReview', { date: formatDate(data.profile.next_review_at) })}
          </Text>
        ) : null}

        <Card>
          {data.requirements
            .filter((r) => !r.code.startsWith('document:'))
            .map((r, index, list) => (
              <View key={r.code} style={[styles.row, index < list.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                <StateIcon status={r.status} />
                <View style={{ flex: 1 }}>
                  <Text variant="body">{r.label}</Text>
                  {r.detail && r.status !== 'done' && r.code !== 'business' ? (
                    <Text variant="caption" color="textMuted">
                      {r.detail}
                    </Text>
                  ) : null}
                </View>
                <Text variant="caption" color={r.status === 'rejected' ? 'danger' : 'textMuted'}>
                  {label(r.status)}
                </Text>
              </View>
            ))}
        </Card>

        {editable ? (
          <Button
            variant={businessDone ? 'secondary' : 'primary'}
            label={businessDone ? t('verification.business') : t('verification.businessEdit')}
            onPress={() => router.push('/verification/business')}
            testID="verification-business"
          />
        ) : null}

        <Text variant="title">{t('verification.documents')}</Text>
        <Text variant="caption" color="textMuted">
          {t('verification.photoHint')}
        </Text>
        {data.documents.map((slot) => {
          const status: RequirementStatus = !slot.document
            ? 'missing'
            : slot.document.status === 'approved'
              ? 'done'
              : slot.document.status === 'rejected'
                ? 'rejected'
                : 'in_review';
          const canSend = editable && status !== 'done';
          return (
            <Card key={slot.kind}>
              <View style={styles.row}>
                <StateIcon status={status} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{slot.label}</Text>
                  {slot.document?.status === 'rejected' && slot.document.review_note ? (
                    <Text variant="caption" color="danger">
                      {slot.document.review_note}
                    </Text>
                  ) : null}
                </View>
                <Text variant="caption" color={status === 'rejected' ? 'danger' : 'textMuted'}>
                  {label(status)}
                </Text>
              </View>
              {canSend ? (
                busyKind === slot.kind ? (
                  <View style={styles.uploading}>
                    <ActivityIndicator color={colors.primary} />
                    <Text variant="caption" color="textMuted">
                      {t('verification.uploading')}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.actions}>
                    <Button
                      variant={slot.document ? 'secondary' : 'primary'}
                      icon={slot.document ? <RotateCcw size={18} color={colors.primary} /> : <Camera size={18} color={colors.onPrimary} />}
                      label={slot.document ? t('verification.retake') : t('verification.takePhoto')}
                      onPress={() => void pick(slot.kind, 'camera')}
                      disabled={busyKind !== null}
                      testID={`verification-photo-${slot.kind}`}
                    />
                    <Button
                      variant="ghost"
                      icon={<ImageIcon size={18} color={colors.primary} />}
                      label={t('verification.choosePhoto')}
                      onPress={() => void pick(slot.kind, 'library')}
                      disabled={busyKind !== null}
                    />
                  </View>
                )
              ) : null}
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm, paddingBottom: space.xl },
  progressTrack: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  actions: { gap: space.xs, marginTop: space.sm },
  uploading: { flexDirection: 'row', gap: space.sm, alignItems: 'center', marginTop: space.sm }
});
