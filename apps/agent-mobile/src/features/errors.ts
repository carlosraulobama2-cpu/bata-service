import type { TFunction } from 'i18next';
import { ApiError } from '../api/client';
import { formatTime } from '../utils/format';

/** Turns any error into the agent-facing sentence (plus attempts left / lock time when known). */
export function errorMessage(err: unknown, t: TFunction): string {
  if (!(err instanceof ApiError)) return t('errors.server_error');
  let msg = t(`errors.${err.code}`, { defaultValue: t('errors.server_error') });
  const left = err.details.attempts_left;
  if (typeof left === 'number' && left > 0) msg += ` ${t('errors.attemptsLeft', { count: left })}`;
  const lockedUntil = err.details.locked_until;
  if (typeof lockedUntil === 'string') msg += ` ${t('errors.lockedUntil', { time: formatTime(lockedUntil) })}`;
  const retry = err.details.retry_after_seconds;
  if (typeof retry === 'number' && retry > 0) msg += ` ${t('errors.retryIn', { count: Math.ceil(retry / 60) })}`;
  return msg;
}
