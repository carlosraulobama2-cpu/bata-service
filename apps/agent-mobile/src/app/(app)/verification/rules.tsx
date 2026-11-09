import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Check, CheckCircle2, Download, FileText } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { endpoints } from '../../../api/endpoints';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Header } from '../../../components/Header';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { rulesDocument, rulesHtml } from '../../../features/agentRules';
import { errorMessage } from '../../../features/errors';
import { useMe } from '../../../features/queries';
import { useOnboarding } from '../../../features/verification';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { useTranslation } from 'react-i18next';

/**
 * Last step of the application: the agent rules document (what is needed, the agent's earnings and
 * Velynt's, duties). The applicant accepts it and waits for Velynt to approve the account.
 */
export default function RulesScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useOnboarding();
  const me = useMe();
  const status = me.data?.agent?.status;
  // Only an application in progress accepts; an approved agent reads the document.
  const canAccept = status === 'pending' || status === 'rejected';
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  const header = <Header leading="back" onLeading={close} title="Normas de agente" />;

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

  const doc = rulesDocument(data.terms);
  const alreadyAccepted = !!data.terms?.rules_accepted || !canAccept;

  const download = () => {
    if (Platform.OS !== 'web') return;
    const page = window.open('', '_blank');
    if (!page) return;
    page.document.write(rulesHtml(data.terms, data.rules_version));
    page.document.close();
    page.focus();
    setTimeout(() => page.print(), 300); // "Guardar como PDF" in the print dialog
  };

  const submit = async () => {
    if (!accept) return setFailure('Marca la casilla para aceptar las normas.');
    setBusy(true);
    setFailure(null);
    try {
      const updated = await endpoints.acceptRules(data.rules_version);
      qc.setQueryData(['onboarding'], updated);
      void qc.invalidateQueries({ queryKey: ['me'] });
      setSent(true);
    } catch (err) {
      setFailure(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Screen footer={<Button label="Volver al inicio" onPress={() => router.replace('/home')} testID="rules-done" />}>
        <View style={styles.sent}>
          <View style={[styles.sentIcon, { backgroundColor: colors.successSoft }]}>
            <CheckCircle2 size={56} color={colors.success} />
          </View>
          <Text variant="title" align="center">
            Solicitud enviada
          </Text>
          <Text variant="body" color="textMuted" align="center">
            Velynt revisará tus datos y tus fotos, y puede visitar tu local. Te avisaremos en la app cuando te demos de alta como agente.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      header={header}
      scroll
      footer={
        alreadyAccepted ? (
          <Button label="Volver" variant="secondary" onPress={close} />
        ) : (
          <View style={{ gap: space.sm }}>
            {failure ? <Banner tone="danger">{failure}</Banner> : null}
            <Button label="Aceptar y enviar solicitud" onPress={() => void submit()} loading={busy} style={!accept ? { opacity: 0.6 } : undefined} testID="rules-accept-submit" />
          </View>
        )
      }
    >
      <View style={styles.content}>
        {/* The document, laid out like a sheet of paper. */}
        <View style={[styles.paper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.paperHead, { backgroundColor: colors.hero }]}>
            <FileText size={22} color={colors.heroText} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" style={{ color: colors.heroText }}>
                {doc.title}
              </Text>
              <Text variant="caption" style={{ color: colors.heroText, opacity: 0.8 }}>
                PDF · Versión {data.rules_version}
              </Text>
            </View>
          </View>
          <View style={styles.paperBody}>
            <Text variant="body" color="textMuted">
              {doc.subtitle}
            </Text>
            {doc.sections.map((s) => (
              <View key={s.title} style={styles.section}>
                <Text variant="headline" color="primary">
                  {s.title}
                </Text>
                {s.paragraphs?.map((p) => (
                  <Text key={p} variant="body">
                    {p}
                  </Text>
                ))}
                {s.bullets?.map((b) => (
                  <View key={b} style={styles.bullet}>
                    <View style={[styles.dot, { backgroundColor: colors.primary }]} />
                    <Text variant="body" style={{ flex: 1 }}>
                      {b}
                    </Text>
                  </View>
                ))}
                {s.table ? (
                  <View style={[styles.table, { borderColor: colors.border }]}>
                    {s.table.map(([a, b], i) => (
                      <View key={a} style={[styles.tableRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                        <Text variant="body" style={{ flex: 1 }}>
                          {a}
                        </Text>
                        <Text variant="bodyStrong" color="primary">
                          {b}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </View>

        {Platform.OS === 'web' ? (
          <Button variant="secondary" icon={<Download size={18} color={colors.primary} />} label="Descargar PDF" onPress={download} testID="rules-download" />
        ) : null}

        {alreadyAccepted ? (
          <Banner tone="success">{canAccept ? 'Ya aceptaste estas normas. Velynt está revisando tu solicitud.' : 'Estas son las normas y ganancias vigentes para los agentes Velynt.'}</Banner>
        ) : (
          <Pressable onPress={() => setAccept(!accept)} style={styles.tick} accessibilityRole="checkbox" accessibilityState={{ checked: accept }} testID="rules-accept">
            <View style={[styles.box, { borderColor: accept ? colors.primary : colors.border, backgroundColor: accept ? colors.primary : 'transparent' }]}>
              {accept ? <Check size={16} color={colors.onPrimary} /> : null}
            </View>
            <Text variant="body" style={{ flex: 1 }}>
              He leído el documento y acepto las normas de agente, mis ganancias y las de Velynt.
            </Text>
          </Pressable>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg, paddingTop: space.sm, paddingBottom: space.xl },
  paper: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden', shadowColor: '#4A2040', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  paperHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  paperBody: { padding: space.lg, gap: space.md },
  section: { gap: space.sm, marginTop: space.sm },
  bullet: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 9 },
  table: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  tick: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  box: { width: 26, height: 26, borderRadius: radius.sm, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  sent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.huge },
  sentIcon: { width: 104, height: 104, borderRadius: 52, alignItems: 'center', justifyContent: 'center' }
});
