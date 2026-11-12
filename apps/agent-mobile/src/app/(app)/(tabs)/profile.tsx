import { LinearGradient } from 'expo-linear-gradient';
import { router, type Href } from 'expo-router';
import {
  ArrowLeftRight,
  AtSign,
  BadgeCheck,
  BarChart3,
  Bell,
  BellRing,
  Camera,
  ChevronRight,
  Coins,
  FileCheck2,
  FileText,
  Gauge,
  HandCoins,
  ImageIcon,
  LifeBuoy,
  ListOrdered,
  LogOut,
  MapPin,
  Settings,
  ShieldCheck,
  Store,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon
} from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { signOut } from '../../../api/auth';
import { Avatar } from '../../../components/Avatar';
import { Banner } from '../../../components/Banner';
import { Card } from '../../../components/Card';
import { Screen } from '../../../components/Screen';
import { Skeleton } from '../../../components/States';
import { Text } from '../../../components/Text';
import { config } from '../../../config';
import { useMe } from '../../../features/queries';
import { useAvatarPicker } from '../../../features/useAvatarPicker';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space, tintBg, tints } from '../../../theme/tokens';
import { formatPhone, money } from '../../../utils/format';

type Item = { Icon: LucideIcon; tint: string; label: string; caption?: string; href: Href; show?: boolean };

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const me = useMe();
  const agent = me.data?.agent;
  const user = me.data?.user;
  const active = agent?.status === 'active';
  const avatar = useAvatarPicker();
  const [photoMenu, setPhotoMenu] = useState(false);
  const statusColor = active ? '#7BE0A6' : agent?.status === 'suspended' ? '#FF9B8F' : '#FFD08A';

  const confirmSignOut = () => {
    if (Platform.OS === 'web') return void signOut();
    Alert.alert(t('auth.signOut'), t('auth.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.signOut'), style: 'destructive', onPress: () => void signOut() }
    ]);
  };
  const choose = (action: () => Promise<void>) => {
    setPhotoMenu(false);
    void action();
  };

  const sections: { title: string; items: Item[] }[] = [
    {
      title: 'Mi negocio',
      items: [
        { Icon: Store, tint: tints.orange, label: 'Solicitar ser agente', caption: 'Rellena la solicitud', href: '/apply', show: !agent },
        { Icon: BadgeCheck, tint: tints.green, label: t('verification.title'), caption: agent ? t(`profile.agentStatus.${agent.status}`, { defaultValue: agent.status }) : undefined, href: '/verification', show: !!agent },
        { Icon: FileText, tint: tints.purple, label: 'Normas y ganancias del agente', caption: 'Lo que ganas tú y lo que gana Velynt', href: '/verification/rules', show: !!agent },
        { Icon: Gauge, tint: tints.blue, label: t('profile.limits'), caption: agent ? t(`levels.${agent.level}`, { defaultValue: agent.level }) : undefined, href: '/limits', show: active }
      ]
    },
    {
      title: 'Operaciones',
      items: [
        { Icon: Coins, tint: tints.amber, label: 'Mis ganancias', href: '/commissions', show: active },
        { Icon: ListOrdered, tint: tints.blue, label: t('dashboard.actionMovements'), href: '/movements', show: active },
        { Icon: Wallet, tint: tints.green, label: t('dashboard.actionCash'), href: '/cash', show: active },
        { Icon: HandCoins, tint: tints.amber, label: t('dashboard.actionRequestFloat'), href: '/float-request', show: active },
        { Icon: ArrowLeftRight, tint: tints.indigo, label: t('dashboard.actionTransfer'), href: '/transfer', show: active },
        { Icon: Users, tint: tints.teal, label: t('dashboard.actionCustomers'), href: '/customers', show: active },
        { Icon: UserPlus, tint: tints.pink, label: t('openCustomer.action'), href: '/customers/open', show: active },
        { Icon: BarChart3, tint: tints.purple, label: t('dashboard.actionStats'), href: '/stats', show: active }
      ]
    },
    {
      title: t('profile.security'),
      items: [
        { Icon: ShieldCheck, tint: tints.indigo, label: t('profile.securityRow'), caption: user && !user.has_pin ? 'Crea tu PIN de pagos' : undefined, href: '/security' },
        { Icon: Settings, tint: tints.slate, label: t('settings.title'), caption: 'Foto, tema, saldo oculto y nivel', href: '/settings' },
        { Icon: Bell, tint: tints.orange, label: t('profile.notifications'), href: '/notifications' },
        { Icon: BellRing, tint: tints.red, label: 'Preferencias de avisos', href: '/notification-settings' }
      ]
    },
    {
      title: 'Ayuda y legal',
      items: [
        { Icon: LifeBuoy, tint: tints.teal, label: t('profile.help'), href: '/help' },
        { Icon: FileCheck2, tint: tints.slate, label: t('legal.terms'), href: { pathname: '/legal/[kind]', params: { kind: 'terms' } } },
        { Icon: ShieldCheck, tint: tints.slate, label: t('legal.privacy'), href: { pathname: '/legal/[kind]', params: { kind: 'privacy' } } }
      ]
    }
  ];

  return (
    <Screen scroll edges={['top']} refreshing={me.isRefetching} onRefresh={() => me.refetch()}>
      <Text variant="title" style={styles.title} accessibilityRole="header">
        {t('profile.title')}
      </Text>

      {/* Identity card: photo (tap to change), name, agent code, status and level. */}
      <LinearGradient colors={[colors.hero, colors.heroEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroRow}>
          <Pressable onPress={() => setPhotoMenu(!photoMenu)} accessibilityRole="button" accessibilityLabel={t('settings.changePhoto')} testID="profile-photo">
            <View style={[styles.avatarRing, { borderColor: 'rgba(255,255,255,0.35)' }]}>
              {user ? <Avatar name={user.name} version={user.avatar_version} size={76} /> : <Skeleton width={76} height={76} />}
            </View>
            <View style={[styles.cameraBadge, { backgroundColor: colors.sunset, borderColor: colors.hero }]}>
              {avatar.busy ? <ActivityIndicator size="small" color="#fff" /> : <Camera size={14} color="#fff" />}
            </View>
          </Pressable>
          {user ? (
            <View style={styles.flex}>
              <Text variant="headline" style={{ color: colors.heroText }} numberOfLines={1}>
                {user.name}
              </Text>
              <Text variant="label" style={{ color: colors.heroMuted }} numberOfLines={1}>
                {agent?.code ?? user.email}
              </Text>
              {agent ? (
                <View style={[styles.statusPill, { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                  <Text variant="caption" style={{ color: colors.heroText, fontWeight: '700' }}>
                    {t(`profile.agentStatus.${agent.status}`, { defaultValue: agent.status }).toUpperCase()}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={[styles.flex, { gap: 8 }]}>
              <Skeleton width={140} height={20} />
              <Skeleton width={90} height={14} />
            </View>
          )}
        </View>
        {agent ? (
          <View style={[styles.heroStats, { borderTopColor: 'rgba(255,255,255,0.18)' }]}>
            <HeroStat label="Nivel" value={t(`levels.${agent.level}`, { defaultValue: agent.level })} />
            <HeroStat label="Saldo máximo" value={money(agent.max_float)} />
            <HeroStat label="Desde" value={new Date(agent.created_at).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })} />
          </View>
        ) : null}
      </LinearGradient>

      {photoMenu ? (
        <Card floating style={styles.photoMenu}>
          <MenuButton Icon={Camera} label={t('settings.takePhoto')} onPress={() => choose(() => avatar.pick('camera'))} testID="profile-photo-camera" />
          <MenuButton Icon={ImageIcon} label="Elegir de la galería" onPress={() => choose(() => avatar.pick('library'))} testID="profile-photo-library" />
          {user?.has_avatar ? <MenuButton Icon={Trash2} label={t('settings.removePhoto')} danger onPress={() => choose(avatar.remove)} /> : null}
        </Card>
      ) : null}
      {avatar.message ? <Banner tone={avatar.message.tone}>{avatar.message.text}</Banner> : null}

      {agent ? (
        <Card style={styles.business}>
          <InfoLine Icon={Store} tint={tints.orange} label={t('profile.business')} value={agent.business_name} strong />
          <InfoLine Icon={MapPin} tint={tints.red} label={t('profile.location')} value={[agent.address, agent.city].filter(Boolean).join(', ')} />
          <InfoLine Icon={AtSign} tint={tints.blue} label={user?.phone_number ? `${t('profile.email')} · Teléfono` : t('profile.email')} value={`${user?.email ?? '—'}${user?.phone_number ? ` · ${formatPhone(user.phone_number)}` : ''}`} />
        </Card>
      ) : null}

      {sections.map((section) => {
        const items = section.items.filter((i) => i.show !== false);
        if (!items.length) return null;
        return (
          <View key={section.title}>
            <Text variant="overline" color="textMuted" style={styles.section}>
              {section.title}
            </Text>
            <Card padded={false} style={{ overflow: 'hidden' }}>
              {items.map((item, index) => (
                <Row key={item.label} item={item} last={index === items.length - 1} />
              ))}
            </Card>
          </View>
        );
      })}

      <Card padded={false} style={{ overflow: 'hidden', marginTop: space.xl }}>
        <Pressable onPress={confirmSignOut} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.neutralSoft }]} testID="profile-sign-out">
          <View style={[styles.icon, { backgroundColor: colors.dangerSoft }]}>
            <LogOut size={18} color={colors.danger} />
          </View>
          <Text variant="bodyStrong" color="danger">
            {t('auth.signOut')}
          </Text>
        </Pressable>
      </Card>

      <Text variant="caption" color="textMuted" align="center" style={{ marginTop: space.xl, marginBottom: space.lg }}>
        {t('common.appName')} · {t('profile.version', { version: config.appVersion })}
      </Text>
    </Screen>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.flex}>
      <Text variant="caption" style={{ color: colors.heroMuted }}>
        {label}
      </Text>
      <Text variant="label" style={{ color: colors.heroText, fontWeight: "700" }} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function InfoLine({ Icon, tint, label, value, strong }: { Icon: LucideIcon; tint: string; label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.infoLine}>
      <View style={[styles.icon, { backgroundColor: tintBg(tint) }]}>
        <Icon size={18} color={tint} />
      </View>
      <View style={styles.flex}>
        <Text variant="caption" color="textMuted">
          {label}
        </Text>
        <Text variant={strong ? 'bodyStrong' : 'body'} numberOfLines={2}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function MenuButton({ Icon, label, onPress, danger, testID }: { Icon: LucideIcon; label: string; onPress: () => void; danger?: boolean; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.menuButton, pressed && { backgroundColor: colors.neutralSoft }]} testID={testID}>
      <Icon size={20} color={danger ? colors.danger : colors.primary} />
      <Text variant="bodyStrong" color={danger ? 'danger' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
}

function Row({ item, last }: { item: Item; last: boolean }) {
  const { colors } = useTheme();
  const { Icon } = item;
  return (
    <Pressable
      onPress={() => router.push(item.href)}
      testID={`profile-row-${item.label}`}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, pressed && { backgroundColor: colors.neutralSoft }]}
    >
      <View style={[styles.icon, { backgroundColor: tintBg(item.tint) }]}>
        <Icon size={18} color={item.tint} />
      </View>
      <View style={styles.flex}>
        <Text variant="bodyStrong">{item.label}</Text>
        {item.caption ? (
          <Text variant="caption" color="textMuted">
            {item.caption}
          </Text>
        ) : null}
      </View>
      <ChevronRight size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { paddingTop: space.lg, paddingBottom: space.lg },
  flex: { flex: 1 },
  hero: { borderRadius: radius.card, padding: space.xl, gap: space.lg, marginBottom: space.md },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  avatarRing: { borderWidth: 3, borderRadius: 44, padding: 2 },
  cameraBadge: { position: 'absolute', right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  statusPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: space.xs, marginTop: space.sm, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  heroStats: { flexDirection: 'row', gap: space.md, borderTopWidth: 1, paddingTop: space.md },
  photoMenu: { marginBottom: space.md, paddingVertical: space.xs },
  menuButton: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 52, borderRadius: radius.md },
  business: { gap: space.md },
  infoLine: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  section: { marginTop: space.xl, marginBottom: space.sm },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 60, paddingVertical: space.md }
});
