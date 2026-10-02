import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { endpoints, Period } from '../api/endpoints';
import type { TransactionType } from '../api/types';

/** Profile, agent status and float (one call: the float comes with /me). */
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: endpoints.me, staleTime: 15_000 });
export const useLimits = () => useQuery({ queryKey: ['limits'], queryFn: endpoints.limits, staleTime: 30_000 });
export const useToday = () => useQuery({ queryKey: ['transactions', 'today', 'recent'], queryFn: () => endpoints.transactions({ period: 'today', limit: 5 }), staleTime: 15_000 });

export const useTransactionList = (period: Period, type?: TransactionType) =>
  useInfiniteQuery({
    queryKey: ['transactions', period, 'list', type ?? 'all'],
    queryFn: ({ pageParam }) => endpoints.transactions({ period, type, offset: pageParam, limit: 20 }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined
  });

export const useTransaction = (id: string) => useQuery({ queryKey: ['transaction', id], queryFn: () => endpoints.transaction(id).then((r) => r.transaction) });

export const useCommissionSummary = () => useQuery({ queryKey: ['commissions', 'summary'], queryFn: endpoints.commissionSummary, staleTime: 30_000 });
/** Latest operations of the month: each one shows what the agent earned on it. */
export const useCommissionLines = () =>
  useInfiniteQuery({
    queryKey: ['transactions', 'this_month', 'commissions'],
    queryFn: ({ pageParam }) => endpoints.transactions({ period: 'this_month', offset: pageParam, limit: 20 }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined
  });

/** Bell badge: refreshed every minute while the app is open. */
export const useUnreadCount = () => useQuery({ queryKey: ['notifications', 'unread'], queryFn: endpoints.unreadCount, refetchInterval: 60_000, staleTime: 15_000 });
export const useNotifications = () =>
  useInfiniteQuery({
    queryKey: ['notifications', 'list'],
    queryFn: ({ pageParam }) => endpoints.notifications(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined
  });
