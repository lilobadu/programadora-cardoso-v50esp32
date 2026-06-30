const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, "db.json");
const SECRET = "ELETRONICA_CARDOSO_PMIC_V50_OFFLINE_2026";

app.use(cors());
app.use(express.json({limit:"10mb"}));
app.use(express.static(path.join(__dirname, "public")));

function loadDb(){
  if(!fs.existsSync(DB_FILE)){
    return {clientes:[]};
  }
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch(e){ return {clientes:[]}; }
}

function saveDb(db){
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function limparId(id){
  return String(id || "")
    .toUpperCase()
    .replace("CARDOSO_ID=", "")
    .replace(/[^A-F0-9]/g, "");
}

function gerarLicenca(id){
  const clean = limparId(id);
  const h = crypto
    .createHmac("sha256", SECRET)
    .update(clean, "ascii")
    .digest("hex")
    .toUpperCase();
  const lic = h.slice(0, 32);
  return lic.match(/.{1,4}/g).join("-");
}

app.get("/api/clientes", (req,res)=>{
  res.json(loadDb().clientes);
});

app.post("/api/pedidos", (req,res)=>{
  const db = loadDb();
  const body = req.body || {};
  const id = limparId(body.id || body.deviceId || "");

  if(!id) return res.status(400).json({erro:"ID ausente"});

  let cli = db.clientes.find(c => String(c.id).toUpperCase() === id);
  if(!cli){
    cli = {
      uuid: Date.now().toString(36) + Math.random().toString(36).slice(2,8),
      status: "aguardando",
      criadoEm: new Date().toISOString(),
      historico: []
    };
    db.clientes.unshift(cli);
  }

  Object.assign(cli, {
    nome: body.nome || "",
    telefone: body.telefone || "",
    cidade: body.cidade || "",
    endereco: body.endereco || "",
    email: body.email || "",
    oled: body.oled || "SH1106",
    id,
    versao: body.versao || "V50",
    status: cli.status === "ativo" ? "ativo" : "aguardando",
    atualizadoEm: new Date().toISOString()
  });

  cli.historico = cli.historico || [];
  cli.historico.unshift({data:new Date().toISOString(), acao:"pedido recebido"});

  saveDb(db);
  res.json({ok:true, requestId:cli.uuid, id:cli.id, status:cli.status, licenca:cli.licenca || ""});
});

app.post("/api/ativar/:uuid", (req,res)=>{
  const db = loadDb();
  const cli = db.clientes.find(c => c.uuid === req.params.uuid || c.id === req.params.uuid);
  if(!cli) return res.status(404).json({erro:"cliente não encontrado"});

  cli.status = "ativo";
  cli.licenca = gerarLicenca(cli.id);
  cli.ativadoEm = new Date().toISOString();
  cli.historico = cli.historico || [];
  cli.historico.unshift({data:new Date().toISOString(), acao:"ativado", licenca:cli.licenca});
  saveDb(db);
  res.json({ok:true, licenca:cli.licenca});
});

app.post("/api/negar/:uuid", (req,res)=>{
  const db = loadDb();
  const cli = db.clientes.find(c => c.uuid === req.params.uuid || c.id === req.params.uuid);
  if(!cli) return res.status(404).json({erro:"cliente não encontrado"});
  cli.status = "negado";
  cli.historico = cli.historico || [];
  cli.historico.unshift({data:new Date().toISOString(), acao:"negado"});
  saveDb(db);
  res.json({ok:true});
});

app.get("/api/licenca/:id", (req,res)=>{
  const db = loadDb();
  const key = String(req.params.id || "").toUpperCase();
  const cli = db.clientes.find(c => c.uuid === req.params.id || String(c.id).toUpperCase() === key);
  if(!cli) return res.json({status:"nao_encontrado"});
  res.json({status:cli.status, licenca:cli.status === "ativo" ? cli.licenca : ""});
});


app.get(["/admin", "/painel", "/dono"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get(["/cliente", "/flash"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, ()=>{
  console.log("Cardoso Online V7 rodando em http://localhost:" + PORT);
  console.log("CLIENTE: http://localhost:" + PORT + "/cliente");
  console.log("PAINEL DONO: http://localhost:" + PORT + "/painel");
});
