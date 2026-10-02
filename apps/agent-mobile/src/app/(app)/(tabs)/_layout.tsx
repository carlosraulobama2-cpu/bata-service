import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Home, List, Percent, QrCode, UserRound } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../components/Text';
import { useTheme } from '../../../theme/ThemeProvider';
import { space } from '../../../theme/tokens';

const ITEMS = [
  { name: 'home', label: 'Inicio', Icon: Home },
  { name: 'operations', label: 'Operaciones', Icon: List },
  { name: 'qr', label: 'QR', Icon: QrCode },
  { name: 'commissions', label: 'Comisiones', Icon: Percent },
  { name: 'profile', label: 'Perfil', Icon: UserRound }
] as const;

/** Bottom bar with the QR action raised in the middle: always one tap away. */
function TabBar({ state, navigation }: { state: { index: number; routes: { name: string; key: string }[] }; navigation: { navigate: (name: string) => void } }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      {ITEMS.map((item) => {
        const routeIndex = state.routes.findIndex((r) => r.name === item.name);
        const focused = state.index === routeIndex;
        if (item.name === 'qr') {
          return (
            <View key={item.name} style={styles.item}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Escanear QR de recarga o de retiro"
                onPress={() => router.push('/qr/scan')}
                style={({ pressed }) => [styles.qr, { backgroundColor: colors.primary, borderColor: colors.surface, transform: [{ scale: pressed ? 0.95 : 1 }] }]}
              >
                <QrCode size={28} color={colors.onPrimary} />
              </Pressable>
            </View>
          );
        }
        const color = focused ? colors.primary : colors.textMuted;
        return (
          <Pressable
            key={item.name}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={item.label}
            onPress={() => navigation.navigate(item.name)}
            style={styles.item}
          >
            <item.Icon size={24} color={color} strokeWidth={focused ? 2.4 : 2} />
            <Text variant="caption" style={{ color, fontWeight: focused ? '600' : '400', fontSize: 11 }}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props: object) => <TabBar {...(props as Parameters<typeof TabBar>[0])} />}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="operations" />
      <Tabs.Screen name="qr" />
      <Tabs.Screen name="commissions" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 48 },
  qr: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginTop: -28, borderWidth: 4, shadowColor: '#0B5FFF', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 }
});
