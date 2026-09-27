import { Redirect, Stack } from 'expo-router';
import { useSession } from '../../state/session';

export default function AuthLayout() {
  const status = useSession((s) => s.status);
  if (status === 'signedIn') return <Redirect href="/home" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
