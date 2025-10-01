// ======== CONFIGURAÇÃO DO ARQUIVO JSON ========
const DATA_URL = "dados_completos.json";

// Limites de resgate para cada plataforma (em moeda nativa: USD ou EUR)
const THRESHOLDS = {
  "Adobe Stock": 25,
  "Freepik": 50,
  "Shutterstock": 35,
  "Getty Images": 50,
  "Deposite Photos": 50,
  "123RF": 50,
  "Dreamstime": 100,
  "Alamy": 50,
};

const PT_MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const PT_MONTH_TO_NUM = {"janeiro":1,"fevereiro":2,"março":3,"marco":3,"abril":4,"maio":5,"junho":6,"julho":7,"agosto":8,"setembro":9,"outubro":10,"novembro":11,"dezembro":12};

let RAW = [];
let availableBalances = {};
let LINE, BAR;
let stateRates = { usd_brl: 5.00, eur_brl: 6.00 };
let historicalRates = new Map();
let useHistoricalRates = false;
let displayCurrency = 'BRL';
let taxFreepikPct = 24;

const rateCache = new Map();

// ATUALIZADO: A função load agora carrega um único arquivo com todos os dados
async function load(){
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`Falha ao carregar o arquivo de dados: ${response.statusText}`);

    const completeData = await response.json();

    // Extrai os dados para as variáveis globais
    RAW = flattenFromNested(completeData); // A função já espera um objeto com a chave "sites"
    availableBalances = completeData.availableBalances;

    populateFilters();
    attachCurrencyHandlers();
    render();

  } catch (error) {
    console.error("Erro no carregamento inicial:", error);
    // Mensagem de erro atualizada para o novo arquivo
    document.body.innerHTML = `<div style="padding: 20px; color: red; text-align: center;">${error.message}. Verifique se o arquivo 'dados_completos.json' existe e está com a formatação JSON correta.</div>`;
  }
}

function flattenFromNested(obj){
  const out = [];
  const sites = obj.sites || {};
  for (const [platform, years] of Object.entries(sites)){
    for (const [yearStr, months] of Object.entries(years)){
      const y = parseInt(yearStr,10);
      if (!y || typeof months !== 'object') continue;
      for (const [mKey, val] of Object.entries(months)){
        const mnum = PT_MONTH_TO_NUM[String(mKey).toLowerCase()];
        if (!mnum) continue;
        const amount = (val==null || isNaN(Number(val))) ? 0 : Number(val);
        out.push({ year: y, month_num: mnum, month_name: PT_MONTHS[mnum-1], platform, amount });
      }
    }
  }
  return out;
}

async function fetchHistoricalRate(from, to, date) {
  const cacheKey = `${from}-${to}-${date}`;
  if (rateCache.has(cacheKey)) return rateCache.get(cacheKey);
  try {
    const response = await fetch(`https://api.frankfurter.app/${date}?from=${from}&to=${to}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const rate = data.rates[to];
    if (rate) { rateCache.set(cacheKey, rate); return rate; }
  } catch (error) { console.warn(`Erro taxa ${from}→${to} para ${date}:`, error); }
  return null;
}
async function loadHistoricalRates() {
  if (!useHistoricalRates || !RAW.length) return;
  const statusEl = document.getElementById('rateStatus');
  statusEl.textContent = 'Carregando...'; statusEl.className = 'muted';
  const uniqueDates = new Set(RAW.map(r => `${r.year}-${String(r.month_num).padStart(2, '0')}-15`));
  const dates = Array.from(uniqueDates).sort();
  let loadedCount = 0, errorCount = 0;
  for (const date of dates) {
    const [usd, eur] = await Promise.all([fetchHistoricalRate('USD', 'BRL', date), fetchHistoricalRate('EUR', 'BRL', date)]);
    if (usd && eur) { historicalRates.set(date, { usd_brl: usd, eur_brl: eur }); loadedCount++; } else { errorCount++; }
    statusEl.textContent = `Carregando... ${loadedCount}/${dates.length}`;
  }
  statusEl.textContent = `✓ ${loadedCount} períodos carregados${errorCount > 0 ? ` (${errorCount} falhas)` : ''}`;
  render();
}
function getHistoricalRate(from, to, year, month) {
  if (!useHistoricalRates || !historicalRates.size) return null;
  const rates = historicalRates.get(`${year}-${String(month).padStart(2, '0')}-15`);
  if (!rates) return null;
  if (from === 'USD' && to === 'BRL') return rates.usd_brl;
  if (from === 'EUR' && to === 'BRL') return rates.eur_brl;
  return null;
}
function platformCurrency(platform){ return String(platform).toLowerCase().includes('freepik') ? 'EUR' : 'USD'; }

function attachCurrencyHandlers(){
  const sel = document.getElementById('currencySel'), 
        usd = document.getElementById('rateUsdBrl'), 
        eur = document.getElementById('rateEurBrl'), 
        tax = document.getElementById('taxFreepik'), 
        hist = document.getElementById('useHistoricalRates'), 
        manual = document.getElementById('manualRates'),
        yearSel = document.getElementById('yearSel'),
        monthSel = document.getElementById('monthSel'),
        siteSel = document.getElementById('siteSel');

  const update = () => {
    displayCurrency = sel.value; 
    stateRates.usd_brl = parseFloat(usd.value)||5; 
    stateRates.eur_brl = parseFloat(eur.value)||6; 
    taxFreepikPct = parseFloat(tax.value)||24; 
    useHistoricalRates = hist.checked;
    manual.style.opacity = useHistoricalRates ? 0.5 : 1; 
    manual.style.pointerEvents = useHistoricalRates ? 'none' : 'auto';
  };

  sel.onchange = ()=>{update(); render();};
  usd.oninput = eur.oninput = tax.oninput = ()=>{update(); if(!useHistoricalRates) render();};
  hist.onchange = ()=>{ update(); if(useHistoricalRates && historicalRates.size === 0) loadHistoricalRates(); else render(); };
  
  document.getElementById('btnReset').onclick = ()=>{ 
    yearSel.value = "";
    monthSel.value = "";
    sel.value = "BRL";
    usd.value = "5.00";
    eur.value = "6.00";
    tax.value = "24";
    hist.checked = false;
    document.getElementById('rateStatus').textContent = '';
    [...siteSel.options].forEach(o => o.selected = true);
    historicalRates.clear(); 
    rateCache.clear(); 
    update(); 
    render(); 
  };

  update();
}

function convertAmount(amount, from, to, year = null, month = null){
  if (from === to) return amount;
  if (year && month && useHistoricalRates) { const rate = getHistoricalRate(from, to, year, month); if(rate) return amount * rate; }
  const { usd_brl, eur_brl } = stateRates;
  if (from === 'USD' && to === 'BRL') return amount * usd_brl;
  if (from === 'EUR' && to === 'BRL') return amount * eur_brl;
  return amount; 
}
function unique(arr){return [...new Set(arr.filter(x=>x!=null))]}
function populateFilters(){
  const years = unique(RAW.map(d=>d.year)).sort((a,b)=>b-a);
  const sites = unique(RAW.map(d=>d.platform)).sort();
  const yearSel = document.getElementById('yearSel'), monthSel = document.getElementById('monthSel'), siteSel = document.getElementById('siteSel');
  yearSel.innerHTML = '<option value="">Todos</option>' + years.map(y=>`<option>${y}</option>`).join('');
  monthSel.innerHTML = '<option value="">Todos</option>' + PT_MONTHS.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('');
  siteSel.innerHTML = sites.map(s=>`<option selected>${s}</option>`).join('');
  yearSel.onchange = monthSel.onchange = siteSel.onchange = render;
}
function getFilters(){
  const y = document.getElementById('yearSel').value, m = document.getElementById('monthSel').value, sites = [...document.getElementById('siteSel').selectedOptions].map(o=>o.value);
  return {year: y?+y:null, month: m?+m:null, sites};
}
function fmt(n, cur = displayCurrency) {
    const map = { BRL: ['pt-BR', 'BRL'], USD: ['en-US', 'USD'], EUR: ['de-DE', 'EUR'] };
    const [loc, currency] = map[cur] || map.BRL;
    return n.toLocaleString(loc, { style: 'currency', currency: currency });
}

function compute(){
  const f = getFilters();
  const base = RAW.filter(d=> (f.year? d.year===f.year : true) && (f.month? d.month_num===f.month : true) && (f.sites.includes(d.platform)) ).map(r=>{
      const cur = platformCurrency(r.platform);
      const bruto = r.amount;
      const liquido = String(r.platform).toLowerCase().includes('freepik') ? bruto * (1 - taxFreepikPct/100) : bruto;
      return { ...r, native_currency: cur, bruto, liquido };
    });
  let rows;
  if (displayCurrency === 'BRL'){ rows = base.map(r=>({ ...r, amount_conv_bruto: convertAmount(r.bruto, r.native_currency, 'BRL', r.year, r.month_num), amount_conv: convertAmount(r.liquido, r.native_currency, 'BRL', r.year, r.month_num) })); }
  else if (displayCurrency === 'USD'){ rows = base.filter(r=> r.native_currency==='USD').map(r=> ({...r, amount_conv_bruto: r.bruto, amount_conv: r.liquido})); }
  else if (displayCurrency === 'EUR'){ rows = base.filter(r=> r.native_currency==='EUR').map(r=> ({...r, amount_conv_bruto: r.bruto, amount_conv: r.liquido})); }
  else { rows = []; }
  const seriesMap = new Map();
  rows.forEach(d=>{ const k = `${d.year}-${String(d.month_num).padStart(2,'0')}`; seriesMap.set(k,(seriesMap.get(k)||0)+d.amount_conv); });
  const series = [...seriesMap.entries()].map(([k,v])=>({key:k, value:v, year:+k.split('-')[0], month:+k.split('-')[1]})).sort((a,b)=> a.key.localeCompare(b.key));
  const platAgg = new Map();
  rows.forEach(d=>{ const o = platAgg.get(d.platform) || { bruto:0, liquido:0 }; o.bruto += d.amount_conv_bruto; o.liquido += d.amount_conv; platAgg.set(d.platform, o); });
  const platforms = [...platAgg.entries()].map(([name,vals])=>({name, bruto: vals.bruto, val: vals.liquido})).sort((a,b)=> b.val - a.val);
  const total = platforms.reduce((s,p)=>s+p.val,0);
  const totalBruto = platforms.reduce((s,p)=>s+p.bruto,0);
  const countMonths = unique(series.map(s=>s.key)).length;
  const avg = countMonths ? total / countMonths : 0;
  const best = series.length ? series.reduce((a,b)=> a.value>=b.value? a: b) : null;
  const worst = series.length ? series.reduce((a,b)=> a.value<=b.value? a: b) : null;
  return {rows, series, platforms, total, totalBruto, avg, countMonths, best, worst};
}

// ======== FUNÇÃO MODIFICADA (Request 1) ========
function renderAvailableBalance() {
  const tb = document.querySelector('#tblAvailableBalance tbody');
  if (!tb || !availableBalances) return;

  let totalAvailableConverted = 0; // Nome da variável alterado para clareza
  tb.innerHTML = '';

  const sortedPlatforms = Object.entries(availableBalances)
    .sort(([, balanceA], [, balanceB]) => balanceB - balanceA);

  for (const [platform, balance] of sortedPlatforms) {
    if (balance == null) continue;

    const nativeCurrency = platformCurrency(platform);
    const threshold = THRESHOLDS[platform] || 0;
    const progress = threshold > 0 ? (balance / threshold) * 100 : 100;

    // Lógica para somar ao total do KPI, respeitando a moeda de exibição
    if (displayCurrency === 'BRL') {
      totalAvailableConverted += convertAmount(balance, nativeCurrency, 'BRL');
    } else if (displayCurrency === nativeCurrency) {
      // Soma apenas se a moeda nativa da plataforma for a mesma da exibição
      totalAvailableConverted += balance;
    }

    tb.innerHTML += `
      <tr>
        <td>${platform}</td>
        <td>${fmt(balance, nativeCurrency)}</td>
        <td>${fmt(threshold, nativeCurrency)}</td>
        <td>
          <div style="width: 100%; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden;">
            <div style="width: ${Math.min(100, progress)}%; background: var(--gradient-accent); color: white; text-align: right; padding: 2px 5px; font-size: 12px; min-width: 25px; white-space: nowrap;">
              ${progress.toFixed(0)}%
            </div>
          </div>
        </td>
      </tr>`;
  }

  const kpiEl = document.getElementById('kpiAvailableBalance');
  if (kpiEl) {
    // Usa a função fmt() para formatar o valor na moeda de exibição correta
    kpiEl.textContent = fmt(totalAvailableConverted);
  }
}


// ======== FUNÇÃO MODIFICADA (Request 2) ========
function renderTables(state){
  const {platforms, total, rows, totalBruto} = state;
  const tblPlatformsBody = document.querySelector('#tblPlatforms tbody');
  let totalAReceber = 0;

  tblPlatformsBody.innerHTML = platforms.map(p=>{
    const pct = total? ((p.val/total)*100).toFixed(1) : '0.0';
    
    // Lógica para a nova coluna "A Receber"
    const nativeBalance = availableBalances[p.name] || 0;
    const nativeCurrency = platformCurrency(p.name);
    let aReceber = 0;

    if (displayCurrency === 'BRL') {
      aReceber = convertAmount(nativeBalance, nativeCurrency, 'BRL');
    } else if (displayCurrency === nativeCurrency) {
      aReceber = nativeBalance;
    }
    
    totalAReceber += aReceber;

    return `<tr>
              <td>${p.name}</td>
              <td>${fmt(p.bruto)}</td>
              <td>${fmt(p.val)}</td>
              <td>${fmt(aReceber)}</td>
              <td>${pct}%</td>
            </tr>`;
  }).join('');
  
  // Atualiza os totais no rodapé da tabela
  document.getElementById('tblTotal').textContent = fmt(total);
  document.getElementById('tblTotalBruto').textContent = fmt(totalBruto);
  document.getElementById('tblTotalAReceber').textContent = fmt(totalAReceber);
  
  // Tabela de Movimentação Mensal (sem alterações)
  const tblMonths = document.getElementById('tblMonths');
  tblMonths.querySelector('thead').innerHTML = `
    <tr>
        <th>Mês/Ano</th>
        <th>Bruto</th>
        <th>Líquido</th>
    </tr>`;
  
  const monthAgg = new Map();
  rows.forEach(d=>{
    const k = `${d.year}-${String(d.month_num).padStart(2,'0')}`;
    const o = monthAgg.get(k) || { bruto:0, liquido:0, year:d.year, month:d.month_num };
    o.bruto += d.amount_conv_bruto; o.liquido += d.amount_conv; monthAgg.set(k,o);
  });
  tblMonths.querySelector('tbody').innerHTML = [...monthAgg.values()].sort((a,b)=> (b.year - a.year) || (b.month - a.month)).map(s=>{
    return `<tr><td>${PT_MONTHS[s.month-1]}/${s.year}</td><td>${fmt(s.bruto)}</td><td>${fmt(s.liquido)}</td></tr>`;
  }).join('');
}

function renderKpis(state){
  const {total, avg, best, worst, countMonths} = state;
  document.getElementById('kpiTotal').textContent = fmt(total);
  document.getElementById('kpiAvg').textContent = fmt(avg);
  document.getElementById('kpiCount').textContent = `${countMonths} mês(es)`;
  
  document.getElementById('kpiBest').textContent = best ? fmt(best.value) : '—';
  document.getElementById('kpiBestInfo').textContent = best ? `${PT_MONTHS[best.month-1]}/${best.year}` : '';
  
  document.getElementById('kpiWorst').textContent = worst ? fmt(worst.value) : '—';
  document.getElementById('kpiWorstInfo').textContent = worst ? `${PT_MONTHS[worst.month-1]}/${worst.year}`: '';
}
function renderCharts(state){
  const lineCtx = document.getElementById('lineTotals').getContext('2d');
  const barCtx = document.getElementById('barPlatforms').getContext('2d');
  Chart.defaults.color = '#cbd5e1'; Chart.defaults.borderColor = 'rgba(59, 130, 246, 0.2)';
  if (LINE) LINE.destroy();
  LINE = new Chart(lineCtx, { type: 'line', data: { labels: state.series.map(s=> `${PT_MONTHS[s.month-1].slice(0,3)}/${String(s.year).slice(2)}`), datasets: [{ label: `Ganhos por Mês (${displayCurrency})`, data: state.series.map(s=>s.value), tension: 0.4, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true }] }, options: { responsive: true, maintainAspectRatio: false } });
  if (BAR) BAR.destroy();
  BAR = new Chart(barCtx, { type: 'bar', data: { labels: state.platforms.map(p=>p.name), datasets: [{ label: `Ganhos por Plataforma (${displayCurrency})`, data: state.platforms.map(p=>p.val), backgroundColor: state.platforms.map((_, i) => `hsl(${(i * 137.5) % 360}, 70%, 60%)`) }] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y' } });
}

function render(){
  const state = compute();
  renderKpis(state);
  renderCharts(state);
  renderTables(state);
  renderAvailableBalance();
}

load();