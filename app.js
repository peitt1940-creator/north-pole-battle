import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,signInAnonymously,signInWithEmailAndPassword,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getDatabase,ref,onValue,set,runTransaction,get,update} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';
const $ = id => document.getElementById(id);
const firebaseConfig = window.northPoleFirebaseConfig;
if (!firebaseConfig) {
  $('setup').prepend('暫時無法取得 Firebase 設定，請重新整理。');
  $('teacherLogin').disabled = $('studentLogin').disabled = true;
  throw new Error('Firebase configuration unavailable');
}
const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getDatabase(app);
const symbols=['🎄','🎁','🔔','⭐','🦌','🍪','❄️','🧦','⛄','🛷','🍬','🎅','🧸','🕯️','🎀','🏠'];
const teams=['red','green','gold'],names={red:'紅隊',green:'綠隊',gold:'金隊'},events=['企鵝上班：本回合全員企鵝步','北極靜音：本回合只能手勢討論','麋鹿迷路：出發前原地轉一圈','精靈語言：發言前先說 Ho Ho Ho','雪人融化：以慢動作完成體能任務','聖誕導航故障：由平常最少發言的組員指揮'];
const initial=()=>({round:0,phase:'idle',board:Array(16).fill('empty'),event:'',history:[]});
let user=null,role=null,team=null,state=initial(),draft=[],kind='claim';
const isTeacher = () => role === 'teacher';
const boardArray=()=>Array.from({length:16},(_,i)=>state.board?.[i]||'empty');
const gameUrl = 'https://peitt1940-creator.github.io/north-pole-battle/';
let pairing = {};
let listeners = [];
let stopGame = () => {};
let submitting = false;
let ready = false;
let connected = false;

$('teacherLogin').onclick = async () => {
  const email = $('teacherEmail').value.trim();
  const password = $('teacherPassword').value;
  if (!email || !password) return alert('請輸入教師電子郵件和密碼');
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    alert('教師登入失敗：' + error.message);
  } finally {
    $('teacherPassword').value = '';
  }
};
$('studentLogin').onclick = async () => {
  try { await signInAnonymously(auth); } catch (error) { alert(error.message); }
};
$('logout').onclick = () => signOut(auth).catch(error => alert(error.message));

function showReadError(error) {
  $('connection').textContent = '無法讀取遊戲：' + error.code;
}

function applyState(publicState, submissions) {
  const next = publicState || initial();
  if (next.session !== state.session || next.round !== state.round || next.phase !== state.phase) draft = [];
  state = {...next, submissions};
  ready = true;
  render();
}

onAuthStateChanged(auth, async current => {
  listeners.forEach(stop => stop());
  listeners = [];
  stopGame();
  stopGame = () => {};
  user = current;
  team = null;
  state = initial();
  draft = [];
  ready = connected = submitting = false;
  $('setup').classList.remove('hide');
  $('app').classList.add('hide');
  pairing = {};
  $('joinStatus').textContent = '';
  if (!current) return;

  try {
    role = 'student';
    if (!current.isAnonymous) {
      const teacher = await get(ref(db, 'teachers/' + current.uid));
      if (user !== current) return;
      if (teacher.val() !== true) {
        await signOut(auth);
        return alert('這個帳號尚未取得教師權限');
      }
      role = 'teacher';
    }
  } catch (error) {
    if (user !== current) return;
    await signOut(auth);
    return alert('無法驗證教師權限：' + error.message);
  }

  $('setup').classList.add('hide');
  $('app').classList.remove('hide');
  $('teacherPanel').classList.toggle('hide', !isTeacher());
  $('studentPanel').classList.toggle('hide', isTeacher());
  $('identity').textContent = isTeacher() ? '🎅 教師控制台' : '🛷 學生平板';


  if (isTeacher()) {
    listeners.push(onValue(ref(db, 'game'), snapshot => {
      const game = snapshot.val();
      applyState(game?.public, game?.submissions);
    }, showReadError));
    listeners.push(onValue(ref(db, 'pairing'), snapshot => {
      pairing = snapshot.val() || {};
      renderPairing();
    }, showReadError));
  } else {
    listeners.push(onValue(ref(db, 'pairing/members/' + current.uid), snapshot => {
      const nextTeam = snapshot.val()?.team || null;
      if (nextTeam === team) return;
      stopGame();
      team = nextTeam;
      ready = false;
      draft = [];
      let publicState, submission;
      let gotPublic = false, gotSubmission = false;
      const renderTeamState = () => {
        if (!gotPublic || !gotSubmission) return;
        const submitted = submission && submission.round === publicState?.round
          && submission.session === publicState?.session;
        applyState(publicState, submitted ? {[team]: submission} : {});
      };
      if (team) {
        const stopPublic = onValue(ref(db, 'game/public'), result => {
          publicState = result.val();
          gotPublic = true;
          renderTeamState();
        }, showReadError);
        const stopSubmission = onValue(ref(db, 'game/submissions/' + team), result => {
          submission = result.val();
          gotSubmission = true;
          renderTeamState();
        }, showReadError);
        stopGame = () => { stopPublic(); stopSubmission(); };
      } else {
        stopGame = () => {};
        state = initial();
      }
      render();
    }, showReadError));
    const code = new URLSearchParams(location.hash.slice(1)).get('join');
    if (/^[a-f0-9]{32}$/.test(code || '')) void joinSeat(current, code);
  }
  if (user !== current) return;
  listeners.push(onValue(ref(db, '.info/connected'), snapshot => {
    connected = snapshot.val() === true;
    $('connection').textContent = connected ? '● 已連線' : '○ 連線中斷';
    render();
  }));
  render();
});
function render(){if(!user)return;$('phase').textContent=({idle:'尚未開始',open:'開放提交',revealed:'本回合已結算',finished:'遊戲結束'})[state.phase]||state.phase;$('round').textContent='第 '+state.round+' / 6 回合';const b=boardArray();$('board').innerHTML='';b.forEach((owner,i)=>{const el=document.createElement('button');el.className='cell '+(owner==='empty'?'':owner)+(draft.some(m=>m.cell===i)?' picked':'');el.innerHTML='<span>'+symbols[i]+'</span><small>'+(owner==='empty'?'空白':names[owner])+'</small>';el.onclick=()=>choose(i);$('board').append(el)});$('score').innerHTML=teams.map(t=>`<p><b>${names[t]}</b>：${b.filter(x=>x===t).length} 格</p>`).join('');$('eventText').textContent=state.event||'尚未抽籤';
$('revealedMoves').textContent = teams.filter(t => state.revealed?.[t]).map(t =>
  names[t] + '：' + state.revealed[t].moves.map(m =>
    ({claim:'占領', attack:'進攻', defend:'防守'})[m.type] + '第 ' + (m.cell + 1) + ' 格'
  ).join('、')).join('｜');$('history').textContent=(state.history||[]).map(h=>`第${h.round}回合：${h.summary}`).join('\n');if(role==='teacher'){$('submissions').innerHTML=teams.map(t=>`${names[t]}：${state.submissions?.[t]?'🔒 已封存':'⏳ 未提交'}`).join('　');$('start').disabled=!ready||!connected||state.phase==='open'||state.round>=6;$('resolve').disabled=!ready||!connected||state.phase!=='open'||!teams.every(t=>state.submissions?.[t]);$('event').disabled=!ready||!connected||state.phase!=='open'||![2,4,6].includes(state.round)||!!state.event}if(role==='student'){const submitted=!!state.submissions?.[team];const enabled=ready&&connected&&!submitting&&!!team&&state.phase==='open'&&!submitted;$('teamStatus').textContent=team?`${names[team]}｜${submitted?'🔒 已提交，等待老師公布':enabled?'可輸入兩項行動':'等待老師開啟回合'}`:'尚未入隊，請掃描老師提供的隊伍 QR Code';document.querySelectorAll('[data-action]').forEach(el=>el.disabled=!enabled);$('submit').disabled=!enabled||draft.length!==2;$('removeMove').disabled=!enabled||!draft.length;$('pending').textContent=draft.map(m=>({claim:'占領',attack:'進攻',defend:'防守'})[m.type]+' '+(m.cell+1)+'格').join('／');}};
function choose(cell){if(!ready||!connected||submitting||role!=='student'||!team||state.phase!=='open'||state.submissions?.[team]||draft.length>=2)return;if(draft.some(m=>m.cell===cell))return alert('兩項指令必須選不同格');const owner=boardArray()[cell];if(kind==='claim'&&owner!=='empty')return alert('占領只能選空格');if(kind==='attack'&&(owner==='empty'||owner===team))return alert('進攻只能選敵方格');if(kind==='defend'&&owner!==team)return alert('防守只能選自己的格');draft.push({type:kind,cell});render()}
document.querySelectorAll('[data-action]').forEach(el=>el.onclick=()=>{kind=el.dataset.action;$('selection').textContent='目前選擇：'+({claim:'占領空格',attack:'進攻敵格',defend:'防守己格'})[kind]+'，請點選棋盤'});$('removeMove').onclick=()=>{draft.pop();render()};
$('submit').onclick = async () => {
  if (!ready || !connected || submitting || draft.length !== 2 || !team || state.phase !== 'open') return;
  submitting = true;
  render();
  const {round, session} = state;
  try {
    await set(ref(db, 'game/submissions/' + team), {round, session, moves: draft.map(move => ({...move}))});
    draft = [];
  } catch (error) {
    alert('提交未完成，請確認回合及連線狀態：' + error.message);
  } finally {
    submitting = false;
    render();
  }
};

async function joinSeat(current, code) {
  const status = $('joinStatus');
  status.textContent = '正在加入隊伍…';
  try {
    const invitation = (await get(ref(db, 'pairing/invites/' + code))).val();
    if (user !== current) return;
    if (!teams.includes(invitation?.team)) throw new Error('Invalid invitation');
    await update(ref(db), {
      ['pairing/invites/' + code + '/uid']: current.uid,
      ['pairing/members/' + current.uid]: {team: invitation.team, code}
    });
    if (user !== current) return;
    status.textContent = '已加入' + names[invitation.team];
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    if (user !== current) return;
    status.textContent = '無法加入。請確認連結正確、該隊尚未綁定，且本機未加入其他隊伍。';
  }
}

function renderPairing() {
  const container = $('teamInvites');
  container.replaceChildren();
  $('createInvites').hidden = teams.every(team => pairing.codes?.[team]);
  for (const team of teams) {
    const code = pairing.codes?.[team];
    if (!code) continue;
    const uid = pairing.invites?.[code]?.uid;
    const card = document.createElement('section');
    card.className = 'invite';
    const title = document.createElement('h4');
    title.textContent = names[team] + '｜' + (uid ? '已綁定平板' : '等待平板加入');
    const link = document.createElement('a');
    link.href = gameUrl + '#join=' + code;
    link.textContent = '隊伍專屬連結';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const qr = document.createElement('div');
    const image = window.qrcode(0, 'M');
    image.addData(link.href);
    image.make();
    qr.innerHTML = image.createSvgTag(5, 20);
    qr.setAttribute('aria-label', names[team] + '配對 QR Code');
    const copy = document.createElement('button');
    copy.textContent = '複製連結';
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(link.href);
        copy.textContent = '已複製';
      } catch {
        alert('請長按隊伍專屬連結並選擇複製');
      }
    };
    const release = document.createElement('button');
    release.textContent = '解除綁定';
    release.disabled = !uid;
    release.onclick = () => releaseSeat(code, uid);
    card.append(title, qr, link, copy, release);
    container.append(card);
  }
}

$('createInvites').onclick = async () => {
  if (!connected) return alert('請等候連線恢復');
  const newCodes = Object.fromEntries(teams.map(team => [team, crypto.randomUUID().replaceAll('-', '')]));
  try {
    await runTransaction(ref(db, 'pairing'), current => {
      const next = {codes: {...current?.codes}, invites: {...current?.invites}, members: {...current?.members}};
      for (const team of teams) {
        if (next.codes[team]) continue;
        const code = newCodes[team];
        next.codes[team] = code;
        next.invites[code] = {team};
      }
      return next;
    }, {applyLocally: false});
  } catch (error) { alert(error.message); }
};

async function releaseSeat(code, uid) {
  if (!connected) return alert('請等候連線恢復');
  if (!confirm('解除後，另一台平板可用同一張 QR Code 接手。已封存指令會保留。')) return;
  try {
    const result = await runTransaction(ref(db, 'pairing'), current => {
      const invite = current?.invites?.[code];
      if (invite?.uid !== uid || current?.members?.[uid]?.code !== code) return;
      delete invite.uid;
      delete current.members[uid];
      return current;
    }, {applyLocally: false});
    if (!result.committed) alert('綁定已變更，請重新確認');
  } catch (error) { alert(error.message); }
}

async function updateGame(transform) {
  if (!isTeacher() || !connected || !ready) return;
  try {
    const result = await runTransaction(ref(db, 'game'), transform, {applyLocally: false});
    if (!result.committed) alert('回合狀態已變更，請重新確認');
  } catch (error) { alert(error.message); }
}

$('start').onclick = () => {
  const {round, session} = state;
  const newSession = crypto.randomUUID();
  return updateGame(game => {
    const current = game?.public || initial();
    if (current.round !== round || current.session !== session || current.phase === 'open' || current.round >= 6) return;
    return {public: {...current, session: current.session || newSession, round: current.round + 1, phase:'open', event:'', revealed:null}};
  });
};

$('event').onclick = () => {
  const {round, session} = state;
  const event = events[Math.floor(Math.random() * events.length)];
  return updateGame(game => {
    const current = game?.public;
    if (current?.session !== session || current?.round !== round || current?.phase !== 'open' || current.event || ![2,4,6].includes(round)) return;
    return {...game, public: {...current, event}};
  });
};
function settle(old){const board=Array.from({length:16},(_,i)=>old.board?.[i]||'empty');const subs=old.submissions||{};const moves=teams.flatMap(team=>(subs[team]?.moves||[]).map(m=>({...m,team})));const shields=new Set(moves.filter(m=>m.type==='defend'&&board[m.cell]===m.team).map(m=>m.cell));const attacks=moves.filter(m=>m.type==='attack');const removed=[];for(const m of attacks){if(board[m.cell]!=='empty'&&board[m.cell]!==m.team){if(shields.has(m.cell))shields.delete(m.cell);else removed.push(m.cell)}}for(const c of removed)board[c]='empty';const claims=moves.filter(m=>m.type==='claim');const grouped={};for(const m of claims)(grouped[m.cell]??=[]).push(m.team);for(const [cell,claimants] of Object.entries(grouped)){// 占領僅對回合開始時為空的格子有效
 if((old.board?.[cell]||'empty')==='empty'&&claimants.length===1)board[Number(cell)]=claimants[0];}
 const summary=teams.map(t=>`${names[t]} ${board.filter(x=>x===t).length}格`).join('，');return {...old,board,phase:old.round>=6?'finished':'revealed',history:[...(old.history||[]),{round:old.round,summary}],submissions:null};}
$('resolve').onclick = () => {
  const {round, session} = state;
  return updateGame(game => {
    const current = game?.public;
    const submissions = game?.submissions;
    if (current?.session !== session || current?.round !== round || current?.phase !== 'open' ||
        !teams.every(t => submissions?.[t]?.session === session && submissions[t].round === round)) return;
    const {submissions: discarded, ...result} = settle({...current, submissions});
    return {public: {...result, revealed: submissions}};
  });
};

$('reset').onclick = () => {
  if (!confirm('確定重設全部六回合棋盤與紀錄？配對資料會保留。')) return;
  const session = crypto.randomUUID();
  return updateGame(() => ({public: {...initial(), session}}));
};
