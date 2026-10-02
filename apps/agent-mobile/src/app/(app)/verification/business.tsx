import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/endpoints';
import type { Activity, LegalForm } from '../../../api/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Chips } from '../../../components/Chips';
import { Header } from '../../../components/Header';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { errorMessage } from '../../../features/errors';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { groupThousands } from '../../../utils/format';
import { useOnboarding } from '../../../features/verification';

const ACTIVITIES: Activity[] = ['shop', 'pharmacy', 'phone_shop', 'kiosk', 'market_stall', 'supermarket', 'service_station', 'other'];

function Tick({ checked, onPress, label, testID }: { checked: boolean; onPress: () => void; label: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={styles.tick} accessibilityRole="checkbox" accessibilityState={{ checked }} testID={testID}>
      <View style={[styles.box, { borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primary : 'transparent' }]}>
        {checked ? <Check size={16} color={colors.onPrimary} /> : null}
      </View>
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Business data and declarations of the reinforced agent verification. */
export default function BusinessScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const { data } = useOnboarding();
  const [legalForm, setLegalForm] = useState<LegalForm>('individual');
  const [license, setLicense] = useState('');
  const [activity, setActivity] = useState<Activity>('shop');
  const [years, setYears] = useState('');
  const [hours, setHours] = useState('');
  const [altPhone, setAltPhone] = useState('');
  const [volume, setVolume] = useState('');
  const [floatSource, setFloatSource] = useState('');
  const [pep, setPep] = useState<'no' | 'yes'>('no');
  const [pepDetails, setPepDetails] = useState('');
  const [noRecord, setNoRecord] = useState(false);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Start from what was already sent (a rejected or half-done application).
  useEffect(() => {
    const p = data?.profile;
    if (!p || loaded) return;
    setLoaded(true);
    if (p.legal_form) setLegalForm(p.legal_form);
    setLicense(p.license_number);
    if (p.activity) setActivity(p.activity);
    setYears(p.years_in_business ? String(p.years_in_business) : '');
    setHours(p.opening_hours);
    setAltPhone(p.alt_phone_number);
    setVolume(p.expected_daily_volume_minor ? String(p.expected_daily_volume_minor) : '');
    setFloatSource(p.float_source);
    setPep(p.is_pep ? 'yes' : 'no');
    setPepDetails(p.pep_details);
    setNoRecord(p.no_criminal_record);
  }, [data, loaded]);

  const rules = t('verification.form.rules', { returnObjects: true }) as string[];
  const volumeNumber = Number(volume.replace(/\D/g, '')) || 0;
  const valid =
    license.trim().length >= 3 &&
    hours.trim().length >= 3 &&
    volumeNumber > 0 &&
    floatSource.trim().length >= 10 &&
    (pep === 'no' || pepDetails.trim().length >= 5) &&
    noRecord &&
    accept;

  const save = async () => {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await endpoints.saveBusinessProfile({
        legal_form: legalForm,
        license_number: license.trim(),
        activity,
        years_in_business: Number(years) || 0,
        opening_hours: hours.trim(),
        alt_phone_number: altPhone.trim(),
        expected_daily_volume_minor: volumeNumber,
        float_source: floatSource.trim(),
        is_pep: pep === 'yes',
        pep_details: pep === 'yes' ? pepDetails.trim() : '',
        no_criminal_record: noRecord,
        accept_rules_version: data.rules_version
      });
      qc.setQueryData(['onboarding'], updated);
      router.back();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const input = [styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }];
  const field = (label: string, node: React.ReactNode) => (
    <View style={styles.field}>
      <Text variant="label">{label}</Text>
      {node}
    </View>
  );

  return (
    <Screen
      header={<Header leading="back" onLeading={() => router.back()} title={t('verification.form.title')} />}
      footer={<Button label={t('verification.form.save')} onPress={() => void save()} disabled={!valid} loading={busy} testID="business-save" />}
      scroll
    >
      <View style={styles.content}>
        {field(
          t('verification.form.legalForm'),
          <Chips<LegalForm>
            value={legalForm}
            onChange={setLegalForm}
            options={[
              { value: 'individual', label: t('verification.form.individual') },
              { value: 'company', label: t('verification.form.company') }
            ]}
          />
        )}
        {field(t('verification.form.license'), <TextInput value={license} onChangeText={setLicense} autoCapitalize="characters" style={input} maxLength={64} testID="business-license" />)}
        {field(
          t('verification.form.activity'),
          <Chips<Activity> value={activity} onChange={setActivity} options={ACTIVITIES.map((a) => ({ value: a, label: t(`verification.activities.${a}`) }))} />
        )}
        {field(t('verification.form.years'), <TextInput value={years} onChangeText={(v) => setYears(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" style={input} />)}
        {field(
          t('verification.form.hours'),
          <TextInput value={hours} onChangeText={setHours} placeholder={t('verification.form.hoursPlaceholder')} placeholderTextColor={colors.textMuted} style={input} maxLength={120} />
        )}
        {field(t('verification.form.altPhone'), <TextInput value={altPhone} onChangeText={setAltPhone} keyboardType="phone-pad" placeholder="+240 333 000 000" placeholderTextColor={colors.textMuted} style={input} maxLength={20} />)}
        {field(
          t('verification.form.volume'),
          <TextInput value={groupThousands(String(volumeNumber || ''))} onChangeText={setVolume} keyboardType="number-pad" placeholder="1.500.000" placeholderTextColor={colors.textMuted} style={input} testID="business-volume" />
        )}
        {field(
          t('verification.form.floatSource'),
          <TextInput
            value={floatSource}
            onChangeText={setFloatSource}
            placeholder={t('verification.form.floatSourcePlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={[input, styles.multiline]}
            multiline
            maxLength={280}
            testID="business-float-source"
          />
        )}
        {field(
          t('verification.form.pep'),
          <Chips<'no' | 'yes'>
            value={pep}
            onChange={setPep}
            options={[
              { value: 'no', label: t('verification.form.no') },
              { value: 'yes', label: t('verification.form.yes') }
            ]}
          />
        )}
        {pep === 'yes' ? field(t('verification.form.pepDetails'), <TextInput value={pepDetails} onChangeText={setPepDetails} style={input} maxLength={280} />) : null}

        <Tick checked={noRecord} onPress={() => setNoRecord(!noRecord)} label={t('verification.form.criminal')} testID="business-no-record" />
        <Card>
          <Text variant="bodyStrong">{t('verification.form.rulesTitle')}</Text>
          {rules.map((rule) => (
            <Text key={rule} variant="body" color="textMuted" style={styles.rule}>
              • {rule}
            </Text>
          ))}
        </Card>
        <Tick checked={accept} onPress={() => setAccept(!accept)} label={t('verification.form.accept')} testID="business-accept" />
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg, paddingTop: space.sm, paddingBottom: space.xl },
  field: { gap: space.sm },
  input: { minHeight: 52, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 17 },
  multiline: { minHeight: 88, paddingTop: space.md, textAlignVertical: 'top' },
  tick: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  box: { width: 26, height: 26, borderRadius: radius.sm, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  rule: { marginTop: space.sm }
});
