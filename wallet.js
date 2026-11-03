(function(){
  'use strict';
  window.__FFX_AUTH__ = window.__FFX_AUTH__ || {loggedIn:false,user:null};
  const $ = id => document.getElementById(id);
  const msg = (id,t) => { const e=$(id); if(e)e.textContent=t; };
  async function api(url, options={}) {
    const response = await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
    let data={}; try{data=await response.json()}catch(e){}
    if(!response.ok) throw new Error(data.error || 'অনুরোধটি সম্পন্ন হয়নি');
    return data;
  }
  function toast(text){const t=$('toast');if(!t)return;t.textContent=text;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2600)}
  function openBox(id){$(id).classList.add('open');document.body.style.overflow='hidden'}
  function closeBox(id){$(id).classList.remove('open');document.body.style.overflow=''}
  function authOpen(mode){$('authTitle').textContent=mode==='register'?'Create Account':'Sign In';$('authNameWrap').hidden=mode!=='register';$('authSubmit').textContent=mode==='register'?'Sign Up':'Sign In';$('authMode').value=mode;$('authError').textContent='';$('authSwitch').textContent=mode==='register'?'Sign In':'Create Account';openBox('authBox')}
  function profile(user){
    window.__FFX_AUTH__.user=user||null;window.__FFX_AUTH__.loggedIn=!!user;
    if(typeof window.setProfile==='function')window.setProfile(user?{loggedIn:true,name:user.name,email:user.email,balance:Number(user.balance||0),orders:0,codes:0}:{loggedIn:false});
    const accName=$('accName'),accMail=$('accMail'),accLo=$('accLo');
    if(accName)accName.textContent=user?'Hi, '+user.name:'Hi, Guest';
    if(accMail)accMail.textContent=user?user.email:'লগইন করে অর্ডার করুন';
    if(accLo)accLo.querySelector('span').textContent=user?'Logout':'Login';
    window.dispatchEvent(new Event('ffx-auth-change'));
  }
  async function refresh(){try{const d=await api('/api/auth/me');profile(d.user)}catch(e){profile(null)}}
  async function logout(){try{await api('/api/auth/logout',{method:'POST'});profile(null);toast('Logout হয়েছে')}catch(e){toast(e.message)}}
  async function submitAuth(e){e.preventDefault();const mode=$('authMode').value;const body={email:$('authEmail').value.trim(),password:$('authPassword').value};if(mode==='register')body.name=$('authName').value.trim();try{const d=await api(mode==='register'?'/api/auth/register':'/api/auth/login',{method:'POST',body:JSON.stringify(body)});profile(d.user);closeBox('authBox');$('authPassword').value='';toast('Login সফল হয়েছে')}catch(err){msg('authError',err.message)}}
  async function openDeposit(){if(!window.__FFX_AUTH__.loggedIn){authOpen('login');return}openBox('depositBox');msg('depositError','');try{const s=await api('/api/payment-settings');$('payBkash').textContent=s.bkash_number||'Admin এখনো নম্বর সেট করেনি';$('payNagad').textContent=s.nagad_number||'Admin এখনো নম্বর সেট করেনি';await loadMine()}catch(e){msg('depositError',e.message)}}
  async function loadMine(){try{const d=await api('/api/deposits/mine');const list=$('myDeposits');list.innerHTML='';if(!d.deposits.length){list.textContent='এখনো কোনো আবেদন নেই';return}d.deposits.forEach(x=>{const el=document.createElement('div');el.className='ffx-deposit-item';const title=document.createElement('b');title.textContent=`৳${Number(x.amount).toFixed(2)} · ${x.method} · ${x.status}`;const detail=document.createElement('small');detail.textContent=`TrxID: ${x.trxid} · ${new Date(x.created_at).toLocaleString()}`;el.append(title,detail);list.append(el)})}catch(e){msg('depositError',e.message)}}
  async function submitDeposit(e){e.preventDefault();const body={amount:$('depAmount').value,method:$('depMethod').value,sender_number:$('depSender').value.trim(),trxid:$('depTrxid').value.trim()};try{const d=await api('/api/deposits',{method:'POST',body:JSON.stringify(body)});msg('depositError',d.message);$('depositForm').reset();await loadMine()}catch(err){msg('depositError',err.message)}}
  document.addEventListener('DOMContentLoaded',()=>{
    $('authForm').addEventListener('submit',submitAuth);$('depositForm').addEventListener('submit',submitDeposit);
    $('authSwitch').onclick=()=>authOpen($('authMode').value==='login'?'register':'login');
    document.querySelectorAll('[data-ffx-close]').forEach(b=>b.addEventListener('click',()=>closeBox(b.dataset.ffxClose)));
    ['authBox','depositBox'].forEach(id=>$(id).addEventListener('click',e=>{if(e.target===$(id))closeBox(id)}));
    const loginHandler=e=>{e.preventDefault();e.stopImmediatePropagation();if(window.__FFX_AUTH__.loggedIn)logout();else authOpen('login')};
    ['accLo','acLogout'].forEach(id=>{if($(id))$(id).addEventListener('click',loginHandler,true)});
    const addHandler=e=>{e.preventDefault();e.stopImmediatePropagation();openDeposit()};
    ['acAdd'].forEach(id=>{if($(id))$(id).addEventListener('click',addHandler,true)});
    document.querySelectorAll('nav.nav a.add,.acc-it[data-go="addmoney"]').forEach(el=>el.addEventListener('click',addHandler,true));
    ['buyBtn','uidBuy','wmBuy','wlBuy','luBuy','inBuy'].forEach(id=>{if($(id))$(id).addEventListener('click',e=>{if(!window.__FFX_AUTH__.loggedIn){e.preventDefault();e.stopImmediatePropagation();authOpen('login')}},true)});
    refresh();
  });
})();
