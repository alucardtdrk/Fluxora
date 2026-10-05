import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, LockKeyhole, Plus, RefreshCw, Save, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type EditorField = {
  path: string;
  label: string;
  group?: string;
  kind: "text" | "textarea" | "number" | "boolean" | "select";
  value: string | number | boolean;
  options?: string[];
};
type Addition = { path: string; kind: "condition" | "header"; value: Record<string, unknown> };
type SavePayload = { nodeName: string; changes?: Array<{ path: string; value: unknown }>; additions?: Addition[]; parameters?: Record<string, unknown>; summary?: string };
type WorkflowNodePanelProps = { node: any | null; canEdit: boolean; canUseAdvanced: boolean; onSave: (payload: SavePayload) => Promise<void> };

const prettyJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2);
const cloneValue = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? {})) as T;
const pathSegments = (path: string) => Array.from(path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)).map((match) => match[1] ?? match[2]);
const getPathValue = (target: any, path: string) => pathSegments(path).reduce((value, segment) => value?.[segment], target);

function setPathValue(target: any, path: string, value: unknown) {
  const segments = pathSegments(path);
  let cursor = target;
  segments.slice(0, -1).forEach((segment) => { cursor = cursor[segment]; });
  cursor[segments[segments.length - 1]] = value;
}

function normalizedValue(field: EditorField, value: unknown) {
  if (field.kind === "boolean") return Boolean(value);
  if (field.kind === "number") return Number(value);
  return String(value ?? "");
}

function isIfField(field: EditorField) {
  return field.path.endsWith("conditions[0].leftValue") || field.path.endsWith("operator.type") || field.path.endsWith("operator.operation");
}

function labelFor(field: EditorField, simpleIf: boolean) {
  if (!simpleIf) return field.label;
  if (field.path.endsWith("conditions[0].leftValue")) return "Valor a verificar";
  if (field.path.endsWith("operator.type")) return "Tipo de dado";
  if (field.path.endsWith("operator.operation")) return "Resultado esperado";
  if (field.path.endsWith("conditions[0].rightValue")) return "Comparar com";
  return field.label;
}

function optionLabel(field: EditorField, option: string) {
  if (field.path.endsWith("operator.operation")) {
    return ({ true: "É verdadeiro", false: "É falso", equals: "É igual a", notEquals: "É diferente de", contains: "Contém", notContains: "Não contém", startsWith: "Começa com", endsWith: "Termina com", greaterThan: "É maior que", greaterThanOrEqual: "É maior ou igual a", lessThan: "É menor que", lessThanOrEqual: "É menor ou igual a", isEmpty: "Está vazio", isNotEmpty: "Não está vazio", exists: "Existe", notExists: "Não existe" } as Record<string, string>)[option] || option;
  }
  if (field.path.endsWith("operator.type")) return ({ boolean: "Booleano", string: "Texto", number: "Número", dateTime: "Data e hora", array: "Lista", object: "Objeto" } as Record<string, string>)[option] || option;
  return option;
}

function operationsForConditionType(type: string) {
  if (type === "boolean") return ["true", "false", "equals", "notEquals", "exists", "notExists"];
  if (type === "string") return ["equals", "notEquals", "contains", "notContains", "startsWith", "endsWith", "isEmpty", "isNotEmpty", "exists", "notExists"];
  if (type === "number" || type === "dateTime") return ["equals", "notEquals", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual", "exists", "notExists"];
  return ["exists", "notExists", "isEmpty", "isNotEmpty", "equals", "notEquals"];
}

function operationNeedsComparisonValue(operation: string) {
  return !["true", "false", "isEmpty", "isNotEmpty", "exists", "notExists"].includes(operation);
}

function isCodeField(field: EditorField) {
  return /(?:^|\.)(?:jsCode|code|script|javascript)$/i.test(field.path);
}

const headerCollectionPaths = ["headerParameters.parameters", "headers.parameters", "headers"];
const defaultCondition = () => ({ id: crypto.randomUUID(), leftValue: "", rightValue: "", type: "boolean", operation: "true" });
const defaultHeader = () => ({ id: crypto.randomUUID(), name: "", value: "" });

function FieldControl({ field, value, canEdit, simpleIf, options, onChange }: { field: EditorField; value: unknown; canEdit: boolean; simpleIf: boolean; options?: string[]; onChange: (value: unknown) => void }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold text-foreground">{labelFor(field, simpleIf)}</span>
      {field.kind === "boolean" ? (
        <button type="button" role="switch" aria-checked={Boolean(value)} disabled={!canEdit} onClick={() => onChange(!Boolean(value))} className={`flex h-10 w-full items-center justify-between rounded-xl border px-3 text-sm ${Boolean(value) ? "border-feedback-info bg-feedback-info-surface text-feedback-info" : "border-border bg-card text-muted-foreground"}`}>
          <span>{Boolean(value) ? "Ativado" : "Desativado"}</span><span className={`h-5 w-9 rounded-full p-0.5 transition ${Boolean(value) ? "bg-primary" : "bg-muted-foreground"}`}><span className={`block h-4 w-4 rounded-full bg-white transition ${Boolean(value) ? "translate-x-4" : ""}`} /></span>
        </button>
      ) : null}
      {field.kind === "select" ? <Select value={String(value ?? "")} disabled={!canEdit} onValueChange={onChange}><SelectTrigger className="h-10"><SelectValue placeholder="Selecione uma opção" /></SelectTrigger><SelectContent>{(options || field.options)?.map((option) => <SelectItem key={option} value={option}>{optionLabel(field, option)}</SelectItem>)}</SelectContent></Select> : null}
      {field.kind === "textarea" ? <Textarea value={String(value ?? "")} disabled={!canEdit} onChange={(event) => onChange(event.target.value)} className={isCodeField(field) ? "h-[360px] min-h-[360px] max-h-[360px] resize-y overflow-y-auto font-mono text-xs leading-5" : "min-h-[110px] resize-y text-sm"} /> : null}
      {field.kind === "text" || field.kind === "number" ? <Input type={field.kind === "number" ? "number" : "text"} value={String(value ?? "")} disabled={!canEdit} onChange={(event) => onChange(field.kind === "number" ? Number(event.target.value) : event.target.value)} className="h-10 text-sm" /> : null}
    </label>
  );
}

export default function WorkflowNodePanel({ node, canEdit, canUseAdvanced, onSave }: WorkflowNodePanelProps) {
  const [draftParameters, setDraftParameters] = useState<Record<string, unknown>>({});
  const [advancedDraft, setAdvancedDraft] = useState("{}");
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showIfOptions, setShowIfOptions] = useState(false);
  const [pendingConditions, setPendingConditions] = useState<Array<ReturnType<typeof defaultCondition>>>([]);
  const [pendingHeaders, setPendingHeaders] = useState<Array<ReturnType<typeof defaultHeader>>>([]);

  useEffect(() => {
    const editable = cloneValue<Record<string, unknown>>(node?.editableParameters || {});
    setDraftParameters(editable);
    setAdvancedDraft(prettyJson(editable));
    setSummary("");
    setShowTechnical(false);
    setShowAdvanced(false);
    setShowIfOptions(false);
    setPendingConditions([]);
    setPendingHeaders([]);
  }, [node?.name]);

  const blocked = useMemo(() => Array.isArray(node?.blockedFields) ? node.blockedFields : [], [node]);
  const fields = useMemo(() => (Array.isArray(node?.editorFields) ? node.editorFields : []) as EditorField[], [node]);
  const isIfNode = /(?:^|\.)if$/i.test(String(node?.type || ""));
  const conditionTypeField = useMemo(() => fields.find((field) => field.path.endsWith("operator.type")), [fields]);
  const conditionOperationField = useMemo(() => fields.find((field) => field.path.endsWith("operator.operation")), [fields]);
  const conditionRightValueField = useMemo(() => fields.find((field) => field.path.endsWith("conditions[0].rightValue")), [fields]);
  const conditionType = String(conditionTypeField ? getPathValue(draftParameters, conditionTypeField.path) || "boolean" : "boolean");
  const conditionOperation = String(conditionOperationField ? getPathValue(draftParameters, conditionOperationField.path) || "" : "");
  const conditionCollectionPath = Array.isArray(getPathValue(draftParameters, "conditions.conditions")) ? "conditions.conditions" : null;
  const headerCollectionPath = headerCollectionPaths.find((path) => Array.isArray(getPathValue(draftParameters, path))) || null;
  const primaryIfFields = useMemo(() => fields.filter((field) => isIfField(field) || (field === conditionRightValueField && operationNeedsComparisonValue(conditionOperation))), [fields, conditionRightValueField, conditionOperation]);
  const visibleFields = isIfNode && primaryIfFields.length ? primaryIfFields : fields;
  const ifOptionFields = isIfNode && primaryIfFields.length ? fields.filter((field) => !primaryIfFields.includes(field)) : [];
  const fieldsByGroup = useMemo(() => visibleFields.reduce<Record<string, EditorField[]>>((groups, field) => {
    const group = field.group || "Configuração";
    (groups[group] ||= []).push(field);
    return groups;
  }, {}), [visibleFields]);
  const changedFields = useMemo(() => fields.filter((field) => !Object.is(normalizedValue(field, getPathValue(draftParameters, field.path)), field.value)), [draftParameters, fields]);
  const additions = useMemo<Addition[]>(() => [
    ...(conditionCollectionPath ? pendingConditions.map(({ id, leftValue, rightValue, type, operation }) => ({ path: conditionCollectionPath, kind: "condition" as const, value: { leftValue, rightValue, operator: { type, operation } } })) : []),
    ...(headerCollectionPath ? pendingHeaders.map(({ id, name, value }) => ({ path: headerCollectionPath, kind: "header" as const, value: { name, value } })) : []),
  ], [conditionCollectionPath, headerCollectionPath, pendingConditions, pendingHeaders]);
  const pendingChangeCount = changedFields.length + additions.length;

  if (!node) return <Card className="border-0 bg-card shadow-sm"><CardContent className="p-6 text-sm text-muted-foreground">Selecione um node no diagrama para ver os detalhes e os campos permitidos.</CardContent></Card>;

  const updateField = (field: EditorField, value: unknown) => {
    const next = cloneValue(draftParameters);
    setPathValue(next, field.path, value);
    setDraftParameters(next);
  };
  const saveForm = async () => {
    if (!pendingChangeCount) return toast.message("Nenhuma alteração para salvar.");
    try {
      setSaving(true);
      await onSave({ nodeName: node.name, changes: changedFields.map((field) => ({ path: field.path, value: getPathValue(draftParameters, field.path) })), additions: additions.length ? additions : undefined, summary: summary.trim() || undefined });
    } finally { setSaving(false); }
  };
  const saveAdvanced = async () => {
    try {
      setSaving(true);
      const parsed = JSON.parse(advancedDraft);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Use um objeto JSON válido para os parâmetros.");
      await onSave({ nodeName: node.name, parameters: parsed as Record<string, unknown>, summary: summary.trim() || undefined });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível interpretar o JSON informado.");
    } finally { setSaving(false); }
  };

  return <div className="sticky top-5 space-y-4">
    <Card className="border-0 bg-card shadow-sm">
      <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">{node.name}</CardTitle><p className="text-xs text-muted-foreground">{node.type}</p></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-background p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Posição</p><p className="mt-2 text-sm font-semibold text-foreground">X {node.position?.[0] ?? 0} / Y {node.position?.[1] ?? 0}</p></div><div className="rounded-2xl bg-background p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Conexões</p><p className="mt-2 text-sm font-semibold text-foreground">{node.incoming?.length ?? 0} entrada(s) e {node.outgoing?.length ?? 0} saída(s)</p></div></div>
        <div className="rounded-2xl border border-border p-4"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Entradas</p><div className="mt-2 flex flex-wrap gap-2">{(node.incoming?.length ? node.incoming : ["Nenhuma"]).map((item: string) => <Badge key={item} className="bg-feedback-info-surface text-feedback-info">{item}</Badge>)}</div><p className="mt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Saídas</p><div className="mt-2 flex flex-wrap gap-2">{(node.outgoing?.length ? node.outgoing : ["Nenhuma"]).map((item: string) => <Badge key={item} className="bg-feedback-success-surface text-feedback-success">{item}</Badge>)}</div></div>
        <div className="rounded-2xl border border-border p-3"><Button variant="ghost" className="w-full justify-between px-1" onClick={() => setShowTechnical((value) => !value)}><span className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-feedback-info" />Detalhes técnicos</span><ChevronDown className={`h-4 w-4 transition ${showTechnical ? "rotate-180" : ""}`} /></Button>{showTechnical ? <ScrollArea className="mt-3 h-[220px] rounded-xl bg-code-background"><pre className="whitespace-pre-wrap break-words p-4 text-[11px] leading-5 text-code-foreground">{prettyJson(node.parameters)}</pre></ScrollArea> : null}</div>
      </CardContent>
    </Card>

    <Card className="border-0 bg-card shadow-sm">
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base text-foreground"><Settings2 className="h-4 w-4 text-feedback-info" />Edição controlada</CardTitle><p className="text-xs text-muted-foreground">Altere somente os campos operacionais liberados para este node.</p></CardHeader>
      <CardContent className="space-y-4">
        {node.editBlocked ? <div className="rounded-2xl border border-feedback-error-border bg-feedback-error-surface p-4 text-sm text-feedback-error"><div className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-4 w-4" />Edição bloqueada</div><p className="mt-2 text-xs leading-5">{node.editBlockedReason}</p></div> : null}
        {blocked.length > 0 ? <div className="rounded-2xl border border-border bg-muted p-4"><div className="flex items-center gap-2 text-sm font-semibold text-foreground"><AlertTriangle className="h-4 w-4 text-feedback-error" />Campos protegidos</div><p className="mt-2 text-xs leading-5 text-muted-foreground">{blocked.join(", ")}</p></div> : null}
        {!node.editBlocked && fields.length ? <div className="space-y-5">
          {isIfNode && primaryIfFields.length ? <div className="rounded-2xl border border-border bg-feedback-info-surface p-3 text-xs leading-5 text-feedback-info">Defina o valor que será verificado e o resultado esperado. O fluxo seguirá pela saída correspondente.</div> : <div className="rounded-2xl border border-border bg-feedback-info-surface p-3 text-xs text-feedback-info">Campos com opções prontas podem ser selecionados, como no n8n.</div>}
          {Object.entries(fieldsByGroup).map(([group, groupFields]) => <section key={group} className="space-y-4 rounded-2xl border border-border p-4"><div className="border-b border-border pb-3"><p className="text-sm font-semibold text-foreground">{isIfNode ? "Condição" : group}</p><p className="mt-1 text-xs text-muted-foreground">{isIfNode ? "Regra principal deste IF" : "Configurações deste bloco"}</p></div>{groupFields.map((field) => <FieldControl key={field.path} field={field} value={getPathValue(draftParameters, field.path)} canEdit={canEdit} simpleIf={isIfNode} options={field === conditionOperationField ? operationsForConditionType(conditionType) : undefined} onChange={(value) => updateField(field, value)} />)}</section>)}
          {ifOptionFields.length ? <div className="border-t border-border pt-2"><Button variant="ghost" className="w-full justify-between px-1" onClick={() => setShowIfOptions((value) => !value)}><span className="text-xs font-semibold text-muted-foreground">Opções avançadas da condição</span><ChevronDown className={`h-4 w-4 transition ${showIfOptions ? "rotate-180" : ""}`} /></Button>{showIfOptions ? <div className="mt-3 space-y-4 rounded-2xl border border-border p-4">{ifOptionFields.map((field) => <FieldControl key={field.path} field={field} value={getPathValue(draftParameters, field.path)} canEdit={canEdit} simpleIf={false} onChange={(value) => updateField(field, value)} />)}</div> : null}</div> : null}
          {isIfNode && conditionCollectionPath ? <section className="space-y-3 border-t border-border pt-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-foreground">Outras condições</p><p className="mt-1 text-xs text-muted-foreground">Adicione regras extras para esta decisão.</p></div><Button type="button" variant="outline" size="sm" disabled={!canEdit} onClick={() => setPendingConditions((items) => [...items, defaultCondition()])}><Plus className="mr-1.5 h-4 w-4" />Adicionar condição</Button></div>{pendingConditions.map((condition, index) => <div key={condition.id} className="space-y-3 rounded-2xl border border-border p-4"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-foreground">Condição adicional {index + 1}</p><Button type="button" variant="ghost" size="icon" disabled={!canEdit} aria-label="Remover condição" onClick={() => setPendingConditions((items) => items.filter((item) => item.id !== condition.id))}><Trash2 className="h-4 w-4 text-feedback-error" /></Button></div><label className="block"><span className="mb-2 block text-xs font-semibold text-foreground">Valor a verificar</span><Input value={condition.leftValue} disabled={!canEdit} onChange={(event) => setPendingConditions((items) => items.map((item) => item.id === condition.id ? { ...item, leftValue: event.target.value } : item))} /></label><div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-2 block text-xs font-semibold text-foreground">Tipo de dado</span><Select value={condition.type} disabled={!canEdit} onValueChange={(type) => setPendingConditions((items) => items.map((item) => item.id === condition.id ? { ...item, type, operation: operationsForConditionType(type)[0] } : item))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["boolean", "string", "number", "dateTime", "array", "object"].map((type) => <SelectItem key={type} value={type}>{optionLabel({ path: "operator.type" } as EditorField, type)}</SelectItem>)}</SelectContent></Select></label><label className="block"><span className="mb-2 block text-xs font-semibold text-foreground">Resultado esperado</span><Select value={condition.operation} disabled={!canEdit} onValueChange={(operation) => setPendingConditions((items) => items.map((item) => item.id === condition.id ? { ...item, operation } : item))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{operationsForConditionType(condition.type).map((operation) => <SelectItem key={operation} value={operation}>{optionLabel({ path: "operator.operation" } as EditorField, operation)}</SelectItem>)}</SelectContent></Select></label></div>{operationNeedsComparisonValue(condition.operation) ? <label className="block"><span className="mb-2 block text-xs font-semibold text-foreground">Comparar com</span><Input value={condition.rightValue} disabled={!canEdit} onChange={(event) => setPendingConditions((items) => items.map((item) => item.id === condition.id ? { ...item, rightValue: event.target.value } : item))} /></label> : null}</div>)}</section> : null}
          {!isIfNode && headerCollectionPath ? <section className="space-y-3 border-t border-border pt-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-foreground">Cabeçalhos adicionais</p><p className="mt-1 text-xs text-muted-foreground">Inclua cabeçalhos não sensíveis para a requisição.</p></div><Button type="button" variant="outline" size="sm" disabled={!canEdit} onClick={() => setPendingHeaders((items) => [...items, defaultHeader()])}><Plus className="mr-1.5 h-4 w-4" />Adicionar cabeçalho</Button></div>{pendingHeaders.map((header, index) => <div key={header.id} className="grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-[1fr_1fr_auto]"><label className="block"><span className="mb-2 block text-xs font-semibold text-foreground">Nome</span><Input value={header.name} disabled={!canEdit} placeholder="Ex.: Accept" onChange={(event) => setPendingHeaders((items) => items.map((item) => item.id === header.id ? { ...item, name: event.target.value } : item))} /></label><label className="block"><span className="mb-2 block text-xs font-semibold text-foreground">Valor</span><Input value={header.value} disabled={!canEdit} placeholder="Ex.: application/json" onChange={(event) => setPendingHeaders((items) => items.map((item) => item.id === header.id ? { ...item, value: event.target.value } : item))} /></label><Button type="button" variant="ghost" size="icon" className="self-end" disabled={!canEdit} aria-label={`Remover cabeçalho ${index + 1}`} onClick={() => setPendingHeaders((items) => items.filter((item) => item.id !== header.id))}><Trash2 className="h-4 w-4 text-feedback-error" /></Button></div>)}</section> : null}
        </div> : null}
        {!node.editBlocked && !fields.length ? <div className="rounded-2xl border border-border bg-muted p-4 text-xs text-muted-foreground">Este node não possui campos simples liberados. Use o n8n para configurações estruturais ou avançadas.</div> : null}
        {pendingChangeCount ? <div className="rounded-2xl border border-border bg-feedback-info-surface p-4"><p className="text-xs font-semibold text-feedback-info">{pendingChangeCount} alteração(ões) pronta(s) para salvar</p><div className="mt-2 space-y-1 text-xs text-feedback-info">{changedFields.slice(0, 5).map((field) => <p key={field.path}>{labelFor(field, isIfNode)}: <span className="line-through">{String(field.value)}</span> para <strong>{String(getPathValue(draftParameters, field.path))}</strong></p>)}{pendingConditions.length ? <p>{pendingConditions.length} condição(ões) adicional(is) será(ão) criada(s).</p> : null}{pendingHeaders.length ? <p>{pendingHeaders.length} cabeçalho(s) adicional(is) será(ão) criado(s).</p> : null}</div></div> : null}
        <div><p className="mb-2 text-xs font-semibold text-foreground">Resumo da alteração</p><Textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Ex.: ajustar webhook, timeout ou regra operacional" className="min-h-[84px] text-sm" disabled={!canEdit || node.editBlocked} /></div>
        {!canEdit ? <div className="rounded-2xl border border-border bg-muted p-4 text-xs text-muted-foreground">Seu perfil tem acesso de leitura. Apenas operador e administrador podem salvar campos permitidos.</div> : null}
        <div className="flex flex-wrap gap-2"><Button onClick={saveForm} aria-busy={saving} disabled={!canEdit || node.editBlocked || saving || !pendingChangeCount} className="bg-primary text-primary-foreground">{saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{saving ? "Salvando…" : "Salvar alterações"}</Button><Button variant="outline" onClick={() => { setDraftParameters(cloneValue(node.editableParameters || {})); setPendingConditions([]); setPendingHeaders([]); }} disabled={saving}><ArrowRight className="mr-2 h-4 w-4" />Descartar rascunho</Button></div>
        {canUseAdvanced && !node.editBlocked ? <div className="border-t border-border pt-4"><Button variant="ghost" className="w-full justify-between px-1" onClick={() => setShowAdvanced((value) => !value)}><span className="text-xs font-semibold text-muted-foreground">Modo avançado (administrador)</span><ChevronDown className={`h-4 w-4 transition ${showAdvanced ? "rotate-180" : ""}`} /></Button>{showAdvanced ? <div className="mt-4 space-y-3"><p className="text-xs text-muted-foreground">Use somente quando o formulário não cobrir a configuração. Campos protegidos continuam bloqueados.</p><Textarea value={advancedDraft} onChange={(event) => setAdvancedDraft(event.target.value)} disabled={saving} className="min-h-[260px] resize-y font-mono text-[12px] leading-5" /><Button variant="outline" onClick={saveAdvanced} disabled={saving} aria-busy={saving}>{saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{saving ? "Salvando…" : "Salvar JSON avançado"}</Button></div> : null}</div> : null}
      </CardContent>
    </Card>
  </div>;
}
