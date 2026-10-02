import * as Device from 'expo-device';
import { Platform } from 'react-native';

export interface Integrity {
  rooted: boolean;
  emulator: boolean;
}

/**
 * Is this phone rooted / jailbroken, or an emulator? Sent to the server,
 * which refuses operations from such devices (reading stays available).
 * This is a signal the app reports about itself: it catches honest cases
 * and casual tampering; server-verified Play Integrity / App Attest is the
 * stronger check to add on top. Web (development only) reports nothing.
 */
export async function checkIntegrity(): Promise<Integrity | null> {
  if (Platform.OS === 'web') return null;
  const rooted = await Device.isRootedExperimentalAsync().catch(() => false);
  return { rooted, emulator: !Device.isDevice };
}
