import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Close as PopoverClose } from "@radix-ui/react-popover";
import { Link, useLocation } from "wouter";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  ChevronLeft,
  LayoutDashboard,
  LogOut,
  Search,
  Plus,
  MoreHorizontal,
  ScrollText,
  Settings2,
  ShieldCheck,
  Workflow,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { FluxoraBrand, FluxoraMark } from "@/components/FluxoraBrand";
import { useTheme } from "@/contexts/ThemeContext";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { PREFERENCES_UPDATED_EVENT, readPreferredRefreshSeconds } from "@/lib/preferences";

const operationItems = [
  { label: "Visão geral", path: "/", icon: LayoutDashboard },
  { label: "Workflows", path: "/workflows", icon: Workflow },
  { label: "Execuções", path: "/executions", icon: Activity },
  { label: "Erros", path: "/errors", icon: AlertTriangle },
  { label: "Analytics", path: "/analytics", icon: BarChart3 },
  { label: "Workspace Security", path: "/workspace-security", icon: ShieldCheck },
];

function MonitoringRadar({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
    <path d="M16 3.34 A10 10 0 1 0 18.07 19.07" />
    <path d="M14 6.28 A6.5 6.5 0 1 0 15.6 16.6" />
    <path d="M12.08 8.67 A3.5 3.5 0 1 0 13.48 14.48" />
    <path d="M11 12 L17.5 5.5" />
    <circle cx="11" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="20" cy="3.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>;
}

const baseManagementItems = [
  { label: "Monitoramento", path: "/monitoring", icon: MonitoringRadar },
];
const adminManagementItems = [
  { label: "Auditoria", path: "/audit", icon: ScrollText },
  { label: "Usuários e permissões", path: "/users", icon: Users },
  { label: "Configurações", path: "/settings", icon: Settings2 },
];
const allItems = [...operationItems, ...baseManagementItems, ...adminManagementItems];

function LoginScreen() {
  const { loginWithGoogle, loading, error, authConfigured } = useAuth();
  const authError = new URLSearchParams(window.location.search).get("authError");

  const authErrorMessage = (() => {
    switch (authError) {
      case "domain_not_allowed": return "Esta conta Google não possui permissão para acessar o painel.";
      case "access_not_allowed": return "Sua conta não está habilitada para acessar o Fluxora. Solicite acesso a um administrador.";
      case "email_not_verified": return "Não foi possível validar o e-mail da conta Google.";
      case "invalid_state": return "A sessão de autenticação expirou. Tente entrar novamente.";
      case "access_denied": return "O acesso com Google foi cancelado.";
      case "google_not_configured": return "O acesso corporativo está temporariamente indisponível.";
      case "token_exchange_failed":
      case "userinfo_failed":
      case "missing_access_token":
      case "oauth_failed": return "Não foi possível concluir o login. Tente novamente em instantes.";
      default: return null;
    }
  })();

  return (
    <div className="fluxora-login min-h-dvh px-4 py-4 md:px-5 md:py-8 text-white md:px-8">
      <div className="fluxora-login-aurora pointer-events-none fixed inset-0" />
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1120px] items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[32px] border border-white/10 shadow-[0_35px_100px_rgba(16,4,42,.48)] md:grid-cols-[1.08fr_.92fr]">
          <section className="fluxora-login-panel relative overflow-hidden px-6 py-6 md:px-14 md:py-16">
            <div className="fluxora-circuit pointer-events-none absolute inset-0 opacity-70" />
            <div className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full bg-[#286EF7]/15 blur-[100px]" />
            <div className="relative flex h-full min-h-0 flex-col md:min-h-[520px]">
              <FluxoraBrand light />
              <div className="hidden my-auto py-5 md:block md:py-12">
                <h1 className="max-w-[560px] text-[28px] font-bold leading-[1.04] tracking-[-0.06em] md:text-[60px]">
                  Controle operacional para suas automações.
                </h1>
                <p className="mt-4 md:mt-8 max-w-[470px] text-base leading-7 text-[#E2D8F5]">
                  Acompanhe workflows, execuções, falhas e tendências em um único ambiente.
                </p>
              </div>
              <p className="hidden text-xs font-medium text-[#7F8CC8] md:block">Automação sob controle.</p>
            </div>
          </section>

          <section className="bg-[#F0EBE2] px-6 py-7 text-[#280E59] md:px-14 md:py-16">
            <div className="flex h-full min-h-0 flex-col justify-center md:min-h-[520px]">
              <div className="hidden mb-4 md:mb-8 md:flex h-14 w-14 items-center justify-center"><FluxoraMark className="h-12 w-12" /></div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#72668A]">Acesso corporativo</p>
              <h2 className="mt-5 text-[34px] font-bold tracking-[-0.055em]">Entrar no painel</h2>
              <p className="mt-4 max-w-sm text-[15px] leading-6 text-[#667085]">Use sua conta corporativa para acessar o Fluxora.</p>

              <Button
                type="button"
                disabled={loading || !authConfigured}
                onClick={loginWithGoogle}
                className="mt-9 h-14 w-full rounded-2xl bg-[#286EF7] text-[15px] font-bold text-white shadow-[0_12px_22px_rgba(40,110,247,.25)] hover:bg-[#1A5FE3]"
              >
                <span className="mr-3 text-lg font-bold tracking-[-0.08em]"><span className="text-white">G</span></span>
                {loading ? "Conectando…" : "Continuar com Google"}
              </Button>

              {(authErrorMessage || error) && (
                <p className="mt-5 rounded-2xl border border-[#F2D5CB] bg-[#FFF5F1] px-4 py-3 text-xs leading-5 text-[#A14E36]">
                  {authErrorMessage || "Não foi possível validar sua sessão. Tente novamente."}
                </p>
              )}

              {!authConfigured && !authErrorMessage && (
                <p className="mt-5 text-xs leading-5 text-[#98A2B3]">O acesso corporativo está temporariamente indisponível.</p>
              )}

              <div className="mt-10 flex items-center gap-2 text-xs leading-5 text-[#72668A]">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span>Acesso restrito a contas corporativas autorizadas.</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function OperationsShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const utils = trpc.useUtils();
  const [collapsed, setCollapsed] = useState(() => sessionStorage.getItem("fluxoraSidebarCollapsed") === "true");
  useEffect(() => {
    sessionStorage.setItem("fluxoraSidebarCollapsed", String(collapsed));
  }, [collapsed]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(() => readPreferredRefreshSeconds() * 1000);
  const [location, setLocation] = useLocation();
  const errorExecutions = trpc.n8n.recentErrors.useQuery(undefined, {
    enabled: Boolean(user),
    retry: false,
    refetchInterval: refreshIntervalMs,
  });
  const executions = trpc.n8n.executions.useQuery(undefined, { enabled: Boolean(user) && commandOpen, retry: false });
  const workflows = trpc.n8n.workflows.useQuery(undefined, { enabled: Boolean(user), retry: false });
  const notificationState = trpc.notifications.readState.useQuery(undefined, { enabled: Boolean(user), retry: false });
  const markRead = trpc.notifications.markRead.useMutation({
    onError: () => toast.error("Não foi possível salvar a leitura das notificações. Abra o sino novamente para tentar."),
  });
  const initializedRef = useRef(false);
  const notifiedStorageKey = `fluxoraNotifiedErrors:${user?.email ?? ""}`;

  const recentErrors = useMemo(() => (errorExecutions.data?.items ?? [])
    .filter((item: any) => ["error", "failed", "crashed"].includes(String(item.status || "").toLowerCase()))
    .slice(0, 12), [errorExecutions.data]);
  const seenErrorIds = notificationState.data?.seenErrorExecutionIds ?? [];
  const unread = recentErrors.filter((item: any) => !seenErrorIds.includes(String(item.id)));

  useEffect(() => {
    const syncPreferences = () => setRefreshIntervalMs(readPreferredRefreshSeconds() * 1000);
    window.addEventListener(PREFERENCES_UPDATED_EVENT, syncPreferences);
    return () => window.removeEventListener(PREFERENCES_UPDATED_EVENT, syncPreferences);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!notificationState.data || !errorExecutions.data || initializedRef.current) return;
    initializedRef.current = true;
    if (!notificationState.data.initialized && recentErrors.length > 0) {
      const ids = recentErrors.map((item: any) => String(item.id));
      utils.notifications.readState.setData(undefined, { ...notificationState.data, initialized: true, seenErrorExecutionIds: ids });
      markRead.mutate({ executionIds: ids });
    }
  }, [errorExecutions.data, markRead, notificationState.data, recentErrors, utils.notifications.readState]);

  useEffect(() => {
    if (!notificationState.data?.initialized || unread.length === 0) return;
    const newest = unread[0] as any;
    const notifiedIds = (sessionStorage.getItem(notifiedStorageKey) ?? "").split(",");
    if (notifiedIds.includes(String(newest.id))) return;
    sessionStorage.setItem(notifiedStorageKey, [String(newest.id), ...notifiedIds].slice(0, 250).join(","));
    toast.error(`Falha detectada: ${newest.workflowName || "Workflow"}`, { id: `${notifiedStorageKey}:${newest.id}`, description: `Execução #${newest.id}` });
  }, [notificationState.data?.initialized, notifiedStorageKey, unread]);

  if (loading) return <div className="grid min-h-screen place-items-center bg-background ">
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-4">
      <div className="grid h-32 w-36 place-items-center" aria-hidden="true">
        <div className="fluxora-loading-cubes">
          {[0, 1, 2, 3].map((cube) => (
            <div key={cube} className="fluxora-loading-cube">
              <div /><div /><div /><div />
            </div>
          ))}
        </div>
      </div>
      <div className="text-center"><p className="text-sm font-semibold text-foreground">Carregando Fluxora</p><p className="mt-1 text-xs text-muted-foreground">Validando sua sessão…</p></div>
    </div>
  </div>;
  if (!user) return <LoginScreen />;

  const visibleManagementItems = user.role === "admin" ? [...baseManagementItems, ...adminManagementItems] : baseManagementItems;
  const visibleItems = [...operationItems, ...visibleManagementItems];
  const currentPath = location.split("?")[0];
  const currentTitle = visibleItems.find((item) => item.path === currentPath)?.label ?? "Fluxora";
  const markNotificationsRead = async (executionIds = recentErrors.map((item: any) => String(item.id))) => {
    executionIds.forEach((id: string) => toast.dismiss(`${notifiedStorageKey}:${id}`));
    await utils.notifications.readState.cancel();
    const current = utils.notifications.readState.getData() ?? { configured: false, initialized: true, seenErrorExecutionIds: [] };
    const ids = [...new Set([...executionIds, ...current.seenErrorExecutionIds])].slice(0, 250);
    utils.notifications.readState.setData(undefined, { ...current, initialized: true, seenErrorExecutionIds: ids });
    markRead.mutate({ executionIds: ids });
  };
  const navigateFromCommand = (path: string) => {
    setCommandOpen(false);
    setLocation(path);
  };

  const navLink = ({ label, path, icon: Icon }: typeof allItems[number]) => (
    <Tooltip key={path} delayDuration={200}>
    <TooltipTrigger asChild>
    <Link href={path} aria-label={label} aria-current={currentPath === path ? "page" : undefined} className={`group/sidebar-item focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 mb-1 flex w-full items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm transition-colors ${currentPath === path ? "bg-primary text-white shadow-lg shadow-[#11183D]/25" : "text-code-foreground/80 hover:bg-white/10"}`}>
      <Icon className={`h-[17px] w-[17px] shrink-0 transition-[transform,color] duration-200 group-hover/sidebar-item:scale-110 group-focus-visible/sidebar-item:scale-110 motion-reduce:transform-none ${currentPath === path ? "scale-110 text-white" : "group-hover/sidebar-item:text-feedback-info group-focus-visible/sidebar-item:text-feedback-info"}`} />
      <span className="sidebar-label whitespace-nowrap" aria-hidden={collapsed}>{label}</span>
      {currentPath === path && <span className="sidebar-label ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-feedback-info" aria-hidden="true" />}
    </Link>
    </TooltipTrigger>
    {collapsed && <TooltipContent side="right" sideOffset={12}>{label}</TooltipContent>}
    </Tooltip>
  );

  return (
    <div className="fluxora-app min-h-screen bg-background text-foreground">
      <aside data-collapsed={collapsed} className={`fluxora-sidebar fixed inset-y-0 left-0 z-30 hidden flex-col overflow-visible bg-[var(--fluxora-mirtilo)] text-white lg:flex ${collapsed ? "w-[78px]" : "w-[252px]"}`}>
        <div className="relative flex h-[86px] shrink-0 items-center px-[23px]">
          <Link href="/" className="shrink-0" aria-label="Fluxora"><FluxoraMark light className="h-8 w-8" /></Link>
          <div className="sidebar-label ml-2.5 min-w-0 overflow-hidden whitespace-nowrap" aria-hidden={collapsed}><p className="text-[15px] font-semibold tracking-[-0.03em]">Fluxora</p><p className="text-[10px] font-medium text-code-foreground/70">Automation Control Center</p></div>
          <button
            onClick={() => setCollapsed((value) => !value)}
            type="button"
            aria-expanded={!collapsed}
            aria-controls="fluxora-sidebar-nav"
            className="absolute -right-4 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border-2 border-white/30 bg-[var(--fluxora-mirtilo)] text-white shadow-md hover:border-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            aria-label={collapsed ? "Expandir sidebar" : "Recolher sidebar"}
          ><ChevronLeft aria-hidden="true" className={`h-5 w-5 transition-transform duration-200 motion-reduce:transition-none ${collapsed ? "rotate-180" : ""}`} /></button>
        </div>

        <nav id="fluxora-sidebar-nav" className="flex-1 overflow-x-hidden overflow-y-auto px-3 pt-5">
          <p className="sidebar-label sidebar-section-title px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-code-foreground/60" aria-hidden={collapsed}>Operação</p>
          {operationItems.map(navLink)}
          <p className="sidebar-label sidebar-section-title sidebar-section-management px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-code-foreground/60" aria-hidden={collapsed}>Gestão</p>
          {visibleManagementItems.map(navLink)}
        </nav>

        <div className="border-t border-white/10 p-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex w-full items-center gap-3 overflow-hidden rounded-xl px-1 py-1 text-left transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60" aria-label="Abrir menu da conta">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold">{user.name?.slice(0, 1).toUpperCase() || "F"}</div>
                <div className="sidebar-label min-w-0 flex-1 whitespace-nowrap" aria-hidden={collapsed}><p className="truncate text-xs font-semibold">{user.name}</p><p className="truncate text-[11px] text-code-foreground/70">{user.role === "admin" ? "Administrador" : user.role === "operator" ? "Operador" : "Visualizador"}</p></div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align={collapsed ? "center" : "end"} className="w-56">
              <DropdownMenuLabel className="font-normal"><p className="truncate text-sm font-semibold">{user.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{user.email}</p></DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => logout()} className="text-destructive focus:text-destructive"><LogOut className="mr-2 h-4 w-4" />Sair</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main data-sidebar-collapsed={collapsed} className={`fluxora-main min-h-screen pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-0 ${collapsed ? "lg:ml-[78px]" : "lg:ml-[252px]"}`}>
        <header className="sticky top-0 z-20 flex h-[72px] lg:h-[86px] items-center justify-between border-b border-border bg-background/90 px-5 backdrop-blur-xl md:px-9">
          <div className="min-w-0 flex-1 pr-2"><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Fluxora</p><h1 className="mt-1 truncate text-base sm:text-xl font-semibold tracking-[-0.03em] text-foreground">{currentTitle}</h1></div>
          <div className="flex shrink-0 items-center gap-0 sm:gap-2">
            <Button type="button" variant="ghost" size="icon" onClick={() => setCommandOpen(true)} className="rounded-xl text-muted-foreground md:hidden" aria-label="Abrir busca global">
              <Search className="h-[18px] w-[18px]" />
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCommandOpen(true)}
              className="hidden h-10 min-w-[210px] justify-between rounded-xl bg-card text-muted-foreground md:flex"
            >
              <span className="flex items-center gap-2"><Search className="h-4 w-4" />Buscar no Fluxora</span>
              <kbd className="rounded-md border bg-background px-1.5 py-0.5 text-[10px]">Ctrl K</kbd>
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={toggleTheme} style={{ viewTransitionName: "theme-toggle" }} className="rounded-xl text-muted-foreground" aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}>
              <span aria-hidden="true" className={`theme-orb ${theme === "dark" ? "theme-orb-dark" : ""}`}>
                <span className="theme-orb-core" />
              </span>
            </Button>
            <Popover onOpenChange={(open) => { if (open) recentErrors.forEach((item: any) => toast.dismiss(`${notifiedStorageKey}:${item.id}`)); }}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="fluxora-notification relative rounded-full text-muted-foreground" aria-label={unread.length ? `Notificações: ${unread.length} não lidas` : "Notificações"}>
                  <Bell aria-hidden="true" className="fluxora-notification-bell h-[18px] w-[18px]" />
                  {unread.length > 0 && <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-feedback-error px-1 text-center text-[9px] font-bold leading-4 text-white">{Math.min(unread.length, 99)}</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(360px,calc(100vw-24px))] p-0">
                <div className="border-b px-4 py-3"><p className="text-sm font-semibold text-foreground">Notificações</p><p className="mt-1 text-xs text-muted-foreground">Falhas recentes detectadas pelo n8n.</p><Button variant="ghost" size="sm" className="fluxora-action mt-2" disabled={!unread.length || markRead.isPending} onClick={() => markNotificationsRead()}>{markRead.isPending ? "Salvando…" : "Marcar todas como lidas"}</Button></div>
                <div className="max-h-[360px] overflow-y-auto">
                  {recentErrors.length === 0 ? <div className="px-4 py-8 text-center text-xs text-muted-foreground">Nenhuma falha recente.</div> : recentErrors.map((item: any) => (
                    <Link key={item.id} onClick={() => markNotificationsRead([String(item.id)])} href={`/executions?execution=${encodeURIComponent(String(item.id))}`} className={`block border-b px-4 py-3 hover:bg-background ${seenErrorIds.includes(String(item.id)) ? "" : "bg-feedback-info-surface"}`}>
                      <div className="flex items-start gap-3"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${seenErrorIds.includes(String(item.id)) ? "bg-muted-foreground/40" : "bg-feedback-error"}`}/><div><span className="text-[10px] font-semibold text-muted-foreground">{seenErrorIds.includes(String(item.id)) ? "Lida" : "Não lida"}</span><p className="text-xs font-semibold text-foreground">{item.workflowName}</p><p className="mt-1 text-[11px] text-muted-foreground">Execução #{item.id} · {item.startedAt ? new Date(item.startedAt).toLocaleString("pt-BR") : "sem horário"}</p></div></div>
                    </Link>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="ml-1 grid h-11 w-11 place-items-center rounded-full bg-feedback-info-surface text-xs font-bold text-feedback-info focus:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden" aria-label="Abrir menu da conta">{user.name?.slice(0, 1).toUpperCase() || "F"}</button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 lg:hidden">
                <DropdownMenuLabel className="font-normal"><p className="truncate text-sm font-semibold">{user.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{user.email}</p></DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout()} className="text-destructive focus:text-destructive"><LogOut className="mr-2 h-4 w-4" />Sair</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {children}
      </main>
      <MobileNavigation items={visibleItems} currentPath={currentPath} />
      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen} title="Busca global" description="Encontre páginas, workflows e execuções.">
        <CommandInput placeholder="Buscar página, workflow ou execução..." />
        <CommandList className="max-h-[430px]">
          <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
          <CommandGroup heading="Páginas">
            {visibleItems.map(({ label, path, icon: Icon }) => (
              <CommandItem key={path} value={`pagina ${label}`} onSelect={() => navigateFromCommand(path)}>
                <Icon className="h-4 w-4" /><span>{label}</span>
                {path === "/workflows" ? <CommandShortcut>Catálogo</CommandShortcut> : null}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Workflows">
            {(workflows.data?.items ?? []).map((workflow: any) => (
              <CommandItem key={workflow.id} value={`workflow ${workflow.name} ${workflow.id}`} onSelect={() => navigateFromCommand(`/workflows/${workflow.id}`)}>
                <Workflow className="h-4 w-4" /><span className="truncate">{workflow.name}</span>
                <CommandShortcut>{workflow.active ? "Ativo" : "Inativo"}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Execuções recentes">
            {(executions.data?.items ?? []).slice(0, 30).map((execution: any) => (
              <CommandItem key={execution.id} value={`execucao ${execution.id} ${execution.workflowName || ""}`} onSelect={() => navigateFromCommand(`/executions?execution=${encodeURIComponent(String(execution.id))}`)}>
                <Activity className="h-4 w-4" /><span className="truncate">{execution.workflowName || "Workflow"}</span>
                <CommandShortcut>#{execution.id}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}

export function MobileNavigation({ items, currentPath }: { items: typeof allItems; currentPath: string }) {
  const positions = ["left-0 top-36", "left-[14.6%] top-12", "left-1/2 top-2", "left-[85.4%] top-12"];
  return createPortal(
    <div className="lg:hidden" style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(16px + env(safe-area-inset-bottom))", zIndex: 40 }}>
      <Popover modal>
        <PopoverTrigger asChild>
          <Button aria-label="Abrir navegação" className="group h-[60px] w-[60px] rounded-full p-0 shadow-lg shadow-black/20">
            <Plus aria-hidden="true" className="size-7 transition-transform duration-300 group-data-[state=open]:rotate-45 motion-reduce:transition-none" />
          </Button>
        </PopoverTrigger>
        <PopoverContent aria-label="Navegação do Fluxora" side="top" align="center" sideOffset={12} className="fluxora-radial-panel w-[min(352px,calc(100vw-24px))] border-0 bg-transparent px-10 py-0 shadow-none lg:hidden">
          <nav aria-label="Áreas principais" className="relative h-56">
            {items.slice(0, 4).map(({ label, path, icon: Icon }, index) => <PopoverClose key={path} asChild>
              <Link href={path} aria-current={currentPath === path || (path === "/workflows" && currentPath.startsWith("/workflows/")) ? "page" : undefined} className={"fluxora-radial-action absolute flex w-20 -translate-x-1/2 flex-col items-center gap-1 text-center text-xs font-semibold text-foreground " + positions[index]} style={{ animationDelay: index * 40 + "ms" }}>
                <span className="grid h-12 w-12 place-items-center rounded-full border bg-card text-feedback-info shadow-lg"><Icon aria-hidden="true" className="h-5 w-5" /></span>
                <span className="rounded-lg bg-card px-2 py-1 shadow-sm">{path === "/" ? "Início" : label}</span>
              </Link>
            </PopoverClose>)}
            {items.length > 4 && <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" aria-label="Mais áreas" className="fluxora-radial-action absolute left-full top-36 flex w-20 -translate-x-1/2 flex-col items-center gap-1 text-center text-xs font-semibold text-foreground" style={{ animationDelay: "160ms" }}><span className="grid h-12 w-12 place-items-center rounded-full border bg-card text-feedback-info shadow-lg"><MoreHorizontal aria-hidden="true" className="h-5 w-5" /></span><span className="rounded-lg bg-card px-2 py-1 shadow-sm">Mais</span></button></DropdownMenuTrigger>
              <DropdownMenuContent aria-label="Outras áreas" side="top" align="end" sideOffset={12} className="w-[min(280px,calc(100vw-32px))] max-h-[60dvh] rounded-2xl p-2 lg:hidden">
                {items.slice(4).map(({ label, path, icon: Icon }) => <DropdownMenuItem key={path} asChild className="min-h-12 rounded-xl px-3 text-sm"><PopoverClose asChild><Link href={path} aria-current={currentPath === path ? "page" : undefined}><Icon aria-hidden="true" className="h-5 w-5" />{label}</Link></PopoverClose></DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>}
          </nav>
        </PopoverContent>
      </Popover>
    </div>, document.body
  );
}
