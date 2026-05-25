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
  const token = localStorage.getItem('token');
  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
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

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// =============================================
// CARREGAR PEDIDOS
// =============================================
async function carregarPedidos() {
  try {
    const resposta = await apiFetch('/api/pedidos');
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

    // Dashboard — entradas do mês
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
            <td>${escapeHtml(nome)}</td>
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
            <td>${escapeHtml(nome)}</td>
            <td>${p.quantidade} un</td>
            <td class="fw-bold">${fmt(p.valor_total)}</td>
            <td class="text-muted">${data}</td>
          </tr>`;
      });
      if (emptyTrans) emptyTrans.style.display = pedidos.length ? 'none' : 'block';
    }

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
    const resposta = await apiFetch('/api/produtos');
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
            <td class="fw-bold">${escapeHtml(produto.nome)}</td>
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

    window._produtosCache = produtos;
    if (window._pedidosCache) renderizarGraficos(window._pedidosCache);

    // Atualiza o caixa se estiver aberto
    if (document.getElementById('aba-caixa')?.classList.contains('ativa')) {
      carregarCaixa();
    }

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
      const resposta = await apiFetch('/api/produtos', {
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
    const resposta = await apiFetch(`/api/produtos/${id}`, { method: 'DELETE' });
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
      const resposta = await apiFetch(`/api/produtos/${id}`, {
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
// REGISTRAR PEDIDO (aba Pedidos — item único)
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
      const resposta = await apiFetch('/api/pedidos', {
        method: 'POST',
        body: JSON.stringify({ produto_id: produtoId, quantidade })
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
      apiFetch('/api/produtos'),
      apiFetch('/api/pedidos')
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

      const dashEnt = document.getElementById('dash-entradas-mes');
      if (dashEnt) dashEnt.innerText = fmt(fatMes);
    }

    if (Array.isArray(produtos)) {
      const capital = produtos.reduce((acc, p) => acc + (p.preco * (p.estoque || 0)), 0);
      const lblCap = document.getElementById('fin-custo-estoque');
      if (lblCap) lblCap.innerText = fmt(capital);

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
      const resposta = await apiFetch('/api/upload-nf', { method: 'POST', body: formData });
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
// CAIXA DE VENDA — Estado global
// =============================================
window._carrinho = []; // [{ produto_id, nome, preco, quantidade }]
let _formaPagamento = 'dinheiro';
let _sessaoCaixa    = null;

const ICONES_PADARIA = ['🍞', '🥐', '🧁', '🎂', '🥖', '🍰', '🥨', '🧇', '🥞', '☕', '🍩', '🧆'];

function carregarCaixa() {
  const produtos = window._produtosCache || [];
  const busca    = (document.getElementById('caixa-busca')?.value || '').toLowerCase();
  const grid     = document.getElementById('caixa-grid');
  if (!grid) return;

  const loading = document.getElementById('caixa-loading');
  if (loading) loading.style.display = 'none';

  const filtrados = busca
    ? produtos.filter(p => p.nome.toLowerCase().includes(busca))
    : produtos;

  if (filtrados.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📦</div>${produtos.length === 0 ? 'Nenhum produto cadastrado.' : 'Nenhum produto encontrado.'}</div>`;
    return;
  }

  const cartMap = {};
  window._carrinho.forEach(item => { cartMap[item.produto_id] = item.quantidade; });

  grid.innerHTML = filtrados.map(p => {
    const semEstoque = (p.estoque || 0) <= 0;
    const noCarrinho = cartMap[p.id] || 0;
    const icone      = ICONES_PADARIA[p.id % ICONES_PADARIA.length];

    return `
      <div class="caixa-produto-card${semEstoque ? ' no-stock' : ''}"
           onclick="${semEstoque ? '' : `adicionarAoCarrinho(${p.id})`}"
           title="${semEstoque ? 'Sem estoque' : escapeHtml(p.nome) + ' — clique para adicionar'}">
        ${noCarrinho > 0 ? `<span class="caixa-card-qty-badge">${noCarrinho}</span>` : ''}
        <span class="caixa-card-icone">${icone}</span>
        <div class="caixa-card-nome">${escapeHtml(p.nome)}</div>
        <div class="caixa-card-preco">${fmt(p.preco)}</div>
        <div class="caixa-card-estoque">
          ${semEstoque
            ? '<span class="caixa-card-badge-sem">Sem estoque</span>'
            : `${p.estoque} em estoque`}
        </div>
      </div>`;
  }).join('');
}

function filtrarCaixa() {
  carregarCaixa();
}

function adicionarAoCarrinho(produtoId) {
  const produtos = window._produtosCache || [];
  const produto  = produtos.find(p => p.id === produtoId);
  if (!produto || (produto.estoque || 0) <= 0) return;

  const existente    = window._carrinho.find(i => i.produto_id === produtoId);
  const qtyNoCarrinho = existente ? existente.quantidade : 0;

  if (qtyNoCarrinho >= (produto.estoque || 0)) {
    toast(`Estoque máximo atingido: ${produto.estoque} unidade(s)`, 'error');
    return;
  }

  if (existente) {
    existente.quantidade++;
  } else {
    window._carrinho.push({
      produto_id: produto.id,
      nome:       produto.nome,
      preco:      produto.preco,
      quantidade: 1
    });
  }

  renderizarCarrinho();
  carregarCaixa();
}

function alterarQuantidadeCaixa(produtoId, delta) {
  const item    = window._carrinho.find(i => i.produto_id === produtoId);
  if (!item) return;

  const produto    = (window._produtosCache || []).find(p => p.id === produtoId);
  const estoqueMax = produto ? (produto.estoque || 0) : 999;

  item.quantidade += delta;

  if (item.quantidade <= 0) {
    window._carrinho = window._carrinho.filter(i => i.produto_id !== produtoId);
  } else if (item.quantidade > estoqueMax) {
    item.quantidade = estoqueMax;
    toast(`Máximo de ${estoqueMax} unidade(s) em estoque`, 'info');
  }

  renderizarCarrinho();
  carregarCaixa();
}

function removerDoCarrinho(produtoId) {
  window._carrinho = window._carrinho.filter(i => i.produto_id !== produtoId);
  renderizarCarrinho();
  carregarCaixa();
}

function limparCarrinho() {
  if (window._carrinho.length === 0) return;
  window._carrinho = [];
  renderizarCarrinho();
  carregarCaixa();
}

function renderizarCarrinho() {
  const itensEl = document.getElementById('caixa-itens');
  const vazioEl = document.getElementById('caixa-vazio');
  const totalEl = document.getElementById('caixa-total');
  const btnFin  = document.getElementById('btn-finalizar-venda');
  if (!itensEl) return;

  const total = window._carrinho.reduce((acc, i) => acc + (i.preco * i.quantidade), 0);

  if (window._carrinho.length === 0) {
    itensEl.innerHTML = '';
    if (vazioEl) vazioEl.style.display = 'block';
    if (totalEl) totalEl.textContent   = 'R$ 0,00';
    if (btnFin)  btnFin.disabled = true;
    const trocoEl = document.getElementById('caixa-troco-display');
    if (trocoEl) trocoEl.style.display = 'none';
    return;
  }

  if (vazioEl) vazioEl.style.display = 'none';
  if (totalEl) totalEl.textContent = fmt(total);
  if (btnFin)  btnFin.disabled = false;

  itensEl.innerHTML = window._carrinho.map(item => `
    <div class="caixa-item">
      <div class="caixa-item-info">
        <div class="caixa-item-nome">${escapeHtml(item.nome)}</div>
        <div class="caixa-item-sub">${fmt(item.preco)} / un</div>
      </div>
      <div class="caixa-item-controles">
        <button class="caixa-qty-btn" onclick="alterarQuantidadeCaixa(${item.produto_id}, -1)">−</button>
        <span class="caixa-qty-num">${item.quantidade}</span>
        <button class="caixa-qty-btn" onclick="alterarQuantidadeCaixa(${item.produto_id}, +1)">+</button>
      </div>
      <div class="caixa-item-total">${fmt(item.preco * item.quantidade)}</div>
      <button class="caixa-item-del" onclick="removerDoCarrinho(${item.produto_id})" title="Remover">✕</button>
    </div>`).join('');

  calcularTroco();
}

function selecionarPagamento(tipo) {
  _formaPagamento = tipo;
  document.querySelectorAll('.pgto-btn').forEach(btn => {
    btn.classList.toggle('ativo', btn.dataset.pgto === tipo);
  });
  const dinheiroExtra = document.getElementById('caixa-dinheiro-extra');
  if (dinheiroExtra) dinheiroExtra.style.display = tipo === 'dinheiro' ? 'block' : 'none';
  const trocoEl = document.getElementById('caixa-troco-display');
  if (trocoEl && tipo !== 'dinheiro') trocoEl.style.display = 'none';
}

function calcularTroco() {
  if (_formaPagamento !== 'dinheiro') return;
  const total    = window._carrinho.reduce((acc, i) => acc + (i.preco * i.quantidade), 0);
  const recebido = parseFloat(document.getElementById('caixa-valor-recebido')?.value || 0);
  const trocoEl  = document.getElementById('caixa-troco-display');
  const trocoVal = document.getElementById('caixa-troco-valor');
  if (!trocoEl || !trocoVal) return;

  if (recebido >= total && total > 0) {
    trocoVal.textContent   = fmt(recebido - total);
    trocoEl.style.display  = 'flex';
  } else {
    trocoEl.style.display = 'none';
  }
}

async function finalizarVendaCaixa() {
  if (window._carrinho.length === 0) return;

  const total        = window._carrinho.reduce((acc, i) => acc + (i.preco * i.quantidade), 0);
  const valorRecebido = _formaPagamento === 'dinheiro'
    ? parseFloat(document.getElementById('caixa-valor-recebido')?.value || 0)
    : total;

  if (_formaPagamento === 'dinheiro' && valorRecebido < total) {
    toast(`Valor insuficiente. Total: ${fmt(total)}`, 'error');
    return;
  }

  const btn = document.getElementById('btn-finalizar-venda');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Processando...'; }

  try {
    const resposta = await apiFetch('/api/vendas', {
      method: 'POST',
      body: JSON.stringify({
        itens: window._carrinho.map(i => ({
          produto_id: i.produto_id,
          quantidade: i.quantidade,
        })),
        forma_pagamento: _formaPagamento,
        valor_recebido:  valorRecebido,
        total,
        sessao_id: _sessaoCaixa ? _sessaoCaixa.id : null
      })
    });

    if (!resposta) { if (btn) { btn.disabled = false; btn.innerHTML = '✔ Finalizar Venda'; } return; }

    if (resposta.ok) {
      const dados = await resposta.json();
      const troco  = dados.troco || 0;

      const modal    = document.getElementById('modal-venda-ok');
      const msg      = document.getElementById('modal-venda-msg');
      const trocoRow = document.getElementById('modal-troco-row');
      const trocoVal = document.getElementById('modal-troco-val');

      if (msg)      msg.textContent = `${window._carrinho.length} item(s) vendido(s) — Total: ${fmt(total)}`;
      if (trocoRow) trocoRow.style.display = troco > 0 ? 'block' : 'none';
      if (trocoVal) trocoVal.textContent   = fmt(troco);
      if (modal)    modal.classList.add('aberto');

      window._carrinho = [];
      renderizarCarrinho();
      carregarProdutos();
      carregarPedidos();
      carregarFinanceiro();
      // Recarrega sessao para atualizar totais no header
      if (_sessaoCaixa) atualizarInfoSessao();

      const recebidoEl = document.getElementById('caixa-valor-recebido');
      if (recebidoEl) recebidoEl.value = '';

    } else {
      const err = await resposta.json();
      toast(err.detail || 'Erro ao finalizar venda.', 'error');
    }
  } catch {
    toast('Erro de comunicação com o servidor.', 'error');
  } finally {
    if (btn) { btn.disabled = window._carrinho.length === 0; btn.innerHTML = '✔ Finalizar Venda'; }
  }
}

function fecharModalVenda() {
  const modal = document.getElementById('modal-venda-ok');
  if (modal) modal.classList.remove('aberto');
  carregarCaixa();
}

// =============================================
// CONTROLE DE CAIXA — ABERTURA / FECHAMENTO
// =============================================
async function iniciarControleCaixa() {
  const viewFechado = document.getElementById('caixa-fechado-view');
  const viewAberto  = document.getElementById('caixa-aberto-view');
  try {
    const resp = await apiFetch('/api/caixa/status');
    if (!resp) return;
    const dados = await resp.json();

    if (dados.status === 'aberto' && dados.sessao) {
      _sessaoCaixa = dados.sessao;
      if (viewFechado) viewFechado.style.display = 'none';
      if (viewAberto)  viewAberto.style.display  = 'block';
      _atualizarHeaderSessao();
      carregarCaixa();
    } else {
      _sessaoCaixa = null;
      if (viewFechado) viewFechado.style.display = 'flex';
      if (viewAberto)  viewAberto.style.display  = 'none';
    }
  } catch (err) {
    console.error('Erro ao verificar status do caixa:', err);
  }
}

function _atualizarHeaderSessao() {
  if (!_sessaoCaixa) return;
  const info = document.getElementById('caixa-sessao-info');
  if (!info) return;
  const hora   = new Date(_sessaoCaixa.abertura).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fundo  = fmt(_sessaoCaixa.valor_abertura);
  const vendas = fmt(_sessaoCaixa.total_vendas);
  info.textContent = `Aberto às ${hora} · Fundo: ${fundo} · Vendas: ${vendas}`;
}

async function atualizarInfoSessao() {
  try {
    const resp = await apiFetch('/api/caixa/status');
    if (!resp) return;
    const dados = await resp.json();
    if (dados.status === 'aberto' && dados.sessao) {
      _sessaoCaixa = dados.sessao;
      _atualizarHeaderSessao();
    }
  } catch { /* silencioso */ }
}

async function abrirCaixa() {
  const fundo = parseFloat(document.getElementById('caixa-fundo-abertura')?.value || 0);
  const btn   = document.getElementById('btn-abrir-caixa');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Abrindo...'; }

  try {
    const resp = await apiFetch('/api/caixa/abrir', {
      method: 'POST',
      body: JSON.stringify({ valor_abertura: fundo })
    });
    if (!resp) return;

    if (resp.ok) {
      toast('Caixa aberto com sucesso! 🔓');
      await iniciarControleCaixa();
    } else {
      const err = await resp.json();
      toast(err.detail || 'Erro ao abrir caixa.', 'error');
    }
  } catch {
    toast('Erro de comunicação com o servidor.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '🔓 Abrir Caixa'; }
  }
}

function confirmarFecharCaixa() {
  if (!_sessaoCaixa) return;
  document.getElementById('fcr-total-vendas').textContent   = fmt(_sessaoCaixa.total_vendas);
  document.getElementById('fcr-total-dinheiro').textContent = fmt(_sessaoCaixa.total_dinheiro);
  document.getElementById('fcr-total-cartao').textContent   = fmt(_sessaoCaixa.total_cartao);
  document.getElementById('fcr-total-pix').textContent      = fmt(_sessaoCaixa.total_pix);
  document.getElementById('fcr-fundo').textContent          = fmt(_sessaoCaixa.valor_abertura);
  const esperado = (_sessaoCaixa.valor_abertura || 0) + (_sessaoCaixa.total_dinheiro || 0);
  document.getElementById('fcr-esperado').textContent       = fmt(esperado);
  document.getElementById('modal-fechar-caixa').classList.add('aberto');
}

function fecharModalFechamento() {
  document.getElementById('modal-fechar-caixa').classList.remove('aberto');
}

async function fecharCaixaExecutar() {
  if (!_sessaoCaixa) return;
  const btn = document.getElementById('btn-confirmar-fechar');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Fechando...'; }

  try {
    const resp = await apiFetch('/api/caixa/fechar', {
      method: 'POST',
      body: JSON.stringify({ sessao_id: _sessaoCaixa.id })
    });
    if (!resp) return;

    if (resp.ok) {
      const dados = await resp.json();
      fecharModalFechamento();

      const r = dados.resumo;
      const durMin = Math.round((Date.now() - new Date(_sessaoCaixa.abertura)) / 60000);
      const msgEl  = document.getElementById('modal-fechado-msg');
      if (msgEl) msgEl.textContent = `Turno de ${durMin} min encerrado · ${fmt(r.total_vendas)} em vendas`;

      const resumoEl = document.getElementById('modal-fechado-resumo');
      if (resumoEl) {
        resumoEl.innerHTML = `
          <div class="fechar-resumo-row"><span>💵 Dinheiro</span><span>${fmt(r.total_dinheiro)}</span></div>
          <div class="fechar-resumo-row"><span>💳 Cartão</span><span>${fmt(r.total_cartao)}</span></div>
          <div class="fechar-resumo-row"><span>📱 PIX</span><span>${fmt(r.total_pix)}</span></div>
          <div class="fechar-resumo-row highlight"><span>Total em Caixa (esperado)</span><strong>${fmt(r.total_esperado_caixa)}</strong></div>`;
      }

      _sessaoCaixa = null;
      document.getElementById('modal-caixa-fechado-ok')?.classList.add('aberto');
    } else {
      const err = await resp.json();
      toast(err.detail || 'Erro ao fechar caixa.', 'error');
    }
  } catch {
    toast('Erro de comunicação com o servidor.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔒 Confirmar Fechamento'; }
  }
}

function fecharModalCaixaFechadoOk() {
  document.getElementById('modal-caixa-fechado-ok')?.classList.remove('aberto');
  window._carrinho = [];
  renderizarCarrinho();
  const viewFechado = document.getElementById('caixa-fechado-view');
  const viewAberto  = document.getElementById('caixa-aberto-view');
  if (viewFechado) viewFechado.style.display = 'flex';
  if (viewAberto)  viewAberto.style.display  = 'none';
}

// =============================================
// GRÁFICOS — configuração global
// =============================================
const CHART_CORES = ['#C8813A','#5C3D2E','#27AE60','#3498DB','#E67E22','#9B59B6','#E74C3C'];
const charts = {};
let _periodoAtivo = 7;

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
          <span class="dash-rank-nome">${escapeHtml(nome)}</span>
          <span class="dash-rank-valor">${qty} un</span>
        </div>
        <div class="dash-rank-track">
          <div class="dash-rank-fill" style="width:${pct}%; background:${cor};"></div>
        </div>
      </div>`;
  }).join('');
}

// =============================================
// 1. GRÁFICO COMBINADO
// =============================================
function _renderCombinado(pedidos, dias) {
  const canvas = document.getElementById('chart-combinado');
  if (!canvas) return;

  const labels = [], fatDiario = [];
  const agrupado = dias <= 30;

  if (agrupado) {
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
    for (let i = 12; i >= 0; i--) {
      const inicio = new Date();
      inicio.setDate(inicio.getDate() - i * 7 - 6);
      const fim = new Date();
      fim.setDate(fim.getDate() - i * 7);
      labels.push(`Sem ${13 - i}`);
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
  if (labelEl) labelEl.textContent = dias <= 30 ? `Últimos ${dias} dias` : 'Últimas 13 semanas';

  destroyChart('combinado');

  const ctx2d = canvas.getContext('2d');
  const grad  = ctx2d.createLinearGradient(0, 0, 0, 300);
  grad.addColorStop(0, 'rgba(200,129,58,0.90)');
  grad.addColorStop(1, 'rgba(200,129,58,0.35)');

  charts['combinado'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { type: 'bar',  label: 'Faturamento', data: fatDiario, backgroundColor: grad, borderRadius: 5, order: 2 },
        { type: 'line', label: `Média ${janela}d`, data: media, borderColor: '#5C3D2E', borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#5C3D2E', tension: 0.45, fill: false, order: 1 }
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
        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { callback: (v) => fmt(v), font: { size: 11 } } },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

// =============================================
// 2. GRÁFICO ROSCA
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
      datasets: [{ data: sorted.map(([, v]) => v), backgroundColor: CHART_CORES, borderWidth: 3, borderColor: '#FFFFFF', hoverOffset: 6 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      _centerText: fmt(totalReceita),
      plugins: {
        legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmt(c.raw)} (${((c.raw / totalReceita) * 100).toFixed(1)}%)` } }
      }
    }
  });
}

// =============================================
// 3. BARRAS HORIZONTAIS: Ranking
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
      datasets: [{ label: 'Unidades vendidas', data: sorted.map(([, v]) => v), backgroundColor: CHART_CORES.map(c => c + 'CC'), borderColor: CHART_CORES, borderWidth: 1.5, borderRadius: 5 }]
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
        x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 11 } } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

// =============================================
// 4. ÁREA ACUMULADA
// =============================================
function _renderArea(pedidos) {
  const canvas = document.getElementById('chart-area');
  if (!canvas) return;

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

  const ctx2d    = canvas.getContext('2d');
  const areaGrad = ctx2d.createLinearGradient(0, 0, 0, 250);
  areaGrad.addColorStop(0, 'rgba(200,129,58,0.35)');
  areaGrad.addColorStop(1, 'rgba(200,129,58,0.00)');

  destroyChart('area');
  charts['area'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: 'Receita Semanal', data: dados, borderColor: '#C8813A', borderWidth: 2.5, backgroundColor: areaGrad, fill: true, tension: 0.45, pointRadius: 5, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#C8813A', pointBorderWidth: 2.5 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${fmt(c.raw)}` } }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { callback: (v) => fmt(v), font: { size: 11 } } },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

// =============================================
// 5. FUNIL CSS
// =============================================
function _renderFunil(pedidos, produtos) {
  const container = document.getElementById('funil-container');
  if (!container) return;

  const hoje   = new Date().toISOString().split('T')[0];
  const mes    = new Date().toISOString().slice(0, 7);

  const stages = [
    { label: 'Produtos Cadastrados', value: produtos.length,  fmt: (v) => `${v} itens`,   cor: '#C8813A' },
    { label: 'Pedidos Totais',       value: pedidos.length,   fmt: (v) => `${v} pedidos`,  cor: '#5C3D2E' },
    { label: 'Pedidos este Mês',     value: pedidos.filter(p => p.created_at?.startsWith(mes)).length,  fmt: (v) => `${v} pedidos`, cor: '#3498DB' },
    { label: 'Pedidos Hoje',         value: pedidos.filter(p => p.created_at?.startsWith(hoje)).length, fmt: (v) => `${v} pedidos`, cor: '#27AE60' },
  ];

  const maxVal = Math.max(...stages.map(s => s.value), 1);

  container.innerHTML = stages.map((s, i) => {
    const pct     = Math.max(((s.value / maxVal) * 100), 12).toFixed(0);
    const convPct = i === 0 ? '100%'
      : stages[i - 1].value > 0
        ? ((s.value / stages[i - 1].value) * 100).toFixed(0) + '%'
        : '—';

    return `
      <div class="funil-stage">
        <div class="funil-bar-col">
          <div class="funil-bar-track">
            <div class="funil-bar-fill" style="width:${pct}%; background:${s.cor};">${s.fmt(s.value)}</div>
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
        <td class="fw-bold">${escapeHtml(nome)}</td>
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
          <div class="dash-alerta-nome">${escapeHtml(p.nome)}</div>
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

  if (idDaAba === 'aba-financeiro' && window._pedidosCache) {
    setTimeout(() => {
      Object.values(charts).forEach(c => c.resize());
      renderizarGraficos(window._pedidosCache);
    }, 50);
  }

  if (idDaAba === 'aba-caixa') {
    setTimeout(() => iniciarControleCaixa(), 50);
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
