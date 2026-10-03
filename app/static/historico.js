"use strict";
const el = (id) => document.getElementById(id);
const fields = { valor: "Valor", estado: "Estado", estado2: "Estado do fan" };
const LIMIT = 10000;
let resources = [];
let requestController = null;
let resourceController = null;
let resourceVersion = 0;
let busy = false;
let chartData = null;
let lastQuery = null;
const fmt = (v) => v === null || v === undefined ? "—" : String(v);
const dateText = (ts) => new Date(ts * 1000).toLocaleString("pt-BR");
function status(message, error = false) {
  el("history-status").textContent = message;
  el("history-status").dataset.error = String(error);
}
async function fetchJSON(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
function options(select, values, preferred) {
  select.replaceChildren(...values.map(value => new Option(value, value)));
  if (values.includes(preferred)) select.value = preferred;
}
function clearChart() {
  chartData = null;
  el("history-chart").replaceChildren();
  el("history-rows").replaceChildren();
  el("history-summary").textContent = "";
  el("history-point").textContent = "";
}
function invalidate() {
  requestController?.abort();
  lastQuery = null;
  clearChart();
}
async function loadResources() {
  resourceController?.abort();
  resourceController = new AbortController();
  const version = ++resourceVersion;
  try {
    const data = await fetchJSON("/api/history/resources", resourceController.signal);
    if (version !== resourceVersion) return;
    resources = data;
    options(el("history-node"), [...new Set(data.map(r => r.device_id))], el("history-node").value);
    updateResources();
    if (!resources.length) status("Nenhum evento registrado ainda.");
    else await loadHistory();
  } catch (error) {
    if (error.name !== "AbortError") status(`Erro ao listar recursos: ${error.message}. Clique em Atualizar para tentar novamente.`, true);
  }
}
function updateResources() {
  const previous = el("history-resource").value;
  const selected = resources.filter(r => r.device_id === el("history-node").value);
  options(el("history-resource"), selected.map(r => r.recurso_id), previous);
  updateFields();
}
function updateFields() {
  const resource = resources.find(r => r.device_id === el("history-node").value && r.recurso_id === el("history-resource").value);
  const allowed = Object.keys(fields).filter(f => resource?.[`has_${f}`]);
  el("history-field").replaceChildren(...allowed.map(f => new Option(fields[f], f)));
}
function range() {
  if (el("history-period").value !== "custom") {
    const end = Math.floor(Date.now() / 1000);
    return { start: end - Number(el("history-period").value) * 3600, end };
  }
  const start = new Date(el("history-start").value).getTime() / 1000;
  const end = new Date(el("history-end").value).getTime() / 1000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error("Informe um início anterior ao fim.");
  return { start: Math.floor(start), end: Math.floor(end) };
}
async function loadHistory() {
  requestController?.abort();
  const controller = new AbortController();
  requestController = controller;
  busy = true;
  el("history-load").disabled = true;
  try {
    if (!el("history-node").value || !el("history-resource").value) {
      clearChart(); status("Nenhum recurso disponível. Atualizar consulta novamente a lista."); return;
    }
    const { start, end } = range();
    const field = el("history-field").value;
    const node = el("history-node").value;
    const resource = el("history-resource").value;
    status("Carregando histórico…");
    const params = new URLSearchParams({ origem: node, recurso: resource, start, end, limit: LIMIT });
    const rows = await fetchJSON(`/api/history?${params}`, controller.signal);
    if (controller !== requestController) return;
    const points = rows.filter(r => typeof r[field] === "number" && Number.isFinite(r[field]) && Number.isFinite(r.timestamp)).map(r => ({ x: r.timestamp, y: r[field], row: r }));
    chartData = { points, start, end, field };
    lastQuery = { node, resource, field };
    el("chart-title").textContent = `${node} / ${resource} — ${fields[field] || "Eventos"}`;
    const values = points.map(p => p.y);
    let summary = `${dateText(start)} até ${dateText(end)}`;
    if (values.length) {
      let min = Infinity, max = -Infinity;
      for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
      summary += ` · mínimo ${min} · máximo ${max} · última amostra ${values[values.length - 1]}`;
    }
    el("history-summary").textContent = summary;
    drawChart();
    el("history-rows").replaceChildren(...rows.slice(-200).reverse().map(row => {
      const tr = document.createElement("tr");
      for (const value of [dateText(row.timestamp), row.evento, row.valor, row.status, row.estado, row.estado2]) {
        const td = document.createElement("td"); td.textContent = fmt(value); tr.append(td);
      }
      return tr;
    }));
    status(`${rows.length} eventos · ${points.length} amostras${rows.length >= LIMIT ? " · limite atingido: reduza o período para ver todos os dados" : ""}`);
  } catch (error) {
    if (error.name !== "AbortError" && controller === requestController) {
      clearChart(); status(`Erro ao carregar histórico: ${error.message}`, true);
    }
  } finally {
    if (controller === requestController) { busy = false; el("history-load").disabled = false; }
  }
}
function svgNode(tag, attrs = {}, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function drawChart() {
  const container = el("history-chart");
  container.replaceChildren();
  if (!chartData?.points.length) {
    container.textContent = "Sem amostras numéricas deste campo no período selecionado.";
    el("history-point").textContent = ""; return;
  }
  const { points, start, end, field } = chartData;
  const width = Math.max(420, container.clientWidth), height = 320;
  const left = 75, right = width - 25, top = 20, bottom = height - 55;
  let min = Infinity, max = -Infinity;
  for (const p of points) { min = Math.min(min, p.y); max = Math.max(max, p.y); }
  const pad = max === min ? Math.max(Math.abs(min) * .05, 1) : (max - min) * .1;
  min -= pad; max += pad;
  const x = ts => left + (ts - start) / (end - start) * (right - left);
  const y = value => bottom - (value - min) / (max - min) * (bottom - top);
  const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `${el("chart-title").textContent}, ${points.length} amostras` });
  svg.append(svgNode("title", {}, el("chart-title").textContent));
  for (let i = 0; i <= 4; i++) {
    const value = min + (max - min) * i / 4, yy = y(value);
    svg.append(svgNode("line", { x1: left, x2: right, y1: yy, y2: yy, stroke: "#e2e8f0" }));
    svg.append(svgNode("text", { x: left - 8, y: yy + 4, "text-anchor": "end", fill: "#64748b", "font-size": 12 }, Number(value.toPrecision(5)).toLocaleString("pt-BR")));
    const ts = start + (end - start) * i / 4;
    const label = new Date(ts * 1000).toLocaleString("pt-BR", end - start > 86400 ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
    svg.append(svgNode("text", { x: x(ts), y: bottom + 26, "text-anchor": i === 0 ? "start" : i === 4 ? "end" : "middle", fill: "#64748b", "font-size": 11 }, label));
  }
  // Mantém o tempo real entre amostras. Estados usam degraus até a última amostra.
  const d = points.map((p, i) => i === 0 ? `M${x(p.x)},${y(p.y)}` : field === "valor" ? `L${x(p.x)},${y(p.y)}` : `H${x(p.x)}V${y(p.y)}`).join(" ");
  svg.append(svgNode("path", { d, fill: "none", stroke: "#2563eb", "stroke-width": 2, "vector-effect": "non-scaling-stroke" }));
  if (points.length === 1) svg.append(svgNode("circle", { cx: x(points[0].x), cy: y(points[0].y), r: 4, fill: "#2563eb" }));
  const marker = svgNode("circle", { r: 5, fill: "#1d4ed8", visibility: "hidden" });
  svg.append(marker);
  svg.addEventListener("pointermove", event => {
    const rect = svg.getBoundingClientRect();
    const target = start + ((event.clientX - rect.left) / rect.width * width - left) / (right - left) * (end - start);
    let low = 0, high = points.length - 1;
    while (low < high) { const mid = (low + high) >> 1; if (points[mid].x < target) low = mid + 1; else high = mid; }
    const p = low > 0 && Math.abs(points[low - 1].x - target) < Math.abs(points[low].x - target) ? points[low - 1] : points[low];
    marker.setAttribute("cx", x(p.x)); marker.setAttribute("cy", y(p.y)); marker.setAttribute("visibility", "visible");
    el("history-point").textContent = `${dateText(p.x)} · ${fields[field]}: ${p.y} · evento: ${p.row.evento} · status: ${fmt(p.row.status)}`;
  });
  el("history-point").textContent = "Passe o ponteiro pelo gráfico para consultar uma amostra.";
  container.append(svg);
}
el("history-form").addEventListener("submit", event => { event.preventDefault(); resources.length ? loadHistory() : loadResources(); });
el("history-node").addEventListener("change", () => { invalidate(); updateResources(); loadHistory(); });
el("history-resource").addEventListener("change", () => { invalidate(); updateFields(); loadHistory(); });
el("history-field").addEventListener("change", () => { invalidate(); loadHistory(); });
el("history-period").addEventListener("change", () => {
  invalidate();
  const custom = el("history-period").value === "custom";
  el("custom-start").hidden = el("custom-end").hidden = !custom;
  el("history-start").required = el("history-end").required = custom;
  if (!custom) loadHistory(); else status("Escolha o intervalo e clique em Atualizar.");
});
for (const id of ["history-start", "history-end"]) el(id).addEventListener("change", () => { invalidate(); status("Clique em Atualizar para consultar o intervalo."); });
const localInput = date => { const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
el("history-end").value = localInput(new Date());
el("history-start").value = localInput(new Date(Date.now() - 86400000));
setInterval(() => { if (el("history-auto").checked && !document.hidden && !busy && lastQuery) loadHistory(); }, 15000);
new ResizeObserver(() => { if (chartData) drawChart(); }).observe(el("history-chart"));
loadResources();
