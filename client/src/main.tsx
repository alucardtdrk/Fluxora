import { trpc } from "@/lib/trpc";
import { dehydrate, hydrate, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

const CACHE_KEY = "automation-control-center:query-cache:v2";
const CACHE_MAX_AGE = 6 * 60 * 60 * 1000;
const CACHE_WRITE_DEBOUNCE = 500;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
      staleTime: 30_000,
      gcTime: CACHE_MAX_AGE,
      retry: 1,
    },
  },
});

function isPersistableQuery(queryKey: readonly unknown[]) {
  const key = JSON.stringify(queryKey);
  if (!key.includes('"n8n"')) return false;
  return key.includes('"overview"') || key.includes('"workflows"') || key.includes('"analytics"') || key.includes('"executions"');
}

function restoreQueryCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { savedAt?: number; state?: unknown };
    if (!parsed.savedAt || !parsed.state || Date.now() - parsed.savedAt > CACHE_MAX_AGE) {
      localStorage.removeItem(CACHE_KEY);
      return;
    }
    hydrate(queryClient, parsed.state as Parameters<typeof hydrate>[1]);
  } catch {
    localStorage.removeItem(CACHE_KEY);
  }
}

function enableQueryCachePersistence() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  queryClient.getQueryCache().subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const state = dehydrate(queryClient, {
          shouldDehydrateQuery: (query) => {
            if (query.state.status !== "success" || !isPersistableQuery(query.queryKey)) return false;
            try {
              // Evita estourar o limite do localStorage em históricos muito grandes.
              return JSON.stringify(query.state.data).length < 2_000_000;
            } catch {
              return false;
            }
          },
        });
        localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), state }));
      } catch {
        // localStorage pode estar indisponível ou cheio; o app continua normalmente sem persistência.
      }
    }, CACHE_WRITE_DEBOUNCE);
  });
}

restoreQueryCache();
enableQueryCachePersistence();

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>,
);
