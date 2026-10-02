import { useQuery } from '@tanstack/react-query';
import { endpoints } from '../api/endpoints';
import type { Onboarding } from '../api/types';

/** The reinforced agent verification: what the server says is missing (velynt/backend/agent_onboarding.py). */
export const useOnboarding = (enabled = true) => useQuery({ queryKey: ['onboarding'], queryFn: endpoints.onboarding, staleTime: 10_000, enabled });

/** Missing, rejected or waiting for Velynt: what the agent sees on the home screen. */
export function verificationState(data: Onboarding | undefined) {
  if (!data) return null;
  const rejected = data.requirements.some((r) => r.status === 'rejected' && r.who === 'applicant');
  const missing = data.requirements.filter((r) => r.status === 'missing' && r.who === 'applicant').length;
  return { rejected, missing, waiting: data.complete_for_applicant && !data.ready_to_approve };
}
