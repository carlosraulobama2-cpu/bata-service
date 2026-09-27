import { useWindowDimensions } from 'react-native';

/** Short screens (common on low-cost Android phones): tighten vertical rhythm. */
export function useCompact(): boolean {
  return useWindowDimensions().height < 700;
}
