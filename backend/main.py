import os
import xml.etree.ElementTree as ET
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
from dotenv import load_dotenv
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles

# 1. Carrega chaves do .env (local)
load_dotenv()

app = FastAPI()

# 2. Configurações de CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. Conexão com o Supabase
url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(url, key)

# 4. Modelos de Dados
class Produto(BaseModel):
    nome: str
    preco: float
    estoque: int
    validade: str

class Pedido(BaseModel):
    produto_id: int
    quantidade: int
    valor_total: float

class LoginDados(BaseModel):
    usuario: str
    senha: str

# ==========================================
# 5. ROTAS DA API (DEVEM FICAR ANTES DO MOUNT FRONT-END)
# ==========================================

@app.get("/produtos")
def listar_produtos():
    resposta = supabase.table("produtos").select("*").execute()
    return resposta.data

@app.post("/produtos")
def criar_produto(produto: Produto):
    dados = {
        "nome": produto.nome,
        "preco": produto.preco,
        "estoque": produto.estoque,
        "validade": produto.validade
    }
    try:
        resposta = supabase.table("produtos").insert(dados).execute()
        return {"status": "sucesso", "dados": resposta.data}
    except Exception as erro:
        raise HTTPException(status_code=400, detail=str(erro))

@app.delete("/produtos/{produto_id}")
def deletar_produto(produto_id: int):
    try:
        resposta = supabase.table("produtos").delete().eq("id", produto_id).execute()
        return {"status": "sucesso"}
    except Exception as erro:
        raise HTTPException(status_code=400, detail=str(erro))

@app.get("/pedidos")
def listar_pedidos():
    resposta = supabase.table("pedidos").select("*, produtos(nome)").order("created_at", desc=True).execute()
    return resposta.data

@app.post("/pedidos")
def registrar_venda(pedido: Pedido):
    dados = {
        "produto_id": pedido.produto_id,
        "quantidade": pedido.quantidade,
        "valor_total": pedido.valor_total
    }
    try:
        resposta = supabase.table("pedidos").insert(dados).execute()
        return {"status": "sucesso", "dados": resposta.data}
    except Exception as erro:
        raise HTTPException(status_code=400, detail=str(erro))

# ROTA DE LOGIN
@app.post("/api/login")
def executar_login(dados: LoginDados):
    if dados.usuario == "admin" and dados.senha == "padariatech123":
        return {"status": "sucesso", "token": "token-falso-autenticacao"}
    else:
        raise HTTPException(status_code=401, detail="Usuário ou senha incorretos")

# ROTA DE UPLOAD DE NOTA FISCAL (XML)
@app.post("/upload-nf")
async def importar_nota_fiscal(file: UploadFile = File(...)):
    if not file.filename.endswith('.xml'):
        raise HTTPException(status_code=400, detail="Envie um arquivo XML.")
    
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
                preco_custo = float(prod.find('ns:vUnCom', ns).text)
                preco_venda = round(preco_custo * 1.40, 2) # Margem de lucro
                
                dados_produto = {
                    "nome": nome,
                    "preco": preco_venda,
                    "estoque": qtd,
                    "validade": "" 
                }
                
                supabase.table("produtos").insert(dados_produto).execute()
                produtos_inseridos.append(nome)
                
        return {"status": "sucesso", "mensagem": f"{len(produtos_inseridos)} produtos importados!", "produtos": produtos_inseridos}
    except Exception as erro:
        raise HTTPException(status_code=500, detail=str(erro))

# ==========================================
# 6. CONEXÃO COM O FRONT-END (OBRIGATÓRIO SER A ÚLTIMA LINHA)
# ==========================================
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
