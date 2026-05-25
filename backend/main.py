import os
import json
from google import genai
from google.genai import types
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from supabase import create_client, Client
from dotenv import load_dotenv
from pydantic import BaseModel
from typing import List
import xml.etree.ElementTree as ET

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_supabase_url = os.getenv("SUPABASE_URL", "")
_supabase_key = os.getenv("SUPABASE_KEY", "")

try:
    supabase: Client = create_client(_supabase_url, _supabase_key)
except Exception as e:
    print(f"⚠️  SUPABASE não inicializado: {e}")
    supabase = None  # type: ignore

_gemini_client = None


def get_gemini_client():
    global _gemini_client
    if _gemini_client is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=503, detail="GEMINI_API_KEY não configurada no servidor.")
        _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client


def check_supabase():
    if not supabase:
        raise HTTPException(status_code=503, detail="Banco de dados não disponível.")


# ---- Models ----

class Produto(BaseModel):
    nome: str
    preco: float
    estoque: int
    validade: str = ""

class ProdutoUpdate(BaseModel):
    nome: str
    preco: float
    estoque: int
    validade: str = ""

class Pedido(BaseModel):
    produto_id: int
    quantidade: int
    valor_total: float

class ItemVenda(BaseModel):
    produto_id: int
    quantidade: int
    preco_unitario: float

class VendaCaixa(BaseModel):
    itens: List[ItemVenda]
    forma_pagamento: str
    valor_recebido: float = 0.0
    total: float

class LoginDados(BaseModel):
    email: str
    senha: str

class CadastroDados(BaseModel):
    nome_padaria: str
    responsavel: str
    email: str
    senha: str


# ---- Health ----

@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "supabase": "conectado" if supabase else "⚠️ SUPABASE_URL/KEY não configurados",
        "gemini": "configurado" if os.getenv("GEMINI_API_KEY") else "⚠️ GEMINI_API_KEY não configurada"
    }


# ---- Auth ----

@app.post("/api/cadastro")
def executar_cadastro(dados: CadastroDados):
    check_supabase()
    try:
        result = supabase.auth.sign_up({
            "email": dados.email,
            "password": dados.senha,
            "options": {
                "data": {
                    "nome_padaria": dados.nome_padaria,
                    "responsavel": dados.responsavel
                }
            }
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
            raise HTTPException(status_code=400, detail="Este e-mail já está cadastrado.")
        raise HTTPException(status_code=400, detail=f"Erro ao criar conta: {msg}")


@app.post("/api/login")
def executar_login(dados: LoginDados):
    if dados.email == "admin@padaria.com" and dados.senha == "padaria123":
        return {"token": "token-dev", "nome_padaria": "Minha Padaria"}
    check_supabase()
    try:
        result = supabase.auth.sign_in_with_password({
            "email": dados.email,
            "password": dados.senha
        })
        if result.user:
            nome_padaria = (result.user.user_metadata or {}).get("nome_padaria", dados.email.split("@")[0])
            return {
                "token": result.session.access_token,
                "nome_padaria": nome_padaria
            }
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="E-mail ou senha inválidos")


# ---- Produtos ----

@app.get("/api/produtos")
def listar_produtos():
    check_supabase()
    return supabase.table("produtos").select("*").execute().data


@app.post("/api/produtos")
def criar_produto(produto: Produto):
    check_supabase()
    try:
        resposta = supabase.table("produtos").insert({
            "nome": produto.nome,
            "preco": produto.preco,
            "estoque": produto.estoque,
            "validade": produto.validade or None
        }).execute()
        return {"status": "sucesso", "dados": resposta.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/produtos/{produto_id}")
def atualizar_produto(produto_id: int, produto: ProdutoUpdate):
    check_supabase()
    try:
        resposta = supabase.table("produtos").update({
            "nome": produto.nome,
            "preco": produto.preco,
            "estoque": produto.estoque,
            "validade": produto.validade or None
        }).eq("id", produto_id).execute()
        return {"status": "sucesso", "dados": resposta.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/produtos/{produto_id}")
def deletar_produto(produto_id: int):
    check_supabase()
    try:
        supabase.table("produtos").delete().eq("id", produto_id).execute()
        return {"status": "sucesso"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---- Pedidos ----

@app.get("/api/pedidos")
def listar_pedidos():
    check_supabase()
    return supabase.table("pedidos").select("*, produtos(nome)").order("created_at", desc=True).execute().data


@app.post("/api/pedidos")
def registrar_venda(pedido: Pedido):
    check_supabase()
    try:
        prod = supabase.table("produtos").select("estoque, nome").eq("id", pedido.produto_id).single().execute()
        if not prod.data:
            raise HTTPException(status_code=404, detail="Produto não encontrado.")

        estoque_atual = prod.data.get("estoque", 0)
        if estoque_atual < pedido.quantidade:
            raise HTTPException(
                status_code=400,
                detail=f"Estoque insuficiente: apenas {estoque_atual} unidade(s) de '{prod.data['nome']}' disponíveis."
            )

        resposta = supabase.table("pedidos").insert({
            "produto_id": pedido.produto_id,
            "quantidade": pedido.quantidade,
            "valor_total": pedido.valor_total
        }).execute()

        supabase.table("produtos").update({
            "estoque": estoque_atual - pedido.quantidade
        }).eq("id", pedido.produto_id).execute()

        return {"status": "sucesso", "dados": resposta.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---- Vendas Caixa (PDV — multi-item) ----

@app.post("/api/vendas")
def finalizar_venda_caixa(venda: VendaCaixa):
    check_supabase()
    try:
        pedidos_criados = []
        for item in venda.itens:
            prod = supabase.table("produtos").select("estoque, nome").eq("id", item.produto_id).single().execute()
            if not prod.data:
                raise HTTPException(status_code=404, detail=f"Produto ID {item.produto_id} não encontrado.")

            estoque_atual = prod.data.get("estoque", 0)
            if estoque_atual < item.quantidade:
                raise HTTPException(
                    status_code=400,
                    detail=f"Estoque insuficiente para '{prod.data['nome']}': apenas {estoque_atual} unidade(s)."
                )

            resposta = supabase.table("pedidos").insert({
                "produto_id": item.produto_id,
                "quantidade": item.quantidade,
                "valor_total": round(item.preco_unitario * item.quantidade, 2)
            }).execute()

            supabase.table("produtos").update({
                "estoque": estoque_atual - item.quantidade
            }).eq("id", item.produto_id).execute()

            pedidos_criados.extend(resposta.data)

        troco = 0.0
        if venda.forma_pagamento == "dinheiro" and venda.valor_recebido > 0:
            troco = round(venda.valor_recebido - venda.total, 2)

        return {
            "status": "sucesso",
            "pedidos": len(pedidos_criados),
            "troco": troco,
            "mensagem": f"Venda finalizada! {len(venda.itens)} item(s) processado(s)."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---- Upload Nota Fiscal ----

@app.post("/api/upload-nf")
async def importar_nota_fiscal(file: UploadFile = File(...)):
    nome_arquivo = file.filename.lower()
    if nome_arquivo.endswith('.xml'):
        return await _processar_xml(file)
    elif nome_arquivo.endswith('.pdf'):
        return await _processar_pdf(file)
    else:
        raise HTTPException(status_code=400, detail="Envie um arquivo XML ou PDF de Nota Fiscal.")


async def _processar_xml(file: UploadFile):
    check_supabase()
    try:
        conteudo = await file.read()
        root = ET.fromstring(conteudo)
        ns = {'ns': 'http://www.portalfiscal.inf.br/nfe'}
        produtos_inseridos = []
        for item in root.findall('.//ns:det', ns):
            prod = item.find('ns:prod', ns)
            if prod is not None:
                nome = prod.find('ns:xProd', ns).text
                qtd = int(float(prod.find('ns:qCom', ns).text))
                preco_venda = round(float(prod.find('ns:vUnCom', ns).text) * 1.40, 2)
                supabase.table("produtos").insert({
                    "nome": nome, "preco": preco_venda, "estoque": qtd, "validade": None
                }).execute()
                produtos_inseridos.append(nome)
        return {
            "status": "sucesso",
            "mensagem": f"{len(produtos_inseridos)} produtos importados do XML!",
            "produtos": produtos_inseridos
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao processar XML: {str(e)}")


async def _processar_pdf(file: UploadFile):
    check_supabase()
    try:
        conteudo = await file.read()

        prompt = """Analise esta nota fiscal e extraia todos os produtos listados.
Para cada produto retorne um objeto JSON com exatamente estes campos:
- nome: descrição/nome do produto
- quantidade: quantidade numérica (inteiro)
- preco_unitario: preço unitário em reais (decimal)

Retorne SOMENTE um array JSON válido, sem markdown, sem texto adicional, sem bloco de código.
Exemplo de resposta: [{"nome": "Farinha de Trigo", "quantidade": 10, "preco_unitario": 5.50}]

Se não encontrar produtos, retorne um array vazio: []"""

        resposta = get_gemini_client().models.generate_content(
            model="gemini-2.0-flash",
            contents=[
                types.Part.from_bytes(data=conteudo, mime_type="application/pdf"),
                prompt
            ]
        )

        texto = resposta.text.strip()
        if texto.startswith("```"):
            texto = texto.split("```")[1]
            if texto.startswith("json"):
                texto = texto[4:]
        texto = texto.strip()

        produtos_gemini = json.loads(texto)
        if not isinstance(produtos_gemini, list):
            raise ValueError("Resposta do Gemini não é uma lista de produtos.")

        produtos_inseridos = []
        for p in produtos_gemini:
            nome  = str(p.get("nome", "Produto sem nome"))
            qtd   = int(p.get("quantidade", 1))
            preco = round(float(p.get("preco_unitario", 0)) * 1.40, 2)
            supabase.table("produtos").insert({
                "nome": nome, "preco": preco, "estoque": qtd, "validade": None
            }).execute()
            produtos_inseridos.append(nome)

        return {
            "status": "sucesso",
            "mensagem": f"{len(produtos_inseridos)} produtos importados do PDF!",
            "produtos": produtos_inseridos
        }
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Gemini não conseguiu extrair produtos deste PDF. Tente um PDF mais legível.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao processar PDF: {str(e)}")


FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
