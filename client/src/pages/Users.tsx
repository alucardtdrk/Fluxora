import { useMemo, useState } from "react";
import { ShieldCheck, UserPlus, Users as UsersIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import OperationsShell from "@/components/OperationsShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

type Role = "admin" | "operator" | "viewer";
const roleLabel: Record<Role, string> = { admin: "Administrador", operator: "Operador", viewer: "Visualizador" };

export default function Users() {
  const { user: currentUser } = useAuth();
  const utils = trpc.useUtils();
  const users = trpc.admin.users.useQuery(undefined, { retry: false });
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [search, setSearch] = useState("");

  const save = trpc.admin.saveUser.useMutation({
    onSuccess: async () => { toast.success("Acesso atualizado"); setEmail(""); setName(""); setRole("viewer"); await utils.admin.users.invalidate(); },
    onError: (error) => toast.error("Não foi possível salvar", { description: error.message }),
  });
  const setActive = trpc.admin.setUserActive.useMutation({
    onSuccess: async () => { toast.success("Status de acesso atualizado"); await utils.admin.users.invalidate(); },
    onError: (error) => toast.error("Não foi possível alterar o acesso", { description: error.message }),
  });
  const remove = trpc.admin.deleteUser.useMutation({
    onSuccess: async () => { toast.success("Usuário removido"); await utils.admin.users.invalidate(); },
    onError: (error) => toast.error("Não foi possível remover", { description: error.message }),
  });

  const filtered = useMemo(() => (users.data ?? []).filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(search.toLowerCase())), [users.data, search]);

  return <OperationsShell><div className="mx-auto max-w-[1180px] px-5 py-8 md:px-9">
    <p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#667085]">Gestão / Acessos</p>
    <div className="mt-2 flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-4xl font-semibold tracking-[-.05em]">Usuários e permissões</h2><p className="mt-2 text-sm text-[#667085]">Defina quem pode acessar o Fluxora e qual nível de permissão cada pessoa possui.</p></div><div className="rounded-full bg-[#E8ECFF] px-3 py-1.5 text-xs font-semibold text-[#4355D8]">{users.data?.filter((item) => item.active).length ?? 0} acessos ativos</div></div>

    <div className="mt-7 grid gap-6 lg:grid-cols-[360px_1fr]">
      <Card className="border-0"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><UserPlus className="h-4 w-4"/>Adicionar acesso</CardTitle></CardHeader><CardContent className="space-y-4">
        <div><Label>Nome</Label><Input className="mt-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do colaborador"/></div>
        <div><Label>E-mail corporativo</Label><Input className="mt-2" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@saipos.com" type="email"/></div>
        <div><Label>Perfil</Label><Select value={role} onValueChange={(value) => setRole(value as Role)}><SelectTrigger className="mt-2"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="viewer">Visualizador</SelectItem><SelectItem value="operator">Operador</SelectItem><SelectItem value="admin">Administrador</SelectItem></SelectContent></Select></div>
        <Button className="w-full bg-[#4355D8] hover:bg-[#3546C7]" disabled={!email || save.isPending} onClick={() => save.mutate({ email, name: name || undefined, role, active: true })}>Liberar acesso</Button>
        <div className="rounded-xl bg-[#F5F7FB] p-4 text-xs leading-5 text-[#667085]"><b className="text-[#11183D]">Perfis:</b><br/>Visualizador: somente leitura.<br/>Operador: leitura e ações operacionais de workflows.<br/>Administrador: acesso completo, configurações e usuários.</div>
      </CardContent></Card>

      <Card className="border-0"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="flex items-center gap-2 text-base"><UsersIcon className="h-4 w-4"/>Pessoas autorizadas</CardTitle><Input className="max-w-[280px]" placeholder="Buscar por nome ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)}/></div></CardHeader><CardContent className="p-0">
        <div className="divide-y divide-[#EAECF0]">{filtered.map((item) => {
          const isSelf = currentUser?.email === item.email;
          return <div key={item.email} className="grid gap-4 px-6 py-4 md:grid-cols-[1.5fr_170px_110px_42px] md:items-center">
            <div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-[#11183D]">{item.name}</p>{item.role === "admin" && <ShieldCheck className="h-4 w-4 text-[#19D3C5]"/>}</div><p className="truncate text-xs text-[#667085]">{item.email}</p><p className="mt-1 text-[11px] text-[#98A2B3]">Último acesso: {item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleString("pt-BR") : "ainda não acessou"}</p></div>
            <Select value={item.role} disabled={isSelf && item.role === "admin"} onValueChange={(value) => save.mutate({ email: item.email, name: item.name, role: value as Role, active: item.active })}><SelectTrigger><SelectValue>{roleLabel[item.role as Role]}</SelectValue></SelectTrigger><SelectContent><SelectItem value="viewer">Visualizador</SelectItem><SelectItem value="operator">Operador</SelectItem><SelectItem value="admin">Administrador</SelectItem></SelectContent></Select>
            <div className="flex items-center gap-2"><Switch checked={item.active} disabled={isSelf} onCheckedChange={(active) => setActive.mutate({ email: item.email, active })}/><span className="text-xs text-[#667085]">{item.active ? "Ativo" : "Bloqueado"}</span></div>
            <Button variant="ghost" size="icon" disabled={isSelf} onClick={() => { if (confirm(`Remover o acesso de ${item.email}?`)) remove.mutate({ email: item.email }); }}><Trash2 className="h-4 w-4 text-[#98A2B3]"/></Button>
          </div>;
        })}{!users.isLoading && filtered.length === 0 && <div className="px-6 py-12 text-center text-sm text-[#98A2B3]">Nenhum usuário encontrado.</div>}</div>
      </CardContent></Card>
    </div>
  </div></OperationsShell>;
}
