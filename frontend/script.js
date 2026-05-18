const API_URL = '/produtos';

// =============================================
// SISTEMA DE TOAST (substitui alert/confirm)
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

function confirmar(mensagem) {
  return window.confirm(mensagem);
}

// =============================================
// CARREGAR PEDIDOS
// =============================================
async function carregarPedidos() {
  try {
    const resposta = await fetch('/pedidos');
    const pedidos = await resposta.json();
    if (!Array.isArray(pedidos)) return;

    const hoje = new Date().toISOString().split('T')[0];
    const pedidosHoje = pedidos.filter(p => p.created_at && p.created_at.startsWith(hoje));

    // Dashboard
    const dashSaldo = document.getElementById('dash-saldo-dia');
    if (dashSaldo) {
      const totalHoje = pedidosHoje.reduce((acc, p) => acc + (p.valor_total || 0), 0);
      dashSaldo.innerText = fmt(totalHoje);
    }

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
    const tabelaTrans  = document.querySelector('#tabela-transacoes tbody');
    const emptyTrans   = document.getElementById('transacoes-empty');
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

  } catch (err) {
    console.error('Erro ao buscar pedidos:', err);
  }
}

// =============================================
// CARREGAR PRODUTOS / ESTOQUE
// =============================================
async function carregarProdutos() {
  try {
    const resposta = await fetch(API_URL);
    const produtos = await resposta.json();

    const tabelaBody    = document.querySelector('#tabela-produtos tbody');
    const loading       = document.getElementById('loading');
    const selectProdutos = document.getElementById('pedido-produto');

    if (!Array.isArray(produtos)) {
      if (loading) loading.innerText = 'Erro no servidor. Verifique o banco de dados.';
      return;
    }

    if (tabelaBody)     tabelaBody.innerHTML = '';
    if (loading)        loading.style.display = 'none';
    if (selectProdutos) selectProdutos.innerHTML = '<option value="">Selecione o produto...</option>';

    // Dashboard
    const dashTotal = document.getElementById('dash-total-produtos');
    if (dashTotal) dashTotal.innerText = produtos.length;

    let alertasValidade = 0;
    let produtoMaisEstoque = { nome: '—', estoque: 0 };

    produtos.forEach(produto => {
      if ((produto.estoque || 0) > produtoMaisEstoque.estoque) {
        produtoMaisEstoque = produto;
      }

      // Validade
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
            <td>
              <button class="btn btn-danger" onclick="excluirProduto(${produto.id})">🗑 Excluir</button>
            </td>
          </tr>`;
      }

      if (selectProdutos) {
        const opt = document.createElement('option');
        opt.value = produto.id;
        opt.dataset.preco = produto.preco;
        opt.textContent = `${produto.nome} — ${fmt(produto.preco)}`;
        selectProdutos.appendChild(opt);
      }
    });

    const lblMaiorVolume = document.getElementById('estoque-maior-volume');
    const lblAlertas     = document.getElementById('estoque-alertas-validade');
    if (lblMaiorVolume) lblMaiorVolume.innerText = `${produtoMaisEstoque.nome} (${produtoMaisEstoque.estoque} un)`;
    if (lblAlertas)     lblAlertas.innerText = alertasValidade;

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
      const resposta = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, preco, estoque, validade })
      });

      if (resposta.ok) {
        toast('Produto cadastrado com sucesso!');
        formProduto.reset();
        carregarProdutos();
      } else {
        const erroReal = await resposta.text();
        toast('Falha no cadastro: ' + erroReal, 'error');
      }
    } catch (err) {
      console.error(err);
      toast('Erro de comunicação com o servidor.', 'error');
    }
  });
}

// =============================================
// EXCLUIR PRODUTO
// =============================================
async function excluirProduto(id) {
  if (!confirmar('Excluir este produto do estoque?')) return;
  try {
    const resposta = await fetch(`/produtos/${id}`, { method: 'DELETE' });
    if (resposta.ok) {
      toast('Produto excluído.');
      carregarProdutos();
    } else {
      toast('Erro ao excluir produto.', 'error');
    }
  } catch (err) {
    console.error(err);
    toast('Erro de comunicação com o servidor.', 'error');
  }
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
    const precoUnitario = parseFloat(select.options[select.selectedIndex].dataset.preco);
    const valorTotal    = precoUnitario * quantidade;

    try {
      const resposta = await fetch('/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto_id: produtoId, quantidade, valor_total: valorTotal })
      });

      if (resposta.ok) {
        toast('Venda registrada com sucesso!');
        formPedido.reset();
        carregarProdutos();
        carregarPedidos();
        carregarFinanceiro();
      } else {
        const erroReal = await resposta.text();
        toast('Erro ao registrar venda: ' + erroReal, 'error');
      }
    } catch (err) {
      console.error(err);
      toast('Erro de comunicação com o servidor.', 'error');
    }
  });
}

// =============================================
// FINANCEIRO
// =============================================
async function carregarFinanceiro() {
  try {
    const [resProdutos, resPedidos] = await Promise.all([
      fetch('/produtos'),
      fetch('/pedidos')
    ]);
    const produtos = await resProdutos.json();
    const pedidos  = await resPedidos.json();

    if (Array.isArray(pedidos)) {
      const faturamento = pedidos.reduce((acc, p) => acc + (p.valor_total || 0), 0);
      const lblFat  = document.getElementById('fin-faturamento-total');
      const lblVend = document.getElementById('fin-total-vendas');
      if (lblFat)  lblFat.innerText  = fmt(faturamento);
      if (lblVend) lblVend.innerText = `${pedidos.length} vendas`;
    }

    if (Array.isArray(produtos)) {
      const capital = produtos.reduce((acc, p) => acc + (p.preco * (p.estoque || 0)), 0);
      const lblCap = document.getElementById('fin-custo-estoque');
      if (lblCap) lblCap.innerText = fmt(capital);
    }

    // Dashboard entradas/saídas (estático por ora, como estava antes)
    const dashEnt = document.getElementById('dash-entradas-mes');
    const dashSai = document.getElementById('dash-saidas-mes');
    if (dashEnt) dashEnt.innerText = 'R$ 14.890,00';
    if (dashSai) dashSai.innerText = 'R$ 4.320,00';

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
    if (nomeEl && arquivoInput.files[0]) {
      nomeEl.textContent = `📄 ${arquivoInput.files[0].name}`;
    }
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
    resultado.className = 'mt-16';
    resultado.innerHTML = '<span class="text-muted">⏳ Processando nota fiscal...</span>';

    const formData = new FormData();
    formData.append('file', arquivoInput.files[0]);

    try {
      const resposta = await fetch('/upload-nf', { method: 'POST', body: formData });
      const dados = await resposta.json();

      if (resposta.ok) {
        resultado.innerHTML = `
          <div class="badge badge-success" style="padding:10px 16px; font-size:13.5px;">
            ✔ ${dados.mensagem}
          </div>`;
        formNF.reset();
        document.getElementById('nome-arquivo').textContent = '';
        carregarProdutos();
        toast(dados.mensagem);
      } else {
        resultado.innerHTML = `
          <div class="badge badge-danger" style="padding:10px 16px; font-size:13.5px;">
            ✖ ${dados.detail}
          </div>`;
        toast(dados.detail, 'error');
      }
    } catch {
      resultado.innerHTML = `<div class="badge badge-danger" style="padding:10px 16px;">✖ Falha na comunicação com o servidor.</div>`;
      toast('Falha na comunicação com o servidor.', 'error');
    }
  });
}

// =============================================
// NAVEGAÇÃO DE ABAS
// =============================================
function abrirAba(evento, idDaAba) {
  document.querySelectorAll('.aba').forEach(a => a.classList.remove('ativa'));
  document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('ativo'));
  document.getElementById(idDaAba).classList.add('ativa');
  if (evento) evento.currentTarget.classList.add('ativo');
}

// =============================================
// UTILITÁRIO: formatar moeda BRL
// =============================================
function fmt(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
}

// =============================================
// INICIALIZAÇÃO
// =============================================
carregarProdutos();
carregarPedidos();
carregarFinanceiro();
