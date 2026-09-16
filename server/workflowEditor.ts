import { z } from "zod";
import { getWorkflowSnapshot, listWorkflowChanges, saveWorkflowChange, saveWorkflowSnapshot, workflowHistoryConfigured } from "./workflowChanges.js";

const SENSITIVE_KEYWORDS = [
  "password",
  "senha",
  "token",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "auth",
  "cookie",
  "credential",
  "clientsecret",
  "privatekey",
  "ssh",
  "headerauth",
];

const MANAGED_ACTIONS_MESSAGE = "As acoes de gerenciamento estao desativadas. Defina CONTROL_ACTIONS_ENABLED=true no Vercel.";

type WorkflowNode = {
  id?: string;
  name?: string;
  type?: string;
  typeVersion?: number;
  position?: [number, number];
  parameters?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  disabled?: boolean;
  notes?: string;
  [key: string]: unknown;
};

type WorkflowRecord = {
  id?: string;
  name?: string;
  active?: boolean;
  nodes?: WorkflowNode[];
  connections?: Record<string, unknown>;
  tags?: Array<{ name?: string }>;
  settings?: Record<string, unknown>;
  staticData?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  versionId?: string;
  updatedAt?: string;
  createdAt?: string;
  [key: string]: unknown;
};

type EditorActor = {
  email: string;
  role: "admin" | "operator" | "viewer";
};

const updateWorkflowNodeInputSchema = z.object({
  workflowId: z.string().min(1),
  nodeName: z.string().min(1),
  changes: z.array(z.object({ path: z.string().min(1), value: z.unknown() })).max(80).optional(),
  additions: z.array(z.object({ path: z.string().min(1), kind: z.enum(["condition", "header"]), value: z.record(z.string(), z.unknown()) })).max(20).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  summary: z.string().trim().max(240).optional(),
}).refine((input) => Boolean(input.parameters) || Boolean(input.changes?.length) || Boolean(input.additions?.length), { message: "Informe ao menos uma alteracao." });

function getConfig() {
  const baseUrl = process.env.N8N_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.N8N_API_KEY;
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

async function n8nRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const config = getConfig();
  if (!config) throw new Error("N8N_NOT_CONFIGURED");

  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-N8N-API-KEY": config.apiKey,
      ...init?.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("N8N_UNAUTHORIZED");
    throw new Error(`N8N_HTTP_${response.status}`);
  }

  return response.json() as Promise<T>;
}

function unwrapWorkflowPayload(payload: unknown): WorkflowRecord {
  const candidate = payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)
    ? (payload as Record<string, unknown>).data
    : payload;
  return (candidate && typeof candidate === "object" ? candidate : {}) as WorkflowRecord;
}

function editorUrlForWorkflow(workflowId: string) {
  const config = getConfig();
  return config ? `${config.baseUrl}/workflow/${encodeURIComponent(workflowId)}` : null;
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEYWORDS.some((word) => normalized.includes(word.replace(/[^a-z0-9]/g, "")));
}

function objectHasSensitiveLabel(record: Record<string, unknown>) {
  const label = [record.name, record.key, record.field, record.label]
    .find((value) => typeof value === "string");
  return typeof label === "string" && isSensitiveKey(label);
}

function sanitizeVisibleValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[limite]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 1500 ? `${value.slice(0, 1500)}...` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeVisibleValue(item, depth + 1));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const hideValue = objectHasSensitiveLabel(record);
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(record)) {
      const shouldHide = isSensitiveKey(key) || (hideValue && ["value", "expression"].includes(key.toLowerCase()));
      out[key] = shouldHide ? "[protegido]" : sanitizeVisibleValue(raw, depth + 1);
    }
    return out;
  }
  return String(value);
}

function extractEditableParameters(value: unknown, path = "", blocked: string[] = []): unknown {
  if (Array.isArray(value)) return value.map((item, index) => extractEditableParameters(item, `${path}[${index}]`, blocked));
  if (!value || typeof value !== "object") return value ?? null;
  const record = value as Record<string, unknown>;
  const redactValue = objectHasSensitiveLabel(record);
  if (redactValue) {
    blocked.push(path || "parametros");
    return {};
  }
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(record)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (isSensitiveKey(key) || (redactValue && ["value", "expression"].includes(key.toLowerCase()))) {
      blocked.push(nextPath);
      continue;
    }
    output[key] = extractEditableParameters(raw, nextPath, blocked);
  }
  return output;
}

type EditorField = {
  path: string;
  label: string;
  group: string;
  kind: "text" | "textarea" | "number" | "boolean" | "select";
  value: string | number | boolean;
  options?: string[];
};

const FIELD_LABELS: Record<string, string> = {
  httpMethod: "Metodo HTTP",
  method: "Metodo",
  path: "Caminho",
  url: "URL",
  responseMode: "Modo de resposta",
  responseCode: "Codigo de resposta",
  responseBody: "Corpo da resposta",
  subject: "Assunto",
  message: "Mensagem",
  text: "Texto",
  html: "Conteudo HTML",
  operation: "Operacao",
  resource: "Recurso",
  leftValue: "Valor a esquerda",
  rightValue: "Valor a direita",
  operator: "Operador",
  caseSensitive: "Diferenciar maiusculas e minusculas",
  typeValidation: "Validar tipos",
  conditions: "Condição",
  options: "Opções",
  parameters: "Parâmetros",
  operand: "Comparação",
  singleValue: "Valor único",
  combinator: "Combinar condições",
};

const INTERNAL_EDITOR_KEYS = new Set(["id"]);

function humanizePath(path: string) {
  const labels = path.split(".").map((part) => {
    const match = part.match(/^(.+)\[(\d+)\]$/);
    const key = match?.[1] || part;
    const label = FIELD_LABELS[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
    return match ? `${label} ${Number(match[2]) + 1}` : label;
  });
  // The final segments identify the field better than the full JSON path.
  return labels.slice(-2).join(" · ");
}

function editorGroup(path: string) {
  const root = path.split(/[.[]/)[0];
  if (root === "conditions") return "Condições";
  if (/header/i.test(root)) return "Cabeçalhos";
  if (/body|json/i.test(path)) return "Corpo da requisição";
  if (["httpMethod", "method", "url", "path", "authentication", "responseMode"].includes(root)) return "Requisição";
  return "Configuração";
}

function selectOptions(key: string, path: string): string[] | undefined {
  if (key === "httpMethod" || key === "method") return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
  if (key === "responseMode") return ["onReceived", "lastNode", "responseNode"];
  if (key === "typeValidation") return ["strict", "loose"];
  if (key === "combinator") return ["and", "or"];
  if (key === "specifyBody") return ["json", "string", "form-urlencoded", "multipart-form-data"];
  if (key === "type" && /conditions/.test(path)) return ["boolean", "string", "number", "dateTime", "array", "object"];
  if (key === "operation" && /conditions/.test(path)) return ["true", "false", "equals", "notEquals", "contains", "notContains", "startsWith", "endsWith", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual", "isEmpty", "isNotEmpty", "exists", "notExists"];
  return undefined;
}

function buildEditorFields(value: unknown, path = "", fields: EditorField[] = []): EditorField[] {
  if (fields.length >= 80 || value == null) return fields;
  if (Array.isArray(value)) {
    value.forEach((item, index) => buildEditorFields(item, `${path}[${index}]`, fields));
    return fields;
  }
  if (typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      if (!INTERNAL_EDITOR_KEYS.has(key)) buildEditorFields(item, path ? `${path}.${key}` : key, fields);
    });
    return fields;
  }

  const key = path.replace(/\[\d+\]$/, "").split(".").pop() || "";
  const options = typeof value === "string" ? selectOptions(key, path) : undefined;
  const kind: EditorField["kind"] = typeof value === "boolean"
    ? "boolean"
    : typeof value === "number"
      ? "number"
      : options
        ? "select"
        : /message|body|html|text|content/i.test(key) || String(value).length > 140
          ? "textarea"
          : "text";
  fields.push({ path, label: humanizePath(path), group: editorGroup(path), kind, value: value as string | number | boolean, ...(options ? { options } : {}) });
  return fields;
}

function getPathSegments(path: string) {
  return Array.from(path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)).map((match) => match[1] ?? match[2]);
}

function setExistingValue(target: unknown, path: string, value: unknown) {
  const segments = getPathSegments(path);
  let cursor: any = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!cursor || !(segment in cursor)) throw new Error(`CAMPO_NAO_PERMITIDO:${path}`);
    cursor = cursor[segment];
  }
  const last = segments[segments.length - 1];
  if (!last || !cursor || !(last in cursor)) throw new Error(`CAMPO_NAO_PERMITIDO:${path}`);
  cursor[last] = value;
}

function getExistingValue(target: unknown, path: string) {
  return getPathSegments(path).reduce<any>((value, segment) => value?.[segment], target);
}

function appendControlledItem(target: Record<string, unknown>, addition: { path: string; kind: "condition" | "header"; value: Record<string, unknown> }, nodeType: unknown) {
  const collection = getExistingValue(target, addition.path);
  if (!Array.isArray(collection)) throw new Error(`CAMPO_NAO_PERMITIDO:${addition.path}`);
  if (addition.kind === "condition") {
    if (!/(?:^|\.)if$/i.test(String(nodeType || "")) || addition.path !== "conditions.conditions") throw new Error(`CAMPO_NAO_PERMITIDO:${addition.path}`);
    const leftValue = addition.value.leftValue;
    const rightValue = addition.value.rightValue;
    const operator = addition.value.operator;
    if (typeof leftValue !== "string" || typeof rightValue !== "string" || !operator || typeof operator !== "object") throw new Error(`FORMATO_INVALIDO:${addition.path}`);
    const typedOperator = operator as Record<string, unknown>;
    if (typeof typedOperator.type !== "string" || typeof typedOperator.operation !== "string") throw new Error(`FORMATO_INVALIDO:${addition.path}`);
  }
  if (addition.kind === "header") {
    if (!/header/i.test(addition.path) || typeof addition.value.name !== "string" || typeof addition.value.value !== "string" || !addition.value.name.trim()) throw new Error(`FORMATO_INVALIDO:${addition.path}`);
  }
  ensureNoSensitiveKeys(addition.value, addition.path);
  collection.push(addition.value);
}

function ensureNoSensitiveKeys(value: unknown, path = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => ensureNoSensitiveKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (objectHasSensitiveLabel(record)) throw new Error(`CAMPO_BLOQUEADO:${path || "parametros"}`);
  for (const [key, raw] of Object.entries(record)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (isSensitiveKey(key)) throw new Error(`CAMPO_BLOQUEADO:${nextPath}`);
    ensureNoSensitiveKeys(raw, nextPath);
  }
}

function mergeEditableParameters(current: unknown, incoming: unknown, path = ""): unknown {
  if (Array.isArray(current)) {
    if (!Array.isArray(incoming)) throw new Error(`INVALID_ARRAY:${path || "root"}`);
    if (current.length !== incoming.length) throw new Error(`INVALID_ARRAY:${path || "root"}`);
    return current.map((item, index) => mergeEditableParameters(item, incoming[index], `${path}[${index}]`));
  }

  if (current && typeof current === "object") {
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new Error(`INVALID_OBJECT:${path || "root"}`);
    const currentObject = current as Record<string, unknown>;
    const incomingObject = incoming as Record<string, unknown>;
    if (objectHasSensitiveLabel(currentObject)) {
      if (Object.keys(incomingObject).length) throw new Error(`CAMPO_BLOQUEADO:${path || "parametros"}`);
      return currentObject;
    }
    const output: Record<string, unknown> = { ...currentObject };
    for (const key of Object.keys(incomingObject)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (!(key in currentObject)) throw new Error(`CAMPO_NAO_PERMITIDO:${nextPath}`);
      if (isSensitiveKey(key)) throw new Error(`CAMPO_BLOQUEADO:${nextPath}`);
      output[key] = mergeEditableParameters(currentObject[key], incomingObject[key], nextPath);
    }
    return output;
  }

  return incoming;
}

function nodeConnections(connections: Record<string, unknown> | undefined, nodeName: string) {
  const outgoing: string[] = [];
  const incoming: string[] = [];
  for (const [sourceName, ports] of Object.entries(connections || {})) {
    for (const values of Object.values((ports || {}) as Record<string, unknown>)) {
      if (!Array.isArray(values)) continue;
      for (const lane of values) {
        if (!Array.isArray(lane)) continue;
        for (const connection of lane) {
          const target = String((connection as Record<string, unknown>)?.node || "");
          if (sourceName === nodeName && target) outgoing.push(target);
          if (target === nodeName) incoming.push(sourceName);
        }
      }
    }
  }
  return { incoming: Array.from(new Set(incoming)), outgoing: Array.from(new Set(outgoing)) };
}

function normalizeNode(node: WorkflowNode, workflow: WorkflowRecord) {
  const blockedFields: string[] = [];
  const editableParameters = extractEditableParameters(node.parameters || {}, "", blockedFields);
  const { incoming, outgoing } = nodeConnections(workflow.connections, String(node.name || ""));
  return {
    id: String(node.id || node.name || ""),
    name: String(node.name || "Node sem nome"),
    type: String(node.type || "desconhecido"),
    typeVersion: node.typeVersion ?? null,
    position: Array.isArray(node.position) ? node.position : [0, 0],
    disabled: Boolean(node.disabled),
    notes: typeof node.notes === "string" ? node.notes : "",
    parameters: sanitizeVisibleValue(node.parameters || {}),
    editableParameters,
    editorFields: buildEditorFields(editableParameters),
    blockedFields,
    editBlocked: false,
    editBlockedReason: null,
    incoming,
    outgoing,
  };
}

function normalizeWorkflow(workflow: WorkflowRecord) {
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes.map((node) => normalizeNode(node, workflow)) : [];
  return {
    id: String(workflow.id || ""),
    name: String(workflow.name || "Workflow"),
    active: Boolean(workflow.active),
    updatedAt: workflow.updatedAt ? String(workflow.updatedAt) : null,
    createdAt: workflow.createdAt ? String(workflow.createdAt) : null,
    tags: Array.isArray(workflow.tags) ? workflow.tags.map((tag) => ({ name: String(tag?.name || "") })).filter((tag) => tag.name) : [],
    nodeCount: nodes.length,
    connections: workflow.connections || {},
    nodes,
  };
}

async function fetchWorkflow(workflowId: string) {
  try {
    const workflow = unwrapWorkflowPayload(await n8nRequest<unknown>(`/api/v1/workflows/${encodeURIComponent(workflowId)}`));
    if (String(workflow.id || "") === workflowId) return workflow;
  } catch (error) {
    if (!(error instanceof Error) || error.message === "N8N_UNAUTHORIZED") throw error;
  }

  const fallback = await n8nRequest<{ data?: WorkflowRecord[] }>(`/api/v1/workflows?limit=250`);
  const found = (fallback.data || []).find((item) => String(item?.id || "") === workflowId);
  if (!found) throw new Error("WORKFLOW_NOT_FOUND");
  return found;
}

async function pushWorkflow(workflowId: string, workflow: WorkflowRecord) {
  return n8nRequest<WorkflowRecord>(`/api/v1/workflows/${encodeURIComponent(workflowId)}`, {
    method: "PUT",
    body: JSON.stringify(workflow),
  });
}

export async function getN8nWorkflowDetail(workflowId: string) {
  if (!getConfig()) return { status: "not_configured" as const, connected: false as const, historyConfigured: workflowHistoryConfigured(), workflow: null, editorUrl: null, changes: [] };
  try {
    const workflow = await fetchWorkflow(workflowId);
    const changes = await listWorkflowChanges(workflowId).catch(() => []);
    return { status: "ok" as const, connected: true as const, historyConfigured: workflowHistoryConfigured(), workflow: normalizeWorkflow(workflow), editorUrl: editorUrlForWorkflow(workflowId), changes };
  } catch (error) {
    const status = error instanceof Error && error.message === "N8N_UNAUTHORIZED" ? "unauthorized" : "api_error";
    return { status, connected: false as const, historyConfigured: workflowHistoryConfigured(), workflow: null, editorUrl: null, changes: [] };
  }
}

export async function updateN8nWorkflowNode(input: z.infer<typeof updateWorkflowNodeInputSchema>, actor: EditorActor) {
  const parsed = updateWorkflowNodeInputSchema.parse(input);
  if (!getConfig()) return { status: "not_configured" as const, connected: false as const };
  if (process.env.CONTROL_ACTIONS_ENABLED !== "true") return { status: "api_error" as const, connected: true as const, message: MANAGED_ACTIONS_MESSAGE };
  if (!workflowHistoryConfigured()) return { status: "firestore_not_configured" as const, connected: true as const, message: "Configure o Firestore para registrar snapshot e historico antes de editar workflows." };

  try {
    const currentWorkflow = await fetchWorkflow(parsed.workflowId);
    const nodes = Array.isArray(currentWorkflow.nodes) ? [...currentWorkflow.nodes] : [];
    const index = nodes.findIndex((node) => String(node.name || "") === parsed.nodeName);
    if (index < 0) return { status: "api_error" as const, connected: true as const, message: "Node nao encontrado no workflow." };

    const currentNode = nodes[index];
    let nextParameters: Record<string, unknown>;
    if (parsed.parameters) {
      if (actor.role !== "admin") return { status: "api_error" as const, connected: true as const, message: "O modo avancado de JSON esta disponivel apenas para administradores." };
      nextParameters = mergeEditableParameters(currentNode.parameters || {}, parsed.parameters) as Record<string, unknown>;
    } else {
      const clonedParameters = JSON.parse(JSON.stringify(currentNode.parameters || {})) as Record<string, unknown>;
      for (const addition of parsed.additions || []) appendControlledItem(clonedParameters, addition, currentNode.type);
      const nextEditableShape = extractEditableParameters(clonedParameters, "", []);
      const allowedFields = new Map(buildEditorFields(nextEditableShape).map((field) => [field.path, field]));
      for (const change of parsed.changes || []) {
        const allowed = allowedFields.get(change.path);
        if (!allowed) throw new Error(`CAMPO_NAO_PERMITIDO:${change.path}`);
        if (typeof change.value !== typeof allowed.value) throw new Error(`FORMATO_INVALIDO:${change.path}`);
        setExistingValue(clonedParameters, change.path, change.value);
      }
      nextParameters = clonedParameters;
    }
    nodes[index] = {
      ...currentNode,
      parameters: nextParameters,
    };

    const snapshot = await saveWorkflowSnapshot({
      workflowId: parsed.workflowId,
      workflowName: String(currentWorkflow.name || "Workflow"),
      actor: actor.email,
      actorRole: actor.role,
      reason: parsed.summary?.trim() || `Ajuste controlado no node ${parsed.nodeName}`,
      workflow: currentWorkflow as Record<string, unknown>,
    });

    const updatedWorkflow = await pushWorkflow(parsed.workflowId, { ...currentWorkflow, nodes });
    const change = await saveWorkflowChange({
      workflowId: parsed.workflowId,
      workflowName: String(currentWorkflow.name || "Workflow"),
      actor: actor.email,
      actorRole: actor.role,
      type: "update",
      summary: parsed.summary?.trim() || `Parametros atualizados no node ${parsed.nodeName}`,
      nodeNames: [parsed.nodeName],
      snapshotId: snapshot.id,
      restoredFromSnapshotId: null,
    });

    return { status: "ok" as const, connected: true as const, workflow: normalizeWorkflow(updatedWorkflow), snapshotId: snapshot.id, change };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const friendlyMessage =
      message.startsWith("CAMPO_NAO_PERMITIDO:")
        ? `O campo ${message.slice("CAMPO_NAO_PERMITIDO:".length)} nao faz parte da edicao controlada deste node.`
        : message.startsWith("CAMPO_BLOQUEADO:")
          ? `O campo ${message.slice("CAMPO_BLOQUEADO:".length)} esta protegido e nao pode ser alterado pelo Fluxora.`
          : message.startsWith("INVALID_")
            ? "O formato enviado para os parametros nao bate com a estrutura original do node."
            : "Nao foi possivel salvar a alteracao deste workflow.";
    return { status: "api_error" as const, connected: false as const, message: friendlyMessage };
  }
}

export async function restoreN8nWorkflowVersion(workflowId: string, snapshotId: string, actor: EditorActor) {
  if (!getConfig()) return { status: "not_configured" as const, connected: false as const };
  if (process.env.CONTROL_ACTIONS_ENABLED !== "true") return { status: "api_error" as const, connected: true as const, message: MANAGED_ACTIONS_MESSAGE };
  if (!workflowHistoryConfigured()) return { status: "firestore_not_configured" as const, connected: true as const, message: "Configure o Firestore para restaurar versoes com seguranca." };

  try {
    const [currentWorkflow, snapshot] = await Promise.all([fetchWorkflow(workflowId), getWorkflowSnapshot(snapshotId)]);
    if (!snapshot || snapshot.workflowId !== workflowId) return { status: "api_error" as const, connected: true as const, message: "Snapshot nao encontrado para este workflow." };

    const beforeRestoreSnapshot = await saveWorkflowSnapshot({
      workflowId,
      workflowName: String(currentWorkflow.name || "Workflow"),
      actor: actor.email,
      actorRole: actor.role,
      reason: `Snapshot automatico antes da restauracao ${snapshotId}`,
      workflow: currentWorkflow as Record<string, unknown>,
    });

    const restoredWorkflow = await pushWorkflow(workflowId, snapshot.workflow as WorkflowRecord);
    const restoredNodes = (snapshot.workflow as WorkflowRecord).nodes ?? [];
    const change = await saveWorkflowChange({
      workflowId,
      workflowName: String(restoredWorkflow.name || currentWorkflow.name || "Workflow"),
      actor: actor.email,
      actorRole: actor.role,
      type: "restore",
      summary: `Workflow restaurado para o snapshot ${snapshot.createdAt}`,
      nodeNames: restoredNodes.map((node) => String(node.name || "")).filter(Boolean),
      snapshotId: beforeRestoreSnapshot.id,
      restoredFromSnapshotId: snapshot.id,
    });

    return { status: "ok" as const, connected: true as const, workflow: normalizeWorkflow(restoredWorkflow), change };
  } catch (error) {
    return { status: "api_error" as const, connected: false as const, message: error instanceof Error ? error.message : String(error) };
  }
}
