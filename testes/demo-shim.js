// Ad+ Saúde · MODO TESTE (sem servidor)
// Substitui a camada do Supabase por um banco local no navegador (localStorage), com dados FICTÍCIOS.
// Mesma interface "claude.use('db'|'user'|'sample'|'downloads')" usada pelo sistema.
// Nada aqui fala com servidor: nenhum dado sai do navegador.
(function(){
  'use strict';
  var C=window.__CLIN||{slug:'teste',nome:'Clínica de teste',curto:'Teste',salas:[],specs:[],profs:[]};
  var KEY='adplus-teste:'+C.slug, UKEY=KEY+':usuario', VER=4;

  // ---------- utilidades ----------
  function uid(){var a=new Uint8Array(10);crypto.getRandomValues(a);return Array.prototype.map.call(a,function(b){return ('0'+b.toString(16)).slice(-2)}).join('')}
  function clone(o){return o==null?o:JSON.parse(JSON.stringify(o))}
  function pad(n){return n<10?'0'+n:''+n}
  function ds(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
  function addD(d,n){var x=new Date(d.getFullYear(),d.getMonth(),d.getDate()+n);return x}
  function rng(seed){var h=2166136261;for(var i=0;i<seed.length;i++){h^=seed.charCodeAt(i);h=Math.imul(h,16777619)}return function(){h+=0x6D2B79F5;var t=h;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296}}
  function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
  function lsSet(k,v){try{localStorage.setItem(k,v);return true}catch(e){return false}}
  function lsDel(k){try{localStorage.removeItem(k)}catch(e){}}

  // ---------- dados de exemplo (fictícios) ----------
  var FN_F=['Ana','Beatriz','Carla','Daniela','Eduarda','Fabiana','Gabriela','Heloísa','Isadora','Joana','Karina','Lúcia','Maria Clara','Natália','Olívia','Paula','Quitéria','Renata','Sabrina','Tânia','Valéria','Yasmin','Alice','Cecília','Laura','Manuela','Sofia','Valentina','Helena','Lorena'];
  var FN_M=['André','Bernardo','Caio','Davi','Enzo','Felipe','Gustavo','Heitor','Igor','João Pedro','Kauã','Lucas','Mateus','Nicolas','Otávio','Pedro','Rafael','Samuel','Thiago','Vítor','Arthur','Benjamin','Gael','Miguel','Theo','Wesley','Cristiano','Diego','Emanuel','Jonas'];
  var SN=['Almeida','Barbosa','Cardoso','Dias','Esteves','Ferreira','Gomes','Henriques','Lima','Machado','Nunes','Oliveira','Pereira','Queiroz','Ramos','Santos','Teixeira','Vieira','Xavier','Zanetti','Araújo','Borges','Carvalho','Duarte','Freitas','Moraes','Rocha','Souza','Campos','Pinto'];
  var GYN=/gineco|obst|gyn|colpo|mastol/i.test(C.area+' '+C.nome);
  function seed(){
    var R=rng(C.slug), T=new Date(), today=ds(T), nowMin=T.getHours()*60+T.getMinutes(), now=Date.now();
    var pick=function(a){return a[Math.floor(R()*a.length)]};
    var docs={professionals:{},profdata:{},specialties:{},patients:{},appointments:{},config:{},notifs:{}};
    var rooms=(C.salas||[]).map(function(n,i){return {id:'r'+(i+1),name:n}});
    docs.config.rooms={list:rooms};
    var specIds=(C.specs||[]).map(function(s,i){var id='sp'+(i+1);
      docs.specialties[id]={name:s.n,procs:s.procs.map(function(p){return {n:p[0],d:p[1],v:p[2],ret:p[3]||0}}),retDias:30};return id});
    var profs=[],users=[
      {id:'u-admin',email:'admin@teste.invalid',name:'Administração (teste)',role:'admin',prof_id:null,active:true},
      {id:'u-recep',email:'recepcao@teste.invalid',name:'Recepção (teste)',role:'recepcao',prof_id:null,active:true}];
    (C.profs||[]).forEach(function(p,i){
      var id='pf'+(i+1),room=rooms[i]?rooms[i].id:null,sched={};
      p.dias.forEach(function(d){sched[d]=p.h.map(function(iv){return room?[iv[0],iv[1],room]:[iv[0],iv[1]]})});
      var d={name:p.n,spec:specIds[p.s],reg:p.reg,rqe:'',sexo:p.sx||'',slot:p.slot||15,retDur:null,ageMin:null,ageMax:null,sched:sched,days:p.dias.slice(),
        from:Math.min.apply(null,p.h.map(function(x){return x[0]})),to:Math.max.apply(null,p.h.map(function(x){return x[1]})),lunch:null,rt:'pct',rv:50,active:true,kind:p.k||'',local:room?rooms[i].name:'Sala',createdAt:now-86400000*60};
      docs.professionals[id]=d;
      docs.profdata[id]={cpf:'',nasc:'',tel:'',wa:'',mail:'prof'+(i+1)+'@teste.invalid',agendaMail:false};
      profs.push({id:id,d:d,p:p});
      users.push({id:'u-'+id,email:'prof'+(i+1)+'@teste.invalid',name:p.n,role:'profissional',prof_id:id,active:true});
    });
    // pacientes
    var nPt=C.plano==='centro'?90:35,pts=[];
    for(var k=0;k<nPt;k++){
      var fem=GYN?true:R()<0.6,kid=!GYN&&R()<0.22,age=kid?2+Math.floor(R()*15):18+Math.floor(R()*62);
      var s1=pick(SN),s2=pick(SN);while(s2===s1)s2=pick(SN);var nm=pick(fem?FN_F:FN_M)+' '+s1+' '+s2;
      var b=addD(T,-Math.floor(age*365.25+R()*360));
      var id='pt'+(k+1),pt={name:nm,cel:'(61) 90000-'+String(1000+k).slice(-4),nasc:ds(b),cpf:'',sexo:fem?'F':'M',pront:k+1,createdAt:now-86400000*(90-k%90)};
      docs.patients[id]=pt;pts.push({id:id,age:age,fem:fem,name:nm});
    }
    function ptFor(proc){
      var kids=/infantil|pediátr|puericult|olhinho|ludo/i.test(proc),teen=/adolescente/i.test(proc);
      var pool=pts.filter(function(x){return kids?x.age<12:teen?(x.age>=12&&x.age<18):x.age>=18});
      return pick(pool.length?pool:pts);
    }
    // agenda: 4 dias para trás e 5 para frente
    for(var off=-4;off<=5;off++){
      var day=addD(T,off),dd=ds(day),dow=day.getDay();
      profs.forEach(function(pf){
        var iv=pf.d.sched[dow];if(!iv)return;
        var sp=docs.specialties[pf.d.spec],procs=sp.procs.filter(function(x){return !(x.ret>0)}),max=C.plano==='centro'?8:5,list=[];
        var perSeg=Math.ceil(max/iv.length);
        iv.forEach(function(seg){
          var t=seg[0],n=0,skip=Math.max(0.2,1-perSeg*45/Math.max(45,seg[1]-seg[0]));
          while(t<seg[1]&&n<perSeg){
            var px=pick(procs),dur=px.d;
            if(t+dur>seg[1])break;
            if(R()<skip){t+=pf.d.slot*(1+Math.floor(R()*3));continue}
            list.push({t:t,px:px,seg:seg});n++;
            t+=Math.max(pf.d.slot,dur);t=seg[0]+Math.ceil((t-seg[0])/pf.d.slot)*pf.d.slot;
          }
        });
        var done=Math.floor(list.length*0.4);
        list.forEach(function(it,ix){
            var t=it.t,px=it.px,seg=it.seg,dur=px.d,pt=ptFor(px.n),st;
            if(off<0)st=R()<0.85?3:R()<0.5?6:11;
            else if(off===0)st=ix<done?(R()<0.9?3:6):ix===done?4:(R()<0.6?7:1);
            else st=R()<0.4?7:1;
            var paid=st===3||st===4,a={roomId:seg[2]||'',local:seg[2]?(rooms.filter(function(r){return r.id===seg[2]})[0]||{}).name:pf.d.local,prof:pf.id,date:dd,start:t,dur:dur,proc:px.n,val:px.v,conv:'Particular',status:st,obs:'',encaixe:false,retorno:false,retOf:'',
              pid:pt.id,pac:pt.name,paid:paid,forma:paid?pick(['Pix','Cartão de débito','Dinheiro','Cartão de crédito']):'',log:[{s:st,t:dd.slice(8)+'/'+dd.slice(5,7)+' 08:00'}],by:'u-recep',at:now};
            if(paid){a.pago=px.v;a.parc=1;a.pays=[];a.payDay=dd;a.famPend=false;a.checkinMin=Math.max(0,t-10)}
            if(st===3){a.startedAt=new Date(day.getFullYear(),day.getMonth(),day.getDate(),0,t).getTime();a.endedAt=a.startedAt+dur*60000;a.durSec=dur*60}
            docs.appointments['ag'+off+'-'+pf.id+'-'+t]=a;
        });
      });
    }
    return {v:VER,seededAt:today,docs:docs,profiles:users,invites:{}};
  }

  var mem=null;
  (function(){var t=lsGet(KEY);if(t){try{var o=JSON.parse(t);if(o&&o.v===VER&&(o.touched||o.seededAt===ds(new Date())))mem=o}catch(e){}}if(!mem){mem=seed();lsSet(KEY,JSON.stringify(mem))}})();
  var saveT=null;
  function persist(){clearTimeout(saveT);saveT=setTimeout(function(){if(!lsSet(KEY,JSON.stringify(mem)))try{console.warn('[Ad+ teste] não foi possível guardar no navegador; os dados ficam só nesta aba.')}catch(e){}},60)}
  window.addEventListener('storage',function(e){if(e.key===KEY&&e.newValue){try{mem=JSON.parse(e.newValue);bump()}catch(x){}}});

  // ---------- usuário atual (troca de perfil para testar) ----------
  var curId=lsGet(UKEY)||'u-admin';
  function prof(){return mem.profiles.filter(function(p){return p.id===curId})[0]||mem.profiles[0]}
  var profile=prof();curId=profile.id;

  // ---------- papel timbrado de teste (gerado na hora) ----------
  try{
    var cv=document.createElement('canvas');cv.width=1240;cv.height=1754;var g=cv.getContext('2d'),cor=C.cor||'#004346';
    g.fillStyle='#fff';g.fillRect(0,0,1240,1754);
    g.fillStyle=cor;g.fillRect(0,0,1240,14);g.fillRect(0,1740,1240,14);
    g.fillStyle=cor;g.font='600 46px Georgia,serif';g.fillText(C.nome,90,120);
    g.fillStyle='#5C6B70';g.font='26px Arial,sans-serif';g.fillText(C.area||'',90,165);
    g.strokeStyle=cor;g.lineWidth=3;g.beginPath();g.moveTo(90,200);g.lineTo(1150,200);g.stroke();
    g.beginPath();g.moveTo(90,1620);g.lineTo(1150,1620);g.lineWidth=1.5;g.stroke();
    g.fillStyle='#5C6B70';g.font='22px Arial,sans-serif';g.fillText((C.tel||'')+' · Planaltina-DF',90,1665);
    g.textAlign='right';g.fillStyle='#B23B3B';g.font='600 22px Arial,sans-serif';g.fillText('DOCUMENTO DE TESTE · SEM VALIDADE',1150,1665);
    g.save();g.translate(620,900);g.rotate(-Math.PI/5);g.textAlign='center';g.fillStyle='rgba(178,59,59,.07)';g.font='700 150px Arial,sans-serif';g.fillText('TESTE',0,0);g.restore();
    window.__CLIN_LH=cv.toDataURL('image/jpeg',0.85);
  }catch(e){window.__CLIN_LH=''}

  // ---------- barra "modo teste" ----------
  function roleTxt(p){return p.role==='admin'?'Administrador':p.role==='recepcao'?'Recepção':'Profissional'}
  function bar(){
    var css=document.createElement('style');css.textContent=
      '#tstPill{position:fixed;left:12px;bottom:12px;z-index:99990;font:600 12px/1.2 Figtree,system-ui,sans-serif;background:#B23B3B;color:#fff;border:0;border-radius:999px;padding:8px 14px;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer;max-width:70vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
      '#tstBox{position:fixed;left:12px;bottom:56px;z-index:99991;width:min(340px,calc(100vw - 24px));max-height:70vh;overflow:auto;background:var(--surface,#fff);color:var(--fg,#123);border:1px solid var(--border,#ccd);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.3);padding:14px;font:14px/1.4 Figtree,system-ui,sans-serif}'+
      '#tstBox h3{margin:0 0 2px;font-size:15px}#tstBox p{margin:0 0 10px;font-size:12px;opacity:.75}'+
      '#tstBox button.u{display:flex;justify-content:space-between;gap:8px;width:100%;text-align:left;border:1px solid var(--border,#dde);background:transparent;color:inherit;border-radius:10px;padding:8px 10px;margin:0 0 6px;cursor:pointer;font:inherit}'+
      '#tstBox button.u[aria-current=true]{border-color:#B23B3B;box-shadow:inset 0 0 0 1px #B23B3B}#tstBox button.u small{opacity:.65;white-space:nowrap}'+
      '#tstBox .row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}#tstBox .row a,#tstBox .row button{flex:1;text-align:center;border:1px solid var(--border,#dde);border-radius:10px;padding:8px;background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer;text-decoration:none}';
    document.head.appendChild(css);
    var b=document.createElement('button');b.id='tstPill';b.type='button';b.textContent='TESTE · '+roleTxt(profile)+(profile.role==='profissional'?': '+profile.name.split(' ')[0]:'');b.title='Ambiente de teste com dados fictícios. Toque para trocar de perfil.';
    document.body.appendChild(b);
    var box=null;
    function close(){if(box){box.remove();box=null}}
    function open(){
      if(box)return close();
      box=document.createElement('div');box.id='tstBox';box.setAttribute('role','dialog');box.setAttribute('aria-label','Modo teste');
      box.innerHTML='<h3>'+esc(C.nome)+'</h3><p>Ambiente de TESTE: pacientes, profissionais e valores são fictícios e ficam só neste navegador. O prontuário só aparece para o perfil Profissional.</p>'+
        mem.profiles.map(function(p){return '<button type="button" class="u" data-u="'+p.id+'" aria-current="'+(p.id===curId)+'"><span>'+esc(p.name)+'</span><small>'+roleTxt(p)+'</small></button>'}).join('')+
        '<div class="row"><a href="../index.html">Todas as clínicas</a><button type="button" id="tstReset">Restaurar dados de exemplo</button></div>';
      document.body.appendChild(box);
      box.addEventListener('click',function(e){var u=e.target.closest('[data-u]');if(u){lsSet(UKEY,u.getAttribute('data-u'));location.reload();return}
        if(e.target.id==='tstReset'){if(e.target.dataset.arm){lsDel(KEY);lsDel(UKEY);location.reload()}else{e.target.dataset.arm=1;e.target.textContent='Toque de novo para confirmar'}}});
    }
    b.addEventListener('click',open);
    document.addEventListener('keydown',function(e){if(e.key==='Escape')close()});
    window.__tstOpen=open;
  }
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  if(document.body)bar();else document.addEventListener('DOMContentLoaded',bar);
  document.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('#logoutBtn')){e.preventDefault();e.stopPropagation();if(window.__tstOpen)window.__tstOpen()}},true);

  // ---------- banco local ----------
  function mk(id,data){return {id:id,exists:data!=null,data:function(){return clone(data)},metadata:{}}}
  function split(path){var a=path.split('/'),id=a.pop();return [a.join('/'),id]}
  function fail(code,m){return {code:code||'error',message:m||''}}
  function cmp(a,op,b){return op==='=='?a===b:op==='>='?a>=b:op==='<='?a<=b:op==='<'?a<b:op==='>'?a>b:op==='!='?a!==b:op==='in'?(b||[]).indexOf(a)>-1:op==='array-contains'?(a||[]).indexOf(b)>-1:true}
  function coll(c){return mem.docs[c]||(mem.docs[c]={})}
  function isAdm(){return profile.role==='admin'}

  function rowsOf(c,filters){
    var out=[];
    if(c==='access'||c==='staff'){
      out=mem.profiles.map(function(p){return c==='access'?{id:p.id,data:{role:p.role==='pendente'?'':p.role,prof:p.prof_id,active:p.active}}:{id:p.id,data:{email:p.email,name:p.name,seen:0}}});
    }else if(c==='invites'){
      out=Object.keys(mem.invites).map(function(k){var i=mem.invites[k];return {id:k,data:{role:i.role,prof:i.prof_id,name:i.name}}});
    }else{
      var o=coll(c);out=Object.keys(o).sort().map(function(k){return {id:k,data:clone(o[k])}});
    }
    filters.forEach(function(f){out=out.filter(function(x){return cmp(x.data[f[0]],f[1],f[2])})});
    return out;
  }

  function sigOf(v){try{if(v&&v.docs)return v.docs.map(function(d){return d.id+JSON.stringify(d.data())}).join('\u0001');if(v&&v.data)return v.id+JSON.stringify(v.data())}catch(e){}return null}
  var GOS=[];
  function bump(){setTimeout(function(){GOS.slice().forEach(function(g){g()})},60)}
  function watch(run,next,err){
    var alive=true,last=null;
    function go(){run().then(function(v){if(!alive)return;var sg=sigOf(v);if(sg!==null&&sg===last)return;last=sg;next(v)}).catch(function(e){if(alive&&err)err(e)})}
    GOS.push(go);go();
    return function(){alive=false;var i=GOS.indexOf(go);if(i>-1)GOS.splice(i,1)};
  }

  function query(c,filters,ord,lim){
    function run(){
      return Promise.resolve().then(function(){
        var rows=rowsOf(c,filters);
        if(ord){rows.sort(function(a,b){var x=a.data[ord[0]],y=b.data[ord[0]];return (x>y?1:x<y?-1:0)*(ord[1]==='desc'?-1:1)})}
        if(lim)rows=rows.slice(0,lim);
        var docs=rows.map(function(r){return mk(r.id,r.data)});
        return {docs:docs,size:docs.length,empty:!docs.length};
      });
    }
    return {
      where:function(f,op,v){return query(c,filters.concat([[f,op,v]]),ord,lim)},
      orderBy:function(f,d){return query(c,filters,[f,d||'asc'],lim)},
      limit:function(n){return query(c,filters,ord,n)},
      get:run,
      onSnapshot:function(next,err){return watch(run,next,err)}
    };
  }

  function docRef(path){
    var p=split(path),c=p[0],id=p[1];
    function readOne(){return Promise.resolve().then(function(){
      if(c==='access'||c==='staff'||c==='invites'){var r=rowsOf(c,[]).filter(function(x){return x.id===id})[0];return mk(id,r?r.data:null)}
      var o=coll(c);return mk(id,o.hasOwnProperty(id)?o[id]:null)})}
    function w(fn){return Promise.resolve().then(fn).then(function(r){if(!/^(config|access|staff|chatpres|chatread|accesslog|notifs)$/.test(c))mem.touched=true;persist();bump();return r})}
    function pr(){return mem.profiles.filter(function(x){return x.id===id})[0]}
    return {
      id:id,path:path,
      get:readOne,
      set:function(d){d=clone(d);return w(function(){
        if(c==='access'){if(!isAdm())throw fail('permission_denied');var x=pr();if(x){x.role=d.role||'pendente';x.prof_id=d.prof||null;x.active=d.active!==false}return}
        if(c==='staff')return;
        if(c==='invites'){mem.invites[id.toLowerCase()]={role:d.role,prof_id:d.prof||null,name:d.name||null};return}
        coll(c)[id]=d})},
      update:function(d){d=clone(d);
        if(c==='access'||c==='staff'||c==='invites')return docRef(path).set(d);
        return w(function(){var o=coll(c),cur=o[id]||{};Object.keys(d).forEach(function(k){cur[k]=d[k]});o[id]=cur})},
      delete:function(){return w(function(){
        if(c==='access'){var x=pr();if(x){x.role='pendente';x.prof_id=null}return}
        if(c==='staff')return;
        if(c==='invites'){delete mem.invites[id];return}
        delete coll(c)[id]})},
      onSnapshot:function(next,err){return watch(readOne,next,err)}
    };
  }

  var db={
    doc:docRef,
    collection:function(c){
      var base=query(c,[],null,null);
      base.doc=function(id){return docRef(c+'/'+(id||uid()))};
      base.add=function(d){var r=base.doc();return r.set(d).then(function(){return r})};
      return base;
    },
    setMyName:function(n){profile.name=n;persist();bump();return Promise.resolve()},
    chatPeople:function(){return Promise.resolve(mem.profiles.filter(function(p){return p.role!=='pendente'}).map(function(p){return {id:p.id,name:p.name,role:p.role}}))},
    sendReset:function(){return Promise.reject(new Error('Modo teste: não envia e-mails.'))},
    sendInvite:function(email){
      // no teste, o convite já cria o usuário para poder trocar para ele na barra TESTE
      email=String(email).toLowerCase();var inv=mem.invites[email]||{};
      if(!mem.profiles.some(function(p){return p.email===email})){mem.profiles.push({id:'u-'+uid().slice(0,8),email:email,name:inv.name||email,role:inv.role||'pendente',prof_id:inv.prof_id||null,active:true});persist();bump()}
      return Promise.resolve();
    }
  };

  var user={
    isOwner:function(){return Promise.resolve(profile.role==='admin'&&profile.active!==false)},
    canEdit:function(){return Promise.resolve(profile.role==='admin')},
    can:function(){return Promise.resolve(profile.role!=='pendente'&&profile.active!==false)},
    id:function(){return Promise.resolve(profile.id)},
    me:function(){return Promise.resolve({id:profile.id,name:profile.name||profile.email,email:profile.email,isOwner:profile.role==='admin'})},
    profiles:function(ids){var out={};[].concat(ids).forEach(function(i){var p=mem.profiles.filter(function(x){return x.id===i})[0];if(p)out[i]={id:p.id,name:p.name||p.email,guest:false}});return Promise.resolve(out)}
  };

  var downloads={save:function(o){return new Promise(function(res){
    var blob=o.data instanceof Blob?o.data:new Blob([o.data],{type:/\.pdf$/i.test(o.filename)?'application/pdf':'application/octet-stream'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=o.filename;document.body.appendChild(a);a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();res()},500);
  })}};

  var auth=document.getElementById('auth');if(auth)auth.hidden=true;
  window.claude={use:function(name){
    if(name==='db')return Promise.resolve(db);
    if(name==='user')return Promise.resolve(user);
    if(name==='downloads')return Promise.resolve(downloads);
    if(name==='sample')return Promise.resolve(window.__sample||null);
    return Promise.resolve(null);
  }};
  window.__sb=null;
  window.__TESTE=true;
})();
