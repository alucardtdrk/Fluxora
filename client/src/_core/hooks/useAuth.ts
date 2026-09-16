import { trpc } from "@/lib/trpc";
import { useCallback, useMemo } from "react";

export function useAuth() {
  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const statusQuery = trpc.auth.status.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    },
  });

  const loginWithGoogle = useCallback(() => {
    window.location.assign("/api/auth/google");
  }, []);
  const logout = useCallback(async () => logoutMutation.mutateAsync(), [logoutMutation]);

  const state = useMemo(
    () => ({
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || statusQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? statusQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
      authConfigured: statusQuery.data?.configured ?? false,
      authProvider: statusQuery.data?.provider ?? "google",
    }),
    [meQuery.data, meQuery.error, meQuery.isLoading, statusQuery.data, statusQuery.error, statusQuery.isLoading, logoutMutation.error, logoutMutation.isPending],
  );

  return {
    ...state,
    loginWithGoogle,
    logout,
    refresh: () => meQuery.refetch(),
  };
}
