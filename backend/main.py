import os
import json
from google import genai
from google.genai import types
from fastapi import FastAPI, HTTPException, UploadFile, File, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from supabase import create_client, Client
from dotenv import load_dotenv
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone

try:
    from defusedxml import ElementTree as _XmlParser
    _parse_xml = _XmlParser.fromstring
except ImportError:
    import xml.etree.ElementTree as _XmlParserFallback
    _parse_xml = _XmlParserFallback.fromstring

load_dotenv()

app = FastAPI()

# ---- Security headers middleware ----
class _SecurityHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

app.add_middleware(_SecurityHeaders)

# ---- CORS ----
_allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# ---- Supabase (cliente global apenas para auth pública) ----
_supabase_url = os.getenv("SUPABASE_URL", "")
_supabase_key = os.getenv("SUPABASE_KEY", "")

try:
    supabase: Client = create_client(_supabase_url, _supabase_key)
except Exception as e:
    print(f"SUPABASE nao inicializado: {e}")
    supabase = None  # type: ignore

# ---- Gemini ----
_gemini_client = None

def get_gemini_client():
    global _gemini_client
    if _gemini_client is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=503, detail="GEMINI_API_KEY nao configurada no servidor.")
        _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client

# ---- Auth ----
_security = HTTPBearer(auto_error=False)
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_security),
) -> dict:
    token = credentials.credentials if credentials else None
    if not token:
        raise HTTPException(status_code=401, detail="Token de autenticacao nao fornecido.")
    try:
        check_supabase()
        result = supabase.auth.get_user(token)
        if not result.user:
            raise HTTPException(status_code=401, detail="Token invalido.")
        return {"user_id": result.user.id, "token": token}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Sessao expirada. Faca login novamente.")


def get_db(user: dict = Depends(get_current_user)) -> Client:
    """Cliente Supabase autenticado como o usuario atual — respeita RLS."""
    client = create_client(_supabase_url, _supabase_key)
    client.postgrest.auth(user["token"])
    return client


def check_supabase():
    if not supabase:
        raise HTTPException(status_code=503, detail="Banco de dados nao disponivel.")


# ---- Models ----

class Produto(BaseModel):
    nome: str
    preco: float
    estoque: int
    validade: str = ""
    codigo_barras: str = ""

class ProdutoUpdate(BaseModel):
    nome: str
    preco: float
    estoque: int
    validade: str = ""
    codigo_barras: str = ""

class Pedido(BaseModel):
    produto_id: int
    quantidade: int

class ItemVenda(BaseModel):
    produto_id: int
    quantidade: int

class VendaCaixa(BaseModel):
    itens: List[ItemVenda]
    forma_pagamento: str
    valor_recebido: float = 0.0
    parcelas: int = 1
    sessao_id: Optional[int] = None
    total: Optional[float] = None  # ignorado — servidor recalcula

class LoginDados(BaseModel):
    email: str
    senha: str

class CadastroDados(BaseModel):
    nome_padaria: str
    responsavel: str
    email: str
    senha: str

class AbrirCaixa(BaseModel):
    valor_abertura: float = 0.0

class FecharCaixa(BaseModel):
    sessao_id: int


# ---- Health ----

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend"))

@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "supabase":       "conectado" if supabase else "SUPABASE_URL/KEY nao configurados",
        "gemini":         "configurado" if os.getenv("GEMINI_API_KEY") else "GEMINI_API_KEY nao configurada",
        "jwt":            "configurado" if SUPABASE_JWT_SECRET else "SUPABASE_JWT_SECRET nao configurado",
        "cors_origins":   _allowed_origins,
        "frontend_dir":   FRONTEND_DIR,
        "frontend_exists": os.path.isdir(FRONTEND_DIR),
    }


# ---- Auth (publica) ----

@app.post("/api/cadastro")
def executar_cadastro(dados: CadastroDados):
    check_supabase()
    try:
        result = supabase.auth.sign_up({
            "email": dados.email,
            "password": dados.senha,
            "options": {"data": {"nome_padaria": dados.nome_padaria, "responsavel": dados.responsavel}},
        })
        if result.user:
            token = result.session.access_token if result.session else "email-confirmation-pending"
            return {"token": token, "nome_padaria": dados.nome_padaria}
        raise HTTPException(status_code=400, detail="Erro ao criar conta. Tente novamente.")
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e)
        if "already" in msg.lower():
            raise HTTPException(status_code=400, detail="Este e-mail ja esta cadastrado.")
        raise HTTPException(status_code=400, detail=f"Erro ao criar conta: {msg}")


@app.post("/api/login")
def executar_login(dados: LoginDados):
    check_supabase()
    try:
        result = supabase.auth.sign_in_with_password({"email": dados.email, "password": dados.senha})
        if result.user:
            nome_padaria = (result.user.user_metadata or {}).get("nome_padaria", dados.email.split("@")[0])
            return {"token": result.session.access_token, "nome_padaria": nome_padaria}
        raise HTTPException(status_code=401, detail="Credenciais invalidas")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="E-mail ou senha invalidos")


# ---- Produtos ----

@app.get("/api/produtos")
def listar_produtos(supa: Client = Depends(get_db)):
    return supa.table("produtos").select("*").execute().data


@app.get("/api/produtos/barcode/{codigo}")
def buscar_por_barcode(codigo: str, supa: Client = Depends(get_db)):
    resposta = supa.table("produtos").select("*").eq("codigo_barras", codigo).limit(1).execute()
    if not resposta.data:
        raise HTTPException(status_code=404, detail="Produto não encontrado para este código de barras.")
    return resposta.data[0]


@app.post("/api/produtos")
def criar_produto(produto: Produto, supa: Client = Depends(get_db)):
    try:
        resposta = supa.table("produtos").insert({
            "nome":          produto.nome,
            "preco":         produto.preco,
            "estoque":       produto.estoque,
            "validade":      produto.validade or None,
            "codigo_barras": produto.codigo_barras or None,
        }).execute()
        return {"status": "sucesso", "dados": resposta.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/produtos/{produto_id}")
def atualizar_produto(produto_id: int, produto: ProdutoUpdate, supa: Client = Depends(get_db)):
    try:
        resposta = supa.table("produtos").update({
            "nome":          produto.nome,
            "preco":         produto.preco,
            "estoque":       produto.estoque,
            "validade":      produto.validade or None,
            "codigo_barras": produto.codigo_barras or None,
        }).eq("id", produto_id).execute()
        return {"status": "sucesso", "dados": resposta.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/produtos/{produto_id}")
def deletar_produto(produto_id: int, supa: Client = Depends(get_db)):
    try:
        supa.table("produtos").delete().eq("id", produto_id).execute()
        return {"status": "sucesso"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---- Pedidos ----

@app.get("/api/pedidos")
def listar_pedidos(supa: Client = Depends(get_db)):
    return supa.table("pedidos").select("*, produtos(nome)").order("created_at", desc=True).execute().data


@app.post("/api/pedidos")
def registrar_venda(pedido: Pedido, supa: Client = Depends(get_db)):
    try:
        prod = supa.table("produtos").select("estoque, nome, preco").eq("id", pedido.produto_id).single().execute()
        if not prod.data:
            raise HTTPException(status_code=404, detail="Produto nao encontrado.")

        estoque_atual = prod.data.get("estoque", 0)
        if estoque_atual < pedido.quantidade:
            raise HTTPException(
                status_code=400,
                detail=f"Estoque insuficiente: apenas {estoque_atual} unidade(s) de '{prod.data['nome']}' disponiveis."
            )

        valor_total = round(float(prod.data["preco"]) * pedido.quantidade, 2)

        resposta = supa.table("pedidos").insert({
            "produto_id":  pedido.produto_id,
            "quantidade":  pedido.quantidade,
            "valor_total": valor_total,
        }).execute()

        supa.table("produtos").update({"estoque": estoque_atual - pedido.quantidade}).eq("id", pedido.produto_id).execute()

        return {"status": "sucesso", "dados": resposta.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---- Vendas Caixa (PDV — multi-item) ----

@app.post("/api/vendas")
def finalizar_venda_caixa(venda: VendaCaixa, supa: Client = Depends(get_db)):
    try:
        ids = [item.produto_id for item in venda.itens]
        prods_resp = supa.table("produtos").select("id, nome, preco, estoque").in_("id", ids).execute()
        prods_map = {p["id"]: p for p in prods_resp.data}

        pedidos_criados = []
        total_real = 0.0

        for item in venda.itens:
            prod = prods_map.get(item.produto_id)
            if not prod:
                raise HTTPException(status_code=404, detail=f"Produto ID {item.produto_id} nao encontrado.")

            estoque_atual = prod.get("estoque", 0)
            if estoque_atual < item.quantidade:
                raise HTTPException(
                    status_code=400,
                    detail=f"Estoque insuficiente para '{prod['nome']}': apenas {estoque_atual} unidade(s)."
                )

            valor_item = round(float(prod["preco"]) * item.quantidade, 2)
            total_real += valor_item

            pedido_data = {
                "produto_id":      item.produto_id,
                "quantidade":      item.quantidade,
                "valor_total":     valor_item,
                "forma_pagamento": venda.forma_pagamento,
                "parcelas":        venda.parcelas if venda.forma_pagamento == "cartao" else 1,
            }
            if venda.sessao_id:
                pedido_data["sessao_id"] = venda.sessao_id

            resposta = supa.table("pedidos").insert(pedido_data).execute()
            supa.table("produtos").update({"estoque": estoque_atual - item.quantidade}).eq("id", item.produto_id).execute()
            pedidos_criados.extend(resposta.data)

        total_real = round(total_real, 2)

        if venda.sessao_id:
            campo_pgto = {"dinheiro": "total_dinheiro", "cartao": "total_cartao", "pix": "total_pix"}.get(venda.forma_pagamento)
            sessao = supa.table("sessoes_caixa").select("total_vendas,total_dinheiro,total_cartao,total_pix").eq("id", venda.sessao_id).single().execute()
            if sessao.data and campo_pgto:
                supa.table("sessoes_caixa").update({
                    campo_pgto:     round((sessao.data.get(campo_pgto) or 0) + total_real, 2),
                    "total_vendas": round((sessao.data.get("total_vendas") or 0) + total_real, 2),
                }).eq("id", venda.sessao_id).execute()

        troco = 0.0
        if venda.forma_pagamento == "dinheiro" and venda.valor_recebido > 0:
            troco = max(0.0, round(venda.valor_recebido - total_real, 2))

        return {
            "status":   "sucesso",
            "pedidos":  len(pedidos_criados),
            "troco":    troco,
            "total":    total_real,
            "mensagem": f"Venda finalizada! {len(venda.itens)} item(s) processado(s).",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---- Controle de Caixa ----

@app.get("/api/caixa/status")
def status_caixa(supa: Client = Depends(get_db)):
    resultado = supa.table("sessoes_caixa").select("*").eq("status", "aberto").order("abertura", desc=True).limit(1).execute()
    if resultado.data:
        return {"status": "aberto", "sessao": resultado.data[0]}
    return {"status": "fechado", "sessao": None}


@app.post("/api/caixa/abrir")
def abrir_caixa(dados: AbrirCaixa, supa: Client = Depends(get_db)):
    aberta = supa.table("sessoes_caixa").select("id").eq("status", "aberto").limit(1).execute()
    if aberta.data:
        raise HTTPException(status_code=400, detail="Ja existe uma sessao de caixa aberta.")
    resposta = supa.table("sessoes_caixa").insert({"valor_abertura": dados.valor_abertura, "status": "aberto"}).execute()
    return {"status": "sucesso", "sessao": resposta.data[0]}


@app.post("/api/caixa/fechar")
def fechar_caixa(dados: FecharCaixa, supa: Client = Depends(get_db)):
    sessao = supa.table("sessoes_caixa").select("*").eq("id", dados.sessao_id).eq("status", "aberto").single().execute()
    if not sessao.data:
        raise HTTPException(status_code=404, detail="Sessao de caixa nao encontrada ou ja fechada.")

    s = sessao.data
    total_dinheiro = float(s.get("total_dinheiro") or 0)
    total_cartao   = float(s.get("total_cartao")   or 0)
    total_pix      = float(s.get("total_pix")      or 0)
    total_vendas   = float(s.get("total_vendas")   or 0)
    valor_abertura = float(s.get("valor_abertura") or 0)

    resposta = supa.table("sessoes_caixa").update({
        "fechamento": datetime.now(timezone.utc).isoformat(),
        "status":     "fechado",
    }).eq("id", dados.sessao_id).execute()

    return {
        "status": "sucesso",
        "sessao": resposta.data[0],
        "resumo": {
            "total_vendas":         round(total_vendas, 2),
            "total_dinheiro":       round(total_dinheiro, 2),
            "total_cartao":         round(total_cartao, 2),
            "total_pix":            round(total_pix, 2),
            "valor_abertura":       round(valor_abertura, 2),
            "total_esperado_caixa": round(valor_abertura + total_dinheiro, 2),
        },
    }


@app.get("/api/caixa/historico")
def historico_caixa(supa: Client = Depends(get_db)):
    return supa.table("sessoes_caixa").select("*").order("abertura", desc=True).limit(30).execute().data


# ---- Upload Nota Fiscal ----

@app.post("/api/upload-nf")
async def importar_nota_fiscal(file: UploadFile = File(...), supa: Client = Depends(get_db)):
    nome_arquivo = (file.filename or "").lower()
    if nome_arquivo.endswith(".xml"):
        return await _processar_xml(file, supa)
    elif nome_arquivo.endswith(".pdf"):
        return await _processar_pdf(file, supa)
    raise HTTPException(status_code=400, detail="Envie um arquivo XML ou PDF de Nota Fiscal.")


async def _ler_arquivo(file: UploadFile) -> bytes:
    conteudo = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(conteudo) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Arquivo muito grande. Maximo 10 MB.")
    return conteudo


async def _processar_xml(file: UploadFile, supa: Client):
    try:
        conteudo = await _ler_arquivo(file)
        root = _parse_xml(conteudo)
        ns = {"ns": "http://www.portalfiscal.inf.br/nfe"}
        produtos_inseridos = []
        for item in root.findall(".//ns:det", ns):
            prod = item.find("ns:prod", ns)
            if prod is not None:
                nome = prod.find("ns:xProd", ns).text
                qtd  = int(float(prod.find("ns:qCom", ns).text))
                preco_venda = round(float(prod.find("ns:vUnCom", ns).text) * 1.40, 2)
                supa.table("produtos").insert({"nome": nome, "preco": preco_venda, "estoque": qtd, "validade": None}).execute()
                produtos_inseridos.append(nome)
        return {"status": "sucesso", "mensagem": f"{len(produtos_inseridos)} produtos importados do XML!", "produtos": produtos_inseridos}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao processar XML: {str(e)}")


async def _processar_pdf(file: UploadFile, supa: Client):
    try:
        conteudo = await _ler_arquivo(file)
        prompt = (
            "Analise esta nota fiscal e extraia todos os produtos listados.\n"
            "Para cada produto retorne um objeto JSON com exatamente estes campos:\n"
            "- nome: descricao/nome do produto\n"
            "- quantidade: quantidade numerica (inteiro)\n"
            "- preco_unitario: preco unitario em reais (decimal)\n\n"
            "Retorne SOMENTE um array JSON valido, sem markdown, sem texto adicional.\n"
            'Exemplo: [{"nome": "Farinha de Trigo", "quantidade": 10, "preco_unitario": 5.50}]\n'
            "Se nao encontrar produtos, retorne: []"
        )
        resposta = get_gemini_client().models.generate_content(
            model="gemini-2.0-flash",
            contents=[types.Part.from_bytes(data=conteudo, mime_type="application/pdf"), prompt],
        )
        texto = resposta.text.strip()
        if texto.startswith("```"):
            texto = texto.split("```")[1]
            if texto.startswith("json"):
                texto = texto[4:]
        texto = texto.strip()
        produtos_gemini = json.loads(texto)
        if not isinstance(produtos_gemini, list):
            raise ValueError("Resposta do Gemini nao e uma lista.")
        produtos_inseridos = []
        for p in produtos_gemini:
            nome  = str(p.get("nome", "Produto sem nome"))
            qtd   = int(p.get("quantidade", 1))
            preco = round(float(p.get("preco_unitario", 0)) * 1.40, 2)
            supa.table("produtos").insert({"nome": nome, "preco": preco, "estoque": qtd, "validade": None}).execute()
            produtos_inseridos.append(nome)
        return {"status": "sucesso", "mensagem": f"{len(produtos_inseridos)} produtos importados do PDF!", "produtos": produtos_inseridos}
    except HTTPException:
        raise
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Gemini nao conseguiu extrair produtos deste PDF.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao processar PDF: {str(e)}")


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
