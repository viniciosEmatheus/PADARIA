// =============================================
// AUTH — nome da padaria no sidebar
// =============================================
const nomePadaria = localStorage.getItem('nome_padaria');
const elNome = document.getElementById('sidebar-nome-padaria');
if (elNome && nomePadaria) elNome.textContent = nomePadaria;

// =============================================
// API FETCH — injeta o token em todas as chamadas
// =============================================
async function apiFetch(url, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
  };
  return fetch(url, { ...options, headers });
}

// =============================================
// TOAST
// =============================================
function toast(mensagem, tipo = 'success') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  const icones = { success: '✔', error: '✖', info: 'ℹ' };
  el.innerHTML = `<span>${icones[tipo] || '•'}</span><span>${mensagem}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    el.addEventListener('animationend', () => el.remove());
  }, 3500);
}

// =============================================
// UTILITÁRIO: formatar moeda BRL
// =============================================
function fmt(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
}

// =============================================
// CARREGAR PEDIDOS
// =============================================
async function carregarPedidos() {
  try {
    const resposta = await apiFetch('/pedidos');
    if (!resposta) return;
    const pedidos = await resposta.json();
    if (!Array.isArray(pedidos)) return;

    const hoje = new Date().toISOString().split('T')[0];
    const pedidosHoje = pedidos.filter(p => p.created_at && p.created_at.startsWith(hoje));

    // Dashboard — faturamento do dia
    const dashSaldo = document.getElementById('dash-saldo-dia');
    if (dashSaldo) {
      const totalHoje = pedidosHoje.reduce((acc, p) => acc + (p.valor_total || 0), 0);
      dashSaldo.innerText = fmt(totalHoje);
    }

    // Dashboard — entradas do mês (real)
    const mesAtual = new Date().toISOString().slice(0, 7);
    const pedidosMes = pedidos.filter(p => p.created_at && p.created_at.startsWith(mesAtual));
    const totalMes = pedidosMes.reduce((acc, p) => acc + (p.valor_total || 0), 0);
    const dashEnt = document.getElementById('dash-entradas-mes');
    if (dashEnt) dashEnt.innerText = fmt(totalMes);

    // Mini-tabela do dashboard
    atualizarDashVendas(pedidosHoje);

    // Tabela histórico do dia
    const tabelaHoje = document.querySelector('#tabela-pedidos tbody');
    const emptyHoje  = document.getElementById('pedidos-empty');
    if (tabelaHoje) {
      tabelaHoje.innerHTML = '';
      pedidosHoje.forEach(p => {
        const nome = p.produtos ? p.produtos.nome : `Produto #${p.produto_id}`;
        tabelaHoje.innerHTML += `
          <tr>
            <td><span class="badge badge-success">#${p.id}</span></td>
            <td>${nome}</td>
            <td>${p.quantidade} un</td>
            <td class="fw-bold">${fmt(p.valor_total)}</td>
          </tr>`;
      });
      if (emptyHoje) emptyHoje.style.display = pedidosHoje.length ? 'none' : 'block';
    }

    // Tabela transações (todas)
    const tabelaTrans = document.querySelector('#tabela-transacoes tbody');
    const emptyTrans  = document.getElementById('transacoes-empty');
    if (tabelaTrans) {
      tabelaTrans.innerHTML = '';
      pedidos.forEach(p => {
        const nome = p.produtos ? p.produtos.nome : `Produto #${p.produto_id}`;
        const data = p.created_at ? new Date(p.created_at).toLocaleString('pt-BR') : '—';
        tabelaTrans.innerHTML += `
          <tr>
            <td><span class="badge badge-success">#${p.id}</span></td>
            <td>${nome}</td>
            <td>${p.quantidade} un</td>
            <td class="fw-bold">${fmt(p.valor_total)}</td>
            <td class="text-muted">${data}</td>
          </tr>`;
      });
      if (emptyTrans) emptyTrans.style.display = pedidos.length ? 'none' : 'block';
    }

    // Guarda pedidos para os gráficos
    window._pedidosCache = pedidos;
    renderizarGraficos(pedidos);

  } catch (err) {
    console.error('Erro ao buscar pedidos:', err);
  }
}

// =============================================
// CARREGAR PRODUTOS / ESTOQUE
// =============================================
async function carregarProdutos() {
  try {
    const resposta = await apiFetch('/produtos');
    if (!resposta) return;
    const produtos = await resposta.json();

    const tabelaBody     = document.querySelector('#tabela-produtos tbody');
    const loading        = document.getElementById('loading');
    const selectProdutos = document.getElementById('pedido-produto');

    if (!Array.isArray(produtos)) {
      if (loading) loading.innerText = 'Erro no servidor.';
      return;
    }

    if (tabelaBody)     tabelaBody.innerHTML = '';
    if (loading)        loading.style.display = 'none';
    if (selectProdutos) selectProdutos.innerHTML = '<option value="">Selecione o produto...</option>';

    const dashTotal = document.getElementById('dash-total-produtos');
    if (dashTotal) dashTotal.innerText = produtos.length;

    let alertasValidade = 0;
    let produtoMaisEstoque = { nome: '—', estoque: 0 };

    produtos.forEach(produto => {
      if ((produto.estoque || 0) > produtoMaisEstoque.estoque) produtoMaisEstoque = produto;

      let textoValidade = '<span class="text-muted">Sem data</span>';
      if (produto.validade) {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const dataVenc = new Date(produto.validade + 'T00:00:00Z');
        const diffDias = Math.ceil((dataVenc - hoje) / 86400000);
        const dataFmt  = dataVenc.toLocaleDateString('pt-BR', { timeZone: 'UTC' });

        if (diffDias < 0) {
          textoValidade = `<span class="badge badge-danger">🚨 Vencido (${dataFmt})</span>`;
          alertasValidade++;
        } else if (diffDias <= 7) {
          textoValidade = `<span class="badge badge-warning">⚠ Vence em ${diffDias}d (${dataFmt})</span>`;
          alertasValidade++;
        } else {
          textoValidade = `<span class="badge badge-success">${dataFmt}</span>`;
        }
      }

      if (tabelaBody) {
        tabelaBody.innerHTML += `
          <tr>
            <td class="text-muted">${produto.id}</td>
            <td class="fw-bold">${produto.nome}</td>
            <td>${fmt(produto.preco)}</td>
            <td>${produto.estoque ?? 0} un</td>
            <td>${textoValidade}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-edit" onclick="abrirModalEditar(${produto.id})">✏️ Editar</button>
              <button class="btn btn-danger" onclick="excluirProduto(${produto.id})">🗑</button>
            </td>
          </tr>`;
      }

      if (selectProdutos) {
        const opt = document.createElement('option');
        opt.value = produto.id;
        opt.dataset.preco = produto.preco;
        opt.dataset.estoque = produto.estoque ?? 0;
        opt.textContent = `${produto.nome} — ${fmt(produto.preco)} (${produto.estoque ?? 0} un)`;
        selectProdutos.appendChild(opt);
      }
    });

    const lblMaiorVolume = document.getElementById('estoque-maior-volume');
    const lblAlertas     = document.getElementById('estoque-alertas-validade');
    if (lblMaiorVolume) lblMaiorVolume.innerText = `${produtoMaisEstoque.nome} (${produtoMaisEstoque.estoque} un)`;
    if (lblAlertas)     lblAlertas.innerText = alertasValidade;

    atualizarDashAlertas(produtos);

    // Salva cache e re-renderiza gráficos com funil atualizado
    window._produtosCache = produtos;
    if (window._pedidosCache) renderizarGraficos(window._pedidosCache);

    // Capital em estoque no financeiro
    const capital = produtos.reduce((acc, p) => acc + (p.preco * (p.estoque || 0)), 0);
    const lblCap = document.getElementById('fin-custo-estoque');
    if (lblCap) lblCap.innerText = fmt(capital);

  } catch (err) {
    console.error('Erro ao buscar produtos:', err);
  }
}

// =============================================
// CADASTRAR PRODUTO
// =============================================
const formProduto = document.getElementById('form-produto');
if (formProduto) {
  formProduto.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome     = document.getElementById('nome').value;
    const preco    = parseFloat(document.getElementById('preco').value);
    const estoque  = parseInt(document.getElementById('estoque').value);
    const validade = document.getElementById('validade')?.value ?? '';

    try {
      const resposta = await apiFetch('/produtos', {
        method: 'POST',
        body: JSON.stringify({ nome, preco, estoque, validade })
      });
      if (!resposta) return;

      if (resposta.ok) {
        toast('Produto cadastrado com sucesso!');
        formProduto.reset();
        carregarProdutos();
      } else {
        const err = await resposta.text();
        toast('Falha no cadastro: ' + err, 'error');
      }
    } catch (err) {
      toast('Erro de comunicação com o servidor.', 'error');
    }
  });
}

// =============================================
// EXCLUIR PRODUTO
// =============================================
async function excluirProduto(id) {
  if (!confirm('Excluir este produto do estoque?')) return;
  try {
    const resposta = await apiFetch(`/produtos/${id}`, { method: 'DELETE' });
    if (!resposta) return;
    if (resposta.ok) {
      toast('Produto excluído.');
      carregarProdutos();
    } else {
      toast('Erro ao excluir produto.', 'error');
    }
  } catch {
    toast('Erro de comunicação com o servidor.', 'error');
  }
}

// =============================================
// EDITAR PRODUTO — MODAL
// =============================================
function abrirModalEditar(id) {
  const produto = (window._produtosCache || []).find(p => p.id === id);
  if (!produto) return;
  document.getElementById('edit-id').value      = produto.id;
  document.getElementById('edit-nome').value    = produto.nome;
  document.getElementById('edit-preco').value   = produto.preco;
  document.getElementById('edit-estoque').value = produto.estoque ?? 0;
  document.getElementById('edit-validade').value = produto.validade || '';
  document.getElementById('modal-editar').classList.add('aberto');
}

function fecharModalEditar() {
  document.getElementById('modal-editar').classList.remove('aberto');
}

const formEditar = document.getElementById('form-editar-produto');
if (formEditar) {
  formEditar.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id       = parseInt(document.getElementById('edit-id').value);
    const nome     = document.getElementById('edit-nome').value;
    const preco    = parseFloat(document.getElementById('edit-preco').value);
    const estoque  = parseInt(document.getElementById('edit-estoque').value);
    const validade = document.getElementById('edit-validade').value;
    try {
      const resposta = await apiFetch(`/produtos/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ nome, preco, estoque, validade })
      });
      if (!resposta) return;
      if (resposta.ok) {
        toast('Produto atualizado com sucesso!');
        fecharModalEditar();
        carregarProdutos();
      } else {
        const err = await resposta.json();
        toast(err.detail || 'Erro ao atualizar produto.', 'error');
      }
    } catch {
      toast('Erro de comunicação com o servidor.', 'error');
    }
  });
}

// =============================================
// REGISTRAR PEDIDO (VENDA)
// =============================================
const formPedido = document.getElementById('form-pedido');
if (formPedido) {
  formPedido.addEventListener('submit', async (e) => {
    e.preventDefault();
    const select = document.getElementById('pedido-produto');
    if (!select.value) {
      toast('Selecione um produto.', 'info');
      return;
    }

    const produtoId     = parseInt(select.value);
    const quantidade    = parseInt(document.getElementById('pedido-quantidade').value);
    const opcao         = select.options[select.selectedIndex];
    const precoUnitario = parseFloat(opcao.dataset.preco);
    const estoqueDisp   = parseInt(opcao.dataset.estoque || 0);
    const valorTotal    = precoUnitario * quantidade;

    if (quantidade > estoqueDisp) {
      toast(`Estoque insuficiente: apenas ${estoqueDisp} unidade(s) disponíveis.`, 'error');
      return;
    }

    try {
      const resposta = await apiFetch('/pedidos', {
        method: 'POST',
        body: JSON.stringify({ produto_id: produtoId, quantidade, valor_total: valorTotal })
      });
      if (!resposta) return;

      if (resposta.ok) {
        toast('Venda registrada com sucesso!');
        formPedido.reset();
        const preview = document.getElementById('venda-total-preview');
        if (preview) preview.style.display = 'none';
        carregarProdutos();
        carregarPedidos();
        carregarFinanceiro();
      } else {
        const err = await resposta.text();
        toast('Erro ao registrar venda: ' + err, 'error');
      }
    } catch {
      toast('Erro de comunicação com o servidor.', 'error');
    }
  });
}

// =============================================
// FINANCEIRO — dados reais
// =============================================
async function carregarFinanceiro() {
  try {
    const [resProdutos, resPedidos] = await Promise.all([
      apiFetch('/produtos'),
      apiFetch('/pedidos')
    ]);
    if (!resProdutos || !resPedidos) return;

    const produtos = await resProdutos.json();
    const pedidos  = await resPedidos.json();

    if (Array.isArray(pedidos)) {
      const faturamentoTotal = pedidos.reduce((acc, p) => acc + (p.valor_total || 0), 0);

      const mesAtual    = new Date().toISOString().slice(0, 7);
      const pedidosMes  = pedidos.filter(p => p.created_at && p.created_at.startsWith(mesAtual));
      const fatMes      = pedidosMes.reduce((acc, p) => acc + (p.valor_total || 0), 0);

      const ticketMedio = pedidos.length > 0 ? faturamentoTotal / pedidos.length : 0;
      const lblFat    = document.getElementById('fin-faturamento-total');
      const lblFatMes = document.getElementById('fin-faturamento-mes');
      const lblTicket = document.getElementById('fin-ticket-medio');
      if (lblFat)    lblFat.innerText    = fmt(faturamentoTotal);
      if (lblFatMes) lblFatMes.innerText = fmt(fatMes);
      if (lblTicket) lblTicket.innerText = fmt(ticketMedio);

      // Dashboard entradas do mês
      const dashEnt = document.getElementById('dash-entradas-mes');
      if (dashEnt) dashEnt.innerText = fmt(fatMes);
    }

    if (Array.isArray(produtos)) {
      const capital = produtos.reduce((acc, p) => acc + (p.preco * (p.estoque || 0)), 0);
      const lblCap = document.getElementById('fin-custo-estoque');
      if (lblCap) lblCap.innerText = fmt(capital);

      // Dashboard saídas (capital em estoque como proxy)
      const dashSai = document.getElementById('dash-saidas-mes');
      if (dashSai) dashSai.innerText = fmt(capital);
    }

  } catch (err) {
    console.error('Erro ao carregar financeiro:', err);
  }
}

// =============================================
// NOTA FISCAL
// =============================================
const arquivoInput = document.getElementById('arquivo-xml');
if (arquivoInput) {
  arquivoInput.addEventListener('change', () => {
    const nomeEl = document.getElementById('nome-arquivo');
    if (nomeEl && arquivoInput.files[0]) nomeEl.textContent = `📄 ${arquivoInput.files[0].name}`;
  });
}

const formNF = document.getElementById('form-nf');
if (formNF) {
  formNF.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!arquivoInput || arquivoInput.files.length === 0) {
      toast('Selecione um arquivo XML primeiro.', 'info');
      return;
    }

    const resultado = document.getElementById('resultado-nf');
    resultado.style.display = 'block';
    resultado.innerHTML = '<span class="text-muted">⏳ Processando nota fiscal...</span>';

    const formData = new FormData();
    formData.append('file', arquivoInput.files[0]);

    try {
      const resposta = await apiFetch('/upload-nf', { method: 'POST', body: formData });
      if (!resposta) return;
      const dados = await resposta.json();

      if (resposta.ok) {
        resultado.innerHTML = `<div class="badge badge-success" style="padding:10px 16px; font-size:13.5px;">✔ ${dados.mensagem}</div>`;
        formNF.reset();
        document.getElementById('nome-arquivo').textContent = '';
        carregarProdutos();
        toast(dados.mensagem);
      } else {
        resultado.innerHTML = `<div class="badge badge-danger" style="padding:10px 16px; font-size:13.5px;">✖ ${dados.detail}</div>`;
        toast(dados.detail, 'error');
      }
    } catch {
      resultado.innerHTML = `<div class="badge badge-danger" style="padding:10px 16px;">✖ Falha na comunicação com o servidor.</div>`;
      toast('Falha na comunicação com o servidor.', 'error');
    }
  });
}

// =============================================
// GRÁFICOS — configuração global
// =============================================
const CHART_CORES = ['#C8813A','#5C3D2E','#27AE60','#3498DB','#E67E22','#9B59B6','#E74C3C'];
const charts = {};
let _periodoAtivo = 7;

// Plugin: texto central no donut
const pluginCenterText = {
  id: 'centerText',
  afterDraw(chart) {
    if (chart.config.type !== 'doughnut' || !chart.config.options._centerText) return;
    const { ctx, chartArea } = chart;
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top  + chartArea.bottom) / 2;
    const val = chart.config.options._centerText;
    ctx.save();
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.fillStyle = '#2C1810';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(val, cx, cy);
    ctx.restore();
  }
};
Chart.register(pluginCenterText);

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

// Média móvel simples
function mediaMovel(arr, janela = 3) {
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i - janela + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

// =============================================
// RENDERIZAR TODOS OS GRÁFICOS
// =============================================
function renderizarGraficos(pedidos) {
  window._pedidosCache = pedidos;
  const produtos = window._produtosCache || [];
  _renderCombinado(pedidos, _periodoAtivo);
  _renderRosca(pedidos);
  _renderRanking(pedidos);
  _renderArea(pedidos);
  _renderFunil(pedidos, produtos);
  _renderDashFat(pedidos);
  _renderDashTop(pedidos);
}

// =============================================
// DASHBOARD — gráfico de barras (fundo escuro)
// =============================================
function _renderDashFat(pedidos) {
  const canvas = document.getElementById('chart-dash-fat');
  if (!canvas) return;

  const labels = [], dados = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const str = d.toISOString().split('T')[0];
    labels.push(d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' }));
    dados.push(
      pedidos.filter(p => p.created_at?.startsWith(str))
             .reduce((a, p) => a + (p.valor_total || 0), 0)
    );
  }

  const ctx2d = canvas.getContext('2d');
  const grad  = ctx2d.createLinearGradient(0, 0, 0, 280);
  grad.addColorStop(0, 'rgba(200,129,58,1)');
  grad.addColorStop(1, 'rgba(200,129,58,0.3)');

  destroyChart('dash-fat');
  charts['dash-fat'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Faturamento',
          data: dados,
          backgroundColor: grad,
          borderRadius: 5,
          order: 2,
        },
        {
          type: 'line',
          label: 'Tendência',
          data: mediaMovel(dados, 3),
          borderColor: 'rgba(255,255,255,0.7)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.45,
          fill: false,
          order: 1,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: 'rgba(255,255,255,0.65)', font: { size: 11 }, boxWidth: 12, padding: 14 }
        },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.raw)}` } }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.07)' },
          ticks: { color: 'rgba(255,255,255,0.5)', callback: (v) => fmt(v), font: { size: 10 } },
          border: { display: false }
        },
        x: {
          grid: { display: false },
          ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 } },
          border: { display: false }
        }
      }
    }
  });
}

// =============================================
// DASHBOARD — ranking CSS top produtos
// =============================================
function _renderDashTop(pedidos) {
  const container = document.getElementById('dash-ranking');
  if (!container) return;

  const mapa = {};
  pedidos.forEach(p => {
    const nome = p.produtos?.nome ?? `#${p.produto_id}`;
    mapa[nome] = (mapa[nome] || 0) + (p.quantidade || 0);
  });

  const sorted = Object.entries(mapa).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (!sorted.length) {
    container.innerHTML = `<p style="color:rgba(255,255,255,.35); font-size:13px;">Nenhuma venda registrada ainda.</p>`;
    return;
  }

  const maxVal = sorted[0][1];

  container.innerHTML = sorted.map(([nome, qty], i) => {
    const pct = ((qty / maxVal) * 100).toFixed(0);
    const cor = CHART_CORES[i] || CHART_CORES[0];
    return `
      <div class="dash-rank-item">
        <div class="dash-rank-info">
          <span class="dash-rank-nome">${nome}</span>
          <span class="dash-rank-valor">${qty} un</span>
        </div>
        <div class="dash-rank-track">
          <div class="dash-rank-fill" style="width:${pct}%; background:${cor};"></div>
        </div>
      </div>`;
  }).join('');
}

// =============================================
// 1. GRÁFICO COMBINADO: Barras + Linha de tendência
// =============================================
function _renderCombinado(pedidos, dias) {
  const canvas = document.getElementById('chart-combinado');
  if (!canvas) return;

  const labels = [], fatDiario = [];
  const agrupado = dias <= 30;

  if (agrupado) {
    // Agrupar por dia
    for (let i = dias - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const str = d.toISOString().split('T')[0];
      labels.push(d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }));
      fatDiario.push(
        pedidos.filter(p => p.created_at?.startsWith(str))
               .reduce((a, p) => a + (p.valor_total || 0), 0)
      );
    }
  } else {
    // Agrupar por semana (últimas 13 semanas)
    for (let i = 12; i >= 0; i--) {
      const inicio = new Date();
      inicio.setDate(inicio.getDate() - i * 7 - 6);
      const fim = new Date();
      fim.setDate(fim.getDate() - i * 7);
      const label = `Sem ${13 - i}`;
      labels.push(label);
      fatDiario.push(
        pedidos.filter(p => {
          if (!p.created_at) return false;
          const d = new Date(p.created_at);
          return d >= inicio && d <= fim;
        }).reduce((a, p) => a + (p.valor_total || 0), 0)
      );
    }
  }

  const janela = dias <= 7 ? 3 : dias <= 30 ? 7 : 3;
  const media  = mediaMovel(fatDiario, janela);

  const labelEl = document.getElementById('chart-combinado-label');
  if (labelEl) {
    labelEl.textContent = dias <= 30 ? `Últimos ${dias} dias` : 'Últimas 13 semanas';
  }

  destroyChart('combinado');

  // Gradiente nas barras
  const ctx2d = canvas.getContext('2d');
  const grad  = ctx2d.createLinearGradient(0, 0, 0, 300);
  grad.addColorStop(0, 'rgba(200,129,58,0.90)');
  grad.addColorStop(1, 'rgba(200,129,58,0.35)');

  charts['combinado'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Faturamento',
          data: fatDiario,
          backgroundColor: grad,
          borderRadius: 5,
          order: 2,
        },
        {
          type: 'line',
          label: `Média ${janela}d`,
          data: media,
          borderColor: '#5C3D2E',
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: '#5C3D2E',
          tension: 0.45,
          fill: false,
          order: 1,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { padding: 16, font: { size: 12 } } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.raw)}` } }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: { callback: (v) => fmt(v), font: { size: 11 } }
        },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

// =============================================
// 2. GRÁFICO ROSCA: Receita por produto
// =============================================
function _renderRosca(pedidos) {
  const canvas = document.getElementById('chart-rosca');
  if (!canvas) return;

  const mapa = {};
  pedidos.forEach(p => {
    const nome = p.produtos?.nome ?? `#${p.produto_id}`;
    mapa[nome] = (mapa[nome] || 0) + (p.valor_total || 0);
  });

  const sorted = Object.entries(mapa).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!sorted.length) return;

  const totalReceita = sorted.reduce((a, [, v]) => a + v, 0);

  destroyChart('rosca');
  charts['rosca'] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{
        data: sorted.map(([, v]) => v),
        backgroundColor: CHART_CORES,
        borderWidth: 3,
        borderColor: '#FFFFFF',
        hoverBorderWidth: 3,
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      _centerText: fmt(totalReceita),
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 12, font: { size: 11 }, boxWidth: 12 }
        },
        tooltip: {
          callbacks: {
            label: (c) => ` ${c.label}: ${fmt(c.raw)} (${((c.raw / totalReceita) * 100).toFixed(1)}%)`
          }
        }
      }
    }
  });
}

// =============================================
// 3. BARRAS HORIZONTAIS: Ranking por quantidade
// =============================================
function _renderRanking(pedidos) {
  const canvas = document.getElementById('chart-ranking');
  if (!canvas) return;

  const mapa = {};
  pedidos.forEach(p => {
    const nome = p.produtos?.nome ?? `#${p.produto_id}`;
    mapa[nome] = (mapa[nome] || 0) + (p.quantidade || 0);
  });

  const sorted = Object.entries(mapa).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!sorted.length) return;

  destroyChart('ranking');
  charts['ranking'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{
        label: 'Unidades vendidas',
        data: sorted.map(([, v]) => v),
        backgroundColor: CHART_CORES.map(c => c + 'CC'),
        borderColor: CHART_CORES,
        borderWidth: 1.5,
        borderRadius: 5,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${c.raw} unidades` } }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: { font: { size: 11 } }
        },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

// =============================================
// 4. ÁREA ACUMULADA: Tendência de receita
// =============================================
function _renderArea(pedidos) {
  const canvas = document.getElementById('chart-area');
  if (!canvas) return;

  // Agrupa por semana (últimas 8 semanas)
  const labels = [], dados = [];
  for (let i = 7; i >= 0; i--) {
    const inicio = new Date(); inicio.setDate(inicio.getDate() - i * 7 - 6);
    const fim    = new Date(); fim.setDate(fim.getDate() - i * 7);
    labels.push(`Sem ${8 - i}`);
    dados.push(
      pedidos.filter(p => {
        if (!p.created_at) return false;
        const d = new Date(p.created_at);
        return d >= inicio && d <= fim;
      }).reduce((a, p) => a + (p.valor_total || 0), 0)
    );
  }

  const ctx2d  = canvas.getContext('2d');
  const areaGrad = ctx2d.createLinearGradient(0, 0, 0, 250);
  areaGrad.addColorStop(0, 'rgba(200,129,58,0.35)');
  areaGrad.addColorStop(1, 'rgba(200,129,58,0.00)');

  destroyChart('area');
  charts['area'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Receita Semanal',
        data: dados,
        borderColor: '#C8813A',
        borderWidth: 2.5,
        backgroundColor: areaGrad,
        fill: true,
        tension: 0.45,
        pointRadius: 5,
        pointBackgroundColor: '#FFFFFF',
        pointBorderColor: '#C8813A',
        pointBorderWidth: 2.5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${fmt(c.raw)}` } }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: { callback: (v) => fmt(v), font: { size: 11 } }
        },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

// =============================================
// 5. FUNIL CSS: Funil de atividade de vendas
// =============================================
function _renderFunil(pedidos, produtos) {
  const container = document.getElementById('funil-container');
  if (!container) return;

  const hoje  = new Date().toISOString().split('T')[0];
  const mes   = new Date().toISOString().slice(0, 7);
  const semIni = new Date(); semIni.setDate(semIni.getDate() - 7);

  const stages = [
    {
      label: 'Produtos Cadastrados',
      value: produtos.length,
      fmt: (v) => `${v} itens`,
      cor: '#C8813A',
    },
    {
      label: 'Pedidos Totais',
      value: pedidos.length,
      fmt: (v) => `${v} pedidos`,
      cor: '#5C3D2E',
    },
    {
      label: 'Pedidos este Mês',
      value: pedidos.filter(p => p.created_at?.startsWith(mes)).length,
      fmt: (v) => `${v} pedidos`,
      cor: '#3498DB',
    },
    {
      label: 'Pedidos Hoje',
      value: pedidos.filter(p => p.created_at?.startsWith(hoje)).length,
      fmt: (v) => `${v} pedidos`,
      cor: '#27AE60',
    },
  ];

  const maxVal = Math.max(...stages.map(s => s.value), 1);

  container.innerHTML = stages.map((s, i) => {
    const pct = Math.max(((s.value / maxVal) * 100), 12).toFixed(0);
    const convPct = i === 0 ? '100%'
      : stages[i - 1].value > 0
        ? ((s.value / stages[i - 1].value) * 100).toFixed(0) + '%'
        : '—';

    return `
      <div class="funil-stage">
        <div class="funil-bar-col">
          <div class="funil-bar-track">
            <div class="funil-bar-fill" style="width:${pct}%; background:${s.cor};">
              ${s.fmt(s.value)}
            </div>
          </div>
        </div>
        <div class="funil-meta">
          <div class="funil-label">${s.label}</div>
          <div class="funil-value">${s.fmt(s.value)}</div>
          <div class="funil-pct">${i > 0 ? `conv. ${convPct}` : 'base'}</div>
        </div>
      </div>`;
  }).join('');
}

// =============================================
// SELETOR DE PERÍODO
// =============================================
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('ativo'));
    btn.classList.add('ativo');
    _periodoAtivo = parseInt(btn.dataset.period);
    if (window._pedidosCache) _renderCombinado(window._pedidosCache, _periodoAtivo);
  });
});

// =============================================
// DASHBOARD — saudação e data
// =============================================
function inicializarDashboard() {
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const elSaudacao = document.getElementById('dash-saudacao');
  if (elSaudacao) elSaudacao.textContent = saudacao;

  const elData = document.getElementById('dash-data-hoje');
  if (elData) {
    elData.textContent = new Date().toLocaleDateString('pt-BR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  }
}

// =============================================
// DASHBOARD — mini tabela de vendas
// =============================================
function atualizarDashVendas(pedidosHoje) {
  const tbody   = document.querySelector('#tabela-dash-vendas tbody');
  const emptyEl = document.getElementById('dash-vendas-empty');
  if (!tbody) return;

  tbody.innerHTML = '';
  const recentes = pedidosHoje.slice(0, 5);
  recentes.forEach(p => {
    const nome = p.produtos ? p.produtos.nome : `Produto #${p.produto_id}`;
    tbody.innerHTML += `
      <tr>
        <td class="fw-bold">${nome}</td>
        <td>${p.quantidade} un</td>
        <td>${fmt(p.valor_total)}</td>
      </tr>`;
  });
  if (emptyEl) emptyEl.style.display = recentes.length ? 'none' : 'block';
}

// =============================================
// DASHBOARD — alertas de validade
// =============================================
function atualizarDashAlertas(produtos) {
  const container = document.getElementById('dash-alertas-lista');
  if (!container) return;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const alertas = produtos
    .filter(p => {
      if (!p.validade) return false;
      const diffDias = Math.ceil((new Date(p.validade + 'T00:00:00Z') - hoje) / 86400000);
      return diffDias <= 7;
    })
    .sort((a, b) => new Date(a.validade) - new Date(b.validade));

  if (alertas.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:24px 0;">
        <div class="empty-icon">✅</div>
        Nenhum produto vencendo em breve.
      </div>`;
    return;
  }

  container.innerHTML = alertas.map(p => {
    const diffDias   = Math.ceil((new Date(p.validade + 'T00:00:00Z') - hoje) / 86400000);
    const badgeClass = diffDias < 0 ? 'badge-danger' : 'badge-warning';
    const texto      = diffDias < 0 ? 'Vencido' : `Vence em ${diffDias}d`;
    return `
      <div class="dash-alerta-item">
        <div>
          <div class="dash-alerta-nome">${p.nome}</div>
          <div class="dash-alerta-sub">${p.estoque ?? 0} un em estoque</div>
        </div>
        <span class="badge ${badgeClass}">${texto}</span>
      </div>`;
  }).join('');
}

// =============================================
// NAVEGAÇÃO DE ABAS
// =============================================
function navegarPara(idAba) {
  const btn = document.querySelector(`.menu-btn[onclick*="${idAba}"]`);
  if (btn) btn.click();
  else abrirAba(null, idAba);
}

function abrirAba(evento, idDaAba) {
  document.querySelectorAll('.aba').forEach(a => a.classList.remove('ativa'));
  document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('ativo'));
  document.getElementById(idDaAba).classList.add('ativa');
  if (evento) evento.currentTarget.classList.add('ativo');

  // Re-renderiza ao abrir o financeiro (Chart.js precisa do tamanho do canvas visível)
  if (idDaAba === 'aba-financeiro' && window._pedidosCache) {
    setTimeout(() => {
      Object.values(charts).forEach(c => c.resize());
      renderizarGraficos(window._pedidosCache);
    }, 50);
  }
}

// =============================================
// BUSCA / FILTRO DE PRODUTOS
// =============================================
function filtrarProdutos() {
  const busca = (document.getElementById('busca-produto')?.value || '').toLowerCase();
  const linhas = document.querySelectorAll('#tabela-produtos tbody tr');
  linhas.forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(busca) ? '' : 'none';
  });
}

// =============================================
// PREVIEW DO TOTAL NA VENDA
// =============================================
function atualizarPreviewVenda() {
  const select  = document.getElementById('pedido-produto');
  const qtdEl   = document.getElementById('pedido-quantidade');
  const preview = document.getElementById('venda-total-preview');
  const valorEl = document.getElementById('venda-total-valor');
  if (!select || !qtdEl || !preview || !valorEl) return;

  const preco = parseFloat(select.options[select.selectedIndex]?.dataset.preco || 0);
  const qty   = parseInt(qtdEl.value || 0);

  if (preco > 0 && qty > 0) {
    valorEl.textContent = fmt(preco * qty);
    preview.style.display = 'flex';
  } else {
    preview.style.display = 'none';
  }
}

document.getElementById('pedido-produto')?.addEventListener('change', atualizarPreviewVenda);
document.getElementById('pedido-quantidade')?.addEventListener('input', atualizarPreviewVenda);

// =============================================
// INICIALIZAÇÃO
// =============================================
inicializarDashboard();
carregarProdutos();
carregarPedidos();
carregarFinanceiro();
