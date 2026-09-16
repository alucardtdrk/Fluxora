const WORKFLOWS = [
  { id: 'XBNVQcEZcOK7O817', name: 'Onboarding / Offboarding' },
  { id: 'f0knDy7mQL5J4f2E', name: 'Automações Gerais' },
  { id: '2bRtTnmChl2kXqBV', name: 'Reservas de Salas' },
  { id: 'bhR5IJiyoFRKbHaj', name: 'Reset de Senha - Terceirizados' },
] as const;

const SECRET_KEYS = /senha|password|token|authorization|apikey|api_key|secret|cookie|credential|refreshtoken/i;

function sanitize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  const obj = value as object;
  if (seen.has(obj)) return '[REFERENCIA_CIRCULAR]';
  seen.add(obj);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, seen));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEYS.test(key.replace(/[^a-z0-9_]/gi, '')) ? '[OCULTO]' : sanitize(val, seen);
  }
  return out;
}

function parseStaticData(value: unknown): Record<string, any> {
  if (!value) return {};
  let parsed: any = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return {}; }
  }
  if (!parsed || typeof parsed !== 'object') return {};
  return parsed.global && typeof parsed.global === 'object' ? parsed.global : parsed;
}

function text(v: unknown) { return String(v ?? '').trim(); }
function upper(v: unknown) {
  return text(v).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[ -]+/g, '_');
}

function eventStatus(v: unknown) {
  const s = upper(v);
  if (['SUCCESS','SUCESSO','OK','DONE','MOVED','ENVIADO','CONFIRMADA','CONFIRMADO'].includes(s)) return 'SUCESSO';
  if (['ERROR','ERRO','FAILED','FAILURE','CRASHED'].includes(s)) return 'ERRO';
  if (s.includes('NAO_ENCONTRADO') || s.includes('NOT_FOUND')) return 'NAO_ENCONTRADO';
  if (s.includes('BLOQUE')) return 'BLOQUEADO';
  if (s.includes('EXPIR')) return 'EXPIRADO';
  if (s.includes('CANCEL')) return 'CANCELADO';
  if (['PENDING','PENDENTE','WAITING'].includes(s)) return 'PENDENTE';
  if (['SKIPPED','IGNORADO'].includes(s)) return 'IGNORADO';
  return s || 'INFO';
}

function durationMs(exec: any) {
  if (!exec?.startedAt || !exec?.stoppedAt) return 0;
  const ms = new Date(exec.stoppedAt).getTime() - new Date(exec.startedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : 0;
}

function execLevel(status: string) {
  const s = status.toLowerCase();
  if (['error','failed','crashed'].includes(s)) return 'error';
  if (['running','waiting','new'].includes(s)) return 'warning';
  return 'success';
}

async function n8nFetch(path: string, apiKey: string, baseUrl: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'X-N8N-API-KEY': apiKey, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`n8n ${response.status}: ${body.slice(0, 240)}`);
  }
  return response.json();
}

async function getWorkflow(id: string, apiKey: string, baseUrl: string) {
  return n8nFetch(`/api/v1/workflows/${encodeURIComponent(id)}`, apiKey, baseUrl);
}

async function getExecutions(id: string, apiKey: string, baseUrl: string, days: number, maxPages: number) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const executions: any[] = [];
  let cursor = '';
  let truncated = false;

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ workflowId: id, limit: '250' });
    if (cursor) qs.set('cursor', cursor);
    const body = await n8nFetch(`/api/v1/executions?${qs.toString()}`, apiKey, baseUrl);
    const data = Array.isArray(body?.data) ? body.data : [];
    executions.push(...data);

    const oldest = data.reduce((min: number, item: any) => {
      const ts = new Date(item?.startedAt || 0).getTime();
      return ts && ts < min ? ts : min;
    }, Number.POSITIVE_INFINITY);

    cursor = body?.nextCursor || '';
    if (!cursor) break;
    if (Number.isFinite(oldest) && oldest < cutoff) break;
    if (page === maxPages - 1 && cursor) truncated = true;
  }

  return {
    data: executions.filter((x) => new Date(x?.startedAt || 0).getTime() >= cutoff),
    truncated,
  };
}

function operationalLogs(workflow: any, workflowName: string, workflowId: string) {
  const sd = parseStaticData(workflow?.staticData);
  const source = workflowName === 'Reservas de Salas'
    ? (Array.isArray(sd.logs) ? sd.logs : [])
    : (Array.isArray(sd.auditoriaGeral) ? sd.auditoriaGeral : []);

  return source.map((log: any, index: number) => {
    const details = sanitize(log?.detalhes ?? log) as any;
    return {
      id: `${workflowId}:op:${index}`,
      workflowId,
      workflowName,
      executionId: text(log?.executionId),
      at: text(log?.at || log?.timestamp),
      status: eventStatus(log?.status),
      modulo: text(log?.modulo || (workflowName === 'Reservas de Salas' ? 'RESERVAS' : 'GERAL')),
      sistema: text(log?.sistema || (log?.calendarId ? 'Google Calendar' : 'n8n')),
      etapa: text(log?.etapa || log?.action || log?.tipo || 'ETAPA_NAO_INFORMADA'),
      colaborador: text(log?.colaborador || log?.nome || log?.nomeCompleto || log?.organizerName || log?.sentToName),
      email: text(log?.email || log?.primaryEmail || log?.FinalEmail || log?.organizerEmail || log?.sentTo),
      referencia: text(log?.referencia || log?.cardId || log?.cardID || log?.roomName || log?.sala || log?.eventId),
      mensagem: text(log?.mensagem || log?.message || log?.resumo || log?.motivo || log?.action),
      nodeOrigem: text(log?.nodeOrigem || log?.sourceNode || log?.detalhes?.nodeOrigem),
      detalhes: details,
    };
  }).filter((x: any) => x.at || x.mensagem || x.executionId || x.email || x.referencia);
}

function stats(executions: any[]) {
  const success = executions.filter((x) => String(x.status).toLowerCase() === 'success').length;
  const error = executions.filter((x) => ['error','failed','crashed'].includes(String(x.status).toLowerCase())).length;
  const running = executions.filter((x) => ['running','waiting','new'].includes(String(x.status).toLowerCase())).length;
  const finished = success + error;
  const durations = executions.map(durationMs).filter((x) => x > 0);
  return {
    total: executions.length,
    success,
    error,
    running,
    successRate: finished ? Number(((success / finished) * 100).toFixed(1)) : 0,
    avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.N8N_API_KEY;
  const baseUrl = (process.env.N8N_BASE_URL || 'https://n8n-adm.saipos.center').replace(/\/$/, '');
  const days = Math.min(90, Math.max(1, Number(req.query?.days || 7)));
  const maxPages = Math.min(100, Math.max(1, Number(process.env.N8N_MAX_PAGES || 20)));

  if (!apiKey) {
    return res.status(500).json({ error: 'N8N_API_KEY não configurada no Vercel.' });
  }

  try {
    const results = await Promise.all(WORKFLOWS.map(async (wf) => {
      const [workflow, execResult] = await Promise.all([
        getWorkflow(wf.id, apiKey, baseUrl),
        getExecutions(wf.id, apiKey, baseUrl, days, maxPages),
      ]);
      return {
        ...wf,
        executions: execResult.data,
        truncated: execResult.truncated,
        operational: operationalLogs(workflow, wf.name, wf.id),
      };
    }));

    const executions = results.flatMap((wf) => wf.executions.map((exec: any) => ({
      id: text(exec.id),
      executionId: text(exec.id),
      workflowId: wf.id,
      workflowName: wf.name,
      startedAt: exec.startedAt,
      stoppedAt: exec.stoppedAt,
      status: text(exec.status || (exec.finished ? 'success' : 'unknown')).toLowerCase(),
      level: execLevel(text(exec.status || (exec.finished ? 'success' : 'unknown'))),
      durationMs: durationMs(exec),
      mode: text(exec.mode),
      finished: Boolean(exec.finished),
    })));

    const opLogs = results.flatMap((wf) => wf.operational);
    const opByExecution = new Map<string, any[]>();
    for (const log of opLogs) {
      if (!log.executionId) continue;
      const key = `${log.workflowId}:${log.executionId}`;
      if (!opByExecution.has(key)) opByExecution.set(key, []);
      opByExecution.get(key)!.push(log);
    }

    const rows = executions
      .map((exec) => {
        const related = opByExecution.get(`${exec.workflowId}:${exec.executionId}`) || [];
        const primary = related.find((x) => x.email || x.colaborador || x.mensagem) || related[0];
        return {
          ...exec,
          actor: exec.mode || 'n8n',
          source: primary?.sistema || exec.workflowName,
          event: primary?.etapa || (exec.level === 'error' ? 'Falha na execução' : exec.level === 'warning' ? 'Execução em andamento' : 'Execução concluída'),
          detail: primary?.mensagem || primary?.email || primary?.referencia || `${related.length} evento(s) operacional(is)`,
          collaborator: primary?.colaborador || '',
          email: primary?.email || '',
          reference: primary?.referencia || '',
          operationalEvents: related,
        };
      })
      .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());

    const workflowStats = results.map((wf) => ({
      id: wf.id,
      name: wf.name,
      ...stats(wf.executions),
      operationalEvents: wf.operational.length,
      truncated: wf.truncated,
    }));

    const totalStats = stats(executions);

    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      periodDays: days,
      totals: totalStats,
      workflows: workflowStats,
      executions: rows,
      operationalEvents: opLogs.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime()).slice(0, 5000),
      truncated: results.some((x) => x.truncated),
    });
  } catch (error: any) {
    console.error(error);
    return res.status(502).json({ error: 'Falha ao consultar o n8n.', detail: String(error?.message || error) });
  }
}
