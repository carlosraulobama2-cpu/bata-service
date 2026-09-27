import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { endpoints, Period } from '../api/endpoints';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: endpoints.me, staleTime: 60_000 });
export const useBalance = () => useQuery({ queryKey: ['balance'], queryFn: endpoints.balance, staleTime: 15_000 });
export const useLimits = () => useQuery({ queryKey: ['limits'], queryFn: endpoints.limits, staleTime: 30_000 });
export const useToday = () => useQuery({ queryKey: ['transactions', 'today', 'recent'], queryFn: () => endpoints.transactions({ period: 'today', limit: 5 }), staleTime: 15_000 });
export const useTotals = (period: Period) =>
  useQuery({ queryKey: ['transactions', period, 'totals'], queryFn: () => endpoints.transactions({ period, limit: 1 }).then((p) => p.totals), staleTime: 30_000 });

export const useTransactionList = (period: Period, type?: string) =>
  useInfiniteQuery({
    queryKey: ['transactions', period, 'list', type ?? 'all'],
    queryFn: ({ pageParam }) => endpoints.transactions({ period, type, cursor: pageParam, limit: 20 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor
  });

export const useTransaction = (id: string) =>
  useQuery({
    queryKey: ['transaction', id],
    queryFn: () => endpoints.transaction(id).then((r) => r.transaction),
    // Keep following an operation that is still moving.
    refetchInterval: (q) => (q.state.data && ['pending', 'processing'].includes(q.state.data.status) ? 2500 : false)
  });
