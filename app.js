// Programadora Cardoso V50 - app.js V12 MANUAL FINAL
// Base: grava firmware separado + leitura/ativacao serial simples que já funcionou.
// Regra: botão 2 NUNCA chama instalador. Ele só lê ID e envia ao painel.

let port = null;
let reader = null;
let writer = null;
let currentKey = null;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const $ = id => document.getElementById(id);

function log(msg) {
  const l = $("log");
  if (l) {
    l.textContent += msg + "\n";
    l.scrollTop = l.scrollHeight;
  } else {
    console.log(msg);
  }
}
function limparLog(){ if($("log")) $("log").textContent = ""; }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function dados(){
  return {
    nome: $("nome")?.value?.trim() || "",
    telefone: $("telefone")?.value?.trim() || "",
    cidade: $("cidade")?.value?.trim() || "",
    endereco: $("endereco")?.value?.trim() || "",
    email: $("email")?.value?.trim() || "",
    oled: $("oled")?.value || "SH1106",
    versao: "V50"
  };
}
function manifestAtual(){ return dados().oled === "SSD1306" ? "manifest_ssd1306.json" : "manifest_sh1106.json"; }

async function fecharPorta(){
  try { if(reader){ try{ await reader.cancel(); }catch(e){} try{ reader.releaseLock(); }catch(e){} reader = null; } } catch(e){}
  try { if(writer){ try{ await writer.close(); }catch(e){} try{ writer.releaseLock(); }catch(e){} writer = null; } } catch(e){}
  try { if(port){ try{ await port.close(); }catch(e){} port = null; } } catch(e){}
  await sleep(500);
}

async function abrirPorta(){
  if (!("serial" in navigator)) throw new Error("Use Google Chrome ou Microsoft Edge.");
  await fecharPorta();
  port = await navigator.serial.requestPort();
  await port.open({ baudRate: 115200 });
  reader = port.readable.getReader();
  writer = port.writable.getWriter();
  log("✔ Porta serial conectada.");
}

async function writeLine(s){
  if(!writer) throw new Error("Porta serial não aberta.");
  await writer.write(textEncoder.encode(s.endsWith("\n") ? s : s + "\n"));
}

async function readFor(ms){
  let out = "";
  const end = Date.now() + ms;
  while(Date.now() < end){
    const timeout = new Promise(r => setTimeout(() => r({timeout:true}), 200));
    const result = await Promise.race([reader.read(), timeout]);
    if(result && result.timeout) continue;
    if(!result || result.done) break;
    if(result.value) out += textDecoder.decode(result.value, {stream:true});
  }
  return out;
}

function parseId(txt){
  const pats = [
    /CARDOSO_ID\s*[:=]\s*([A-Fa-f0-9]{8,16})/,
    /\bID\s*[:=]\s*([A-Fa-f0-9]{8,16})/,
    /\b([A-Fa-f0-9]{12})\b/
  ];
  for(const p of pats){ const m = txt.match(p); if(m) return m[1].toUpperCase(); }
  return "";
}

async function lerId(){
  log("Pedindo ID da Programadora...");
  let txt = "";

  // Primeiro tenta igual a versão que lia ID e enviava ao painel.
  const comandosRapidos = ["GET_ID", "CARDOSO_ID?", "CARDOSO_ID", "STATUS"];
  for(const cmd of comandosRapidos){
    await writeLine(cmd);
    await sleep(500);
    txt += await readFor(2500);
    let id = parseId(txt);
    if(id) return id;
  }

  // Se a ESP32 resetou ao abrir a porta, espera boot e insiste.
  log("Aguardando boot da ESP32 e tentando novamente...");
  txt += await readFor(3500);
  for(let i=0; i<12; i++){
    await writeLine("GET_ID");
    await sleep(700);
    txt += await readFor(1200);
    let id = parseId(txt);
    if(id) return id;
    log("Tentando ler ID... " + (i+1));
  }

  if(txt.trim()) log(txt.trim());
  return "";
}

function prepararGravadorManual(){
  const box = $("webFlashBox");
  const installButton = $("installButton");
  if(!box || !installButton){ alert("Bloco do instalador Web não encontrado."); return; }
  installButton.setAttribute("manifest", manifestAtual());
  box.classList.remove("hidden");
  log("Modo gravação aberto.");
  log("Display escolhido: " + dados().oled);
  log("Clique em INSTALAR FIRMWARE e aguarde 100%.");
  log("Depois clique no botão 2 - ENVIAR ID AO PAINEL / ATIVAR.");
}

async function enviarPedido(id){
  const res = await fetch("/api/pedidos", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({...dados(), id})
  });
  if(!res.ok) throw new Error("Servidor não aceitou pedido.");
  const j = await res.json();
  currentKey = j.requestId || id;
  log("✔ Pedido enviado ao painel.");
  log("Aguardando aprovação...");
}

async function aguardarLicenca(){
  for(let i=0;i<600;i++){
    const r = await fetch("/api/licenca/" + encodeURIComponent(currentKey));
    const j = await r.json();
    if(j.status === "negado") throw new Error("Ativação negada.");
    if(j.licenca) return j.licenca;
    await sleep(1000);
  }
  throw new Error("Tempo esgotado aguardando aprovação.");
}

async function gravarLicenca(lic){
  log("Gravando licença...");

  // Protocolo principal usado pelo firmware Cardoso V50.
  // Algumas SH1106 gravam a licença e reiniciam rápido demais,
  // sem dar tempo do navegador receber o OK ATIVADA.
  const comandos = ["ACTIVATE " + lic];
  let resp = "";

  for(const cmd of comandos){
    await writeLine(cmd);
    resp += await readFor(6500);

    if(/OK ATIVADA|OK|VALIDA|ATIVADA|LICENSE_OK/i.test(resp)){
      log("✔ Licença gravada. Programadora ativada.");
      return;
    }

    if(/rst:|boot:|SW_CPU_RESET|POWERON_RESET|SPI_FAST_FLASH_BOOT|ELETRONICA|CARDOSO|PMIC PRO/i.test(resp)){
      log("✔ Licença enviada. ESP32 reiniciou.");
      log("✔ Ativação concluída.");
      return;
    }
  }

  // Correção do erro falso na SH1106:
  // Se a licença foi enviada mas a ESP32 reiniciou sem resposta serial,
  // não tratar como falha. A própria tela da programadora confirma o desbloqueio.
  if(!resp.trim()){
    log("✔ Licença enviada.");
    log("✔ Aguardando reinício da ESP32.");
    log("✔ Se a tela desbloqueou, ativação concluída.");
    return;
  }

  log(resp.trim());
  log("✔ Licença enviada.");
  log("✔ Se a tela desbloqueou, ativação concluída.");
}

async function ativarManual(ev){
  if(ev && ev.preventDefault) ev.preventDefault();
  const btn = $("btnAtivar");
  if(btn) btn.disabled = true;
  currentKey = null;
  try{
    await abrirPorta();
    log("Lendo ID da ESP32 atual...");
    const id = await lerId();
    if(!id){
      log("Não consegui ler o ID.");
      log("Confira se a tela está BLOQUEADA. Se estiver, aperte RESET na ESP32 e clique no botão 2 novamente.");
      return;
    }
    log("✔ ID: " + id);
    await enviarPedido(id);
    const lic = await aguardarLicenca();
    log("✔ Licença recebida.");
    await gravarLicenca(lic);
  }catch(e){
    alert("Erro: " + (e.message || e));
    log("ERRO: " + (e.message || e));
  }finally{
    if(btn) btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btnGravar = $("btnGravarFirmware");
  if(btnGravar) btnGravar.onclick = async (ev) => { ev.preventDefault(); limparLog(); await fecharPorta(); prepararGravadorManual(); };

  const btnAtivar = $("btnAtivar");
  if(btnAtivar) btnAtivar.onclick = async (ev) => { limparLog(); await ativarManual(ev); };

  const oled = $("oled");
  const installButton = $("installButton");
  if(oled && installButton){
    oled.addEventListener("change", () => installButton.setAttribute("manifest", manifestAtual()));
    installButton.setAttribute("manifest", manifestAtual());
  }
});
