import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft, Filter, RefreshCw, Search, Workflow } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import OperationsShell from "@/components/OperationsShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

export default function Workflows() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const workflows = trpc.n8n.workflows.useQuery(undefined, { enabled: Boolean(user), retry: false });
  const n8nError = workflows.data?.status === "unauthorized" || workflows.data?.status === "api_error";
  const notConfigured = workflows.data?.status === "not_configured";
  const isAdmin = user?.role === "admin";
  const items = useMemo(() => (workflows.data?.items ?? [])
    .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
    .filter((item) => filter === "all" || (filter === "active" ? item.active : !item.active)), [filter, query, workflows.data]);

  const refresh = async () => {
    const result = await workflows.refetch();
    if (result.error || result.data?.status === "unauthorized" || result.data?.status === "api_error") {
      toast.error("Não foi possível carregar os workflows", { description: isAdmin ? "Revise a conexão e as credenciais do n8n." : "Tente novamente ou avise um administrador." });
    } else if (result.data?.status === "not_configured") {
      toast.warning("n8n ainda não conectado", { description: isAdmin ? "Configure o acesso ao n8n no ambiente do servidor." : "Peça a um administrador para concluir a configuração." });
    } else {
      toast.success("Workflows atualizados");
    }
  };

  const requestSupport = async () => {
    const message = "Não foi possível carregar o catálogo de workflows do Fluxora. Por favor, verifique a conexão com o n8n.";
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Pedido de suporte copiado", { description: "Envie a mensagem ao administrador do Fluxora." });
    } catch {
      toast.info("Fale com um administrador", { description: message });
    }
  };

  const issueTitle = notConfigured ? "n8n ainda não conectado" : "Não foi possível consultar os workflows";
  const issueDescription = isAdmin
    ? (notConfigured ? "Configure N8N_BASE_URL e N8N_API_KEY no ambiente do servidor." : "A autenticação ou a API do n8n não respondeu. Revise as credenciais e a conexão.")
    : "Você não precisa alterar configurações técnicas. Tente novamente ou envie um pedido de suporte ao administrador.";

  return <OperationsShell><div className="min-h-[calc(100vh-86px)] bg-[#F5F7FB] px-5 py-7 md:px-9 md:py-9"><div className="mx-auto max-w-[1300px]">
    <Link href="/" className="mb-6 inline-flex items-center gap-2 text-xs font-semibold text-[#667085] hover:text-[#4355D8]"><ArrowLeft className="h-3.5 w-3.5" />Voltar para visão geral</Link>
    <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#667085]">Operação / Workflows</p><h2 className="mt-3 text-4xl font-semibold tracking-[-0.06em]">Workflows</h2><p className="mt-2 text-sm text-[#667085]">Consulte o catálogo de automações diretamente do n8n.</p></div><Button onClick={refresh} className="rounded-xl bg-[#4355D8] text-white hover:bg-[#4355D8]"><RefreshCw className={`mr-2 h-4 w-4 ${workflows.isFetching ? "animate-spin" : ""}`} />Atualizar lista</Button></div>
    {(workflows.isError || n8nError || notConfigured) ? <div className="mb-5 flex flex-col gap-4 rounded-2xl border border-[#f3d5bf] bg-[#fff8f2] p-4 text-sm text-[#89542c] sm:flex-row sm:items-center"><AlertTriangle className="h-5 w-5 shrink-0" /><div className="flex-1"><p className="font-semibold">{issueTitle}</p><p className="mt-1 text-xs leading-5">{issueDescription}</p></div>{isAdmin ? <Button variant="outline" size="sm" onClick={refresh}>Tentar novamente</Button> : <Button variant="outline" size="sm" onClick={requestSupport}>Copiar pedido de suporte</Button>}</div> : null}
    <Card className="border-0 bg-white shadow-[0_10px_30px_rgba(41,54,115,0.06)]">
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><CardTitle className="text-base">Catálogo de automações</CardTitle><div className="flex flex-wrap gap-2"><div className="relative"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#a4abc2]" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar workflow" className="h-9 w-[220px] rounded-lg pl-9 text-xs" /></div>{(["all", "active", "inactive"] as const).map((item) => <Button key={item} onClick={() => setFilter(item)} variant="outline" size="sm" className={`h-9 rounded-lg text-xs ${filter === item ? "border-[#4355D8] bg-[#EEF1FF] text-[#4355D8]" : "border-[#e7e9f1] text-[#667085]"}`}><Filter className="mr-2 h-3.5 w-3.5" />{item === "all" ? "Todos" : item === "active" ? "Ativos" : "Inativos"}</Button>)}</div></CardHeader>
      <CardContent className="p-0">
        {workflows.isLoading ? <div className="space-y-3 border-t p-6">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-xl bg-[#eef0f6] dark:bg-white/10" />)}</div> : workflows.isError || n8nError || notConfigured ? null : items.length === 0 ? <div className="flex flex-col items-center justify-center border-t border-[#f1f2f7] px-6 py-16 text-center"><Workflow className="h-8 w-8 text-[#c5cbe0]" /><p className="mt-3 text-sm font-semibold text-[#667085]">Nenhum workflow encontrado</p><p className="mt-1 max-w-sm text-xs leading-5 text-[#98A2B3]">Tente ajustar sua busca ou os filtros.</p></div> : <div className="divide-y divide-[#f1f2f7]">{items.map((item) => <div key={item.id} className="grid gap-4 px-6 py-5 md:grid-cols-[1.5fr_0.5fr_0.8fr_0.4fr] md:items-center"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-[#EEF1FF] text-[#4355D8]"><Workflow className="h-4 w-4" /></div><div><p className="text-sm font-semibold">{item.name}</p><p className="mt-1 text-xs text-[#98A2B3]">ID {item.id}</p></div></div><Badge className={item.active ? "w-fit bg-[#def8f7] text-[#19D3C5] hover:bg-[#def8f7]" : "w-fit bg-[#f1f2f6] text-[#667085] hover:bg-[#f1f2f6]"}>{item.active ? "Ativo" : "Inativo"}</Badge><div className="text-xs text-[#667085]">{item.tags.length ? item.tags.join(" · ") : "Sem tags"}</div><Link href={`/workflows/${item.id}`} className="inline-flex h-9 w-fit items-center rounded-lg px-3 text-xs font-semibold text-[#4355D8] hover:bg-[#EEF1FF]">Abrir</Link></div>)}</div>}
      </CardContent>
    </Card>
  </div></div></OperationsShell>;
}
