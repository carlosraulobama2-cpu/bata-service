import { Redirect } from 'expo-router';

/** The QR tab is an action (opens the scanner), not a page. */
export default function QrTab() {
  return <Redirect href="/cash-out" />;
}
