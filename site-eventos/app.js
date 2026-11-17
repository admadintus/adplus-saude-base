(function(){
'use strict';
var API='https://umkrepbjtnjwzgpujgxi.supabase.co/functions/v1/adintus-inscricao';
var $=function(i){return document.getElementById(i)};
var seg=location.pathname.replace(/^\/+|\/+$/g,'').toLowerCase();
var tok=((new URLSearchParams(location.search).get('e')||'').trim())||(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(seg)&&seg!=='index'?seg:''),EV=null;
var ICON={
pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/></svg>',
pes:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4"/></svg>',
din:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M14.6 9.2c-.5-.9-1.5-1.3-2.6-1.3-1.4 0-2.5.7-2.5 1.8 0 2.5 5.2 1.3 5.2 3.9 0 1.1-1.2 1.9-2.7 1.9-1.2 0-2.3-.5-2.8-1.5M12 6.6v1.3m0 8.2v1.3"/></svg>',
vag:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5z"/><path d="M14 6v12" stroke-dasharray="2 2.4"/></svg>'};
function show(id){['carregando','aviso','form','ok'].forEach(function(k){$(k).hidden=(k!==id)})}
function aviso(t,x){$('avTit').textContent=t;$('avTxt').textContent=x;show('aviso')}
function fmtData(s){if(!s)return '';var p=s.split('-');if(p.length!==3)return s;var d=new Date(+p[0],+p[1]-1,+p[2]);return d.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
function brl(v){return (+v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
function setErr(k,m){var e=$('e-'+k);if(e)e.textContent=m||''}
function clearErr(){['nome','tel','gest','sem','motivo','acNome','acPar','lgpd','geral'].forEach(function(k){setErr(k,'')})}
function radio(n){var r=document.querySelector('input[name="'+n+'"]:checked');return r?r.value:''}
function load(){
  if(!tok){aviso('Link incompleto','Confira o endereço que você recebeu ou peça o link de novo à clínica.');return}
  fetch(API+'?e='+encodeURIComponent(tok)).then(function(r){return r.json().then(function(j){return {s:r.status,j:j}})}).then(function(x){
    if(!x.j.ok){aviso(x.s===404?'Link não encontrado':'Tente de novo',x.j.erro||'Não foi possível abrir este evento agora.');return}
    EV=x.j.evento;
    if(!EV.aberto){aviso(EV.motivo_fechado==='encerrado'?'Este evento já aconteceu':'Inscrições encerradas',EV.motivo_fechado==='encerrado'?'Obrigado pelo interesse. Fique de olho nos próximos eventos da clínica.':'As inscrições para '+EV.nome+' estão encerradas no momento. Fale com a clínica se tiver dúvidas.');return}
    $('evNome').textContent=EV.nome;
    var dp=(EV.data||'').split('-'),dt=dp.length===3?new Date(+dp[0],+dp[1]-1,+dp[2]):null;
    $('dSem').textContent=dt?dt.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.','').slice(0,3):'';
    $('dDia').textContent=dt?String(dt.getDate()):'';
    $('dMes').textContent=dt?dt.toLocaleDateString('pt-BR',{month:'short'}).replace('.','').slice(0,3):'';
    $('evQuando').textContent=fmtData(EV.data)+(EV.hora?' · '+EV.hora:'');
    var ch=$('evChips');ch.textContent='';
    function chip(ic,txt,cls){if(!txt)return;var li=document.createElement('li');if(cls)li.className=cls;li.innerHTML=ICON[ic];li.appendChild(document.createTextNode(txt));ch.appendChild(li)}
    chip('pin',EV.local);chip('pes',EV.ministrante);
    chip('din',EV.valor>0?brl(EV.valor):'Gratuito','valor');
    chip('vag',EV.livres>0?(EV.livres===1?'Última vaga':EV.livres+' vagas restantes'):'Vagas esgotadas',EV.livres>0&&EV.livres<=3?'poucas':'');
    $('selo').textContent=EV.livres>0?'Inscrições abertas':'Lista de espera';$('selo').className='selo'+(EV.livres>0?'':' espera-s');
    $('formTit').textContent=EV.livres>0?'Garanta a sua vaga':'Entre na lista de espera';
    $('evEspera').hidden=EV.livres>0;
    $('bl-acomp').hidden=!EV.acompanhante;
    $('enviar').textContent=EV.livres>0?'Quero me inscrever':'Entrar na lista de espera';
    document.title=EV.nome+' · Inscrição';show('form');
  }).catch(function(){aviso('Sem conexão','Não foi possível carregar. Confira sua internet e tente de novo.')});
}
document.addEventListener('input',function(e){var i=e.target&&e.target.id;if(i)setErr(i,'');setErr('geral','')});
document.addEventListener('change',function(e){var n=e.target&&e.target.name;if(n==='gest')setErr('gest','');if(n==='lgpd')setErr('lgpd','')});
document.addEventListener('change',function(e){
  var t=e.target;if(!t.name)return;
  if(t.name==='gest'){var g=radio('gest')==='sim';$('bl-sem').hidden=!g;$('bl-motivo').hidden=g}
  if(t.name==='acomp'){$('bl-ac').hidden=radio('acomp')!=='sim'}
});
$('tel').addEventListener('input',function(){var d=this.value.replace(/\D/g,'').slice(0,11),o=d;
  if(d.length>2)o='('+d.slice(0,2)+') '+d.slice(2);if(d.length>7)o='('+d.slice(0,2)+') '+d.slice(2,d.length>10?7:6)+'-'+d.slice(d.length>10?7:6);this.value=o});
$('f').addEventListener('submit',function(e){
  e.preventDefault();clearErr();if(!EV)return;
  var g=radio('gest'),ac=radio('acomp')==='sim'&&!$('bl-acomp').hidden,bad=false;
  var nome=$('nome').value.trim().replace(/\s+/g,' ');
  function need(c,k,m){if(c){setErr(k,m);if(!bad){var el=$(k)||document.querySelector('[name="'+k+'"]');if(el&&el.focus)el.focus();bad=true}}}
  need(nome.split(' ').length<2||nome.length<3,'nome','Informe seu nome completo (nome e sobrenome).');
  need($('tel').value.replace(/\D/g,'').length<10,'tel','Informe o WhatsApp com DDD.');
  need(!g,'gest','Informe se você está gestante.');
  need(g==='sim'&&!$('sem').value.trim(),'sem','Informe o tempo de gestação.');
  need(g==='nao'&&!$('motivo').value.trim(),'motivo','Conte o motivo da sua participação.');
  need(ac&&$('acNome').value.trim().length<3,'acNome','Informe o nome do acompanhante.');
  need(ac&&!$('acPar').value,'acPar','Informe o parentesco.');
  need(!$('lgpd').checked,'lgpd','Para se inscrever, é preciso concordar com o uso dos dados.');
  if(bad)return;
  var btn=$('enviar');btn.disabled=true;btn.textContent='Enviando…';
  var body={e:tok,nome:nome,tel:$('tel').value.replace(/\D/g,''),gest:g==='sim',sem:$('sem').value.trim(),motivo:$('motivo').value.trim(),acomp:ac,acNome:ac?$('acNome').value.trim():'',acPar:ac?$('acPar').value:'',lgpd:true,site:$('site').value};
  fetch(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){return {s:r.status,j:j}})}).then(function(x){
    btn.disabled=false;btn.textContent=EV.livres>0?'Quero me inscrever':'Entrar na lista de espera';
    if(x.j.ok){sucesso(x.j);return}
    if(x.j.campo){setErr(x.j.campo,x.j.erro);var el=$(x.j.campo);if(el&&el.focus)el.focus();return}
    if(x.j.codigo==='INSCRICOES_PAUSADAS'||x.j.codigo==='EVENTO_ENCERRADO'){aviso('Inscrições encerradas',x.j.erro);return}
    setErr('geral',x.j.erro||'Não foi possível enviar. Tente de novo.');
  }).catch(function(){btn.disabled=false;btn.textContent=EV.livres>0?'Quero me inscrever':'Entrar na lista de espera';setErr('geral','Sem conexão. Confira sua internet e tente de novo.')});
});
function sucesso(r){
  var nome=r.nome||'';
  $('pixBox').hidden=true;$('wa').hidden=true;$('okNota').textContent='';$('okBox').hidden=false;
  if(r.status==='espera'){
    $('okTit').textContent=(r.ja?'Você já está na lista de espera':'Você entrou na lista de espera')+(nome?', '+nome:'')+'!';
    $('okTxt').textContent='Se abrir uma vaga, a clínica avisa você pelo WhatsApp.';
  }else if(r.status==='confirmada'){
    $('okTit').textContent='Sua inscrição está confirmada'+(nome?', '+nome:'')+'!';
    $('okTxt').textContent='Sua vaga está garantida. Nos vemos no evento.';
  }else if(r.status==='aguardando'){
    $('okTit').textContent=(r.ja?'Você já tem inscrição':'Inscrição recebida')+(nome?', '+nome:'')+'!';
    if(r.valor>0&&r.pix){
      $('okTxt').textContent='Sua vaga está reservada, aguardando o pagamento. Pague '+brl(r.valor)+' por Pix e envie o comprovante para confirmar.';
      $('pix').textContent=r.pix;$('pixBox').hidden=false;
      if(r.wa){$('wa').href='https://wa.me/'+r.wa+'?text='+encodeURIComponent('Olá! Segue o comprovante da inscrição em '+EV.nome+'. Nome: '+nome);$('wa').hidden=false}
    }else{
      $('okTxt').textContent='Sua vaga está reservada. A clínica entra em contato pelo WhatsApp para confirmar.';
    }
    $('okNota').textContent='A vaga só fica garantida depois que a clínica confirmar o pagamento.';
  }else{
    $('okTit').textContent='Sua inscrição está registrada'+(nome?', '+nome:'')+'.';$('okTxt').textContent='A clínica vai entrar em contato pelo WhatsApp.';
  }
  $('okEv').textContent=EV?EV.nome:'';
  show('ok');window.scrollTo(0,0);
}
$('copiarPix').addEventListener('click',function(){var t=$('pix').textContent,b=this;
  function ok(){b.textContent='Chave copiada!';setTimeout(function(){b.textContent='Copiar chave Pix'},2000)}
  function fb(){var r=document.createRange();r.selectNodeContents($('pix'));var s=getSelection();s.removeAllRanges();s.addRange(r);b.textContent='Selecionada: copie com Ctrl+C'}
  try{navigator.clipboard.writeText(t).then(ok,fb)}catch(x){fb()}});
load();
})();
