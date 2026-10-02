import { Redirect } from 'expo-router';
import { useSession } from '../state/session';

export default function Index() {
  const status = useSession((s) => s.status);
  return <Redirect href={status === 'signedIn' ? '/home' : '/login'} />;
}
