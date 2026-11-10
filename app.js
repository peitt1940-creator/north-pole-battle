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
const teams = ['red', 'green', 'gold'];
const names = {red: '紅隊', green: '綠隊', gold: '金隊'};
const actionNames = {claim: '占領', attack: '進攻', defend: '防守'};
const actionIcons = {claim: '🚩', attack: '⚔', defend: '🛡'};
const eventCards = {
  2: [
    ['企鵝上班', '這一輪做體能挑戰時，大家用小碎步前進。'],
    ['麋鹿迷路', '每位隊員出發前，先在原地慢慢轉一圈。'],
    ['雪人慢動作', '這一輪的體能動作，全部用慢動作完成。']
  ],
  4: [
    ['北極靜音', '這一輪討論戰術時，只能用手勢。'],
    ['HO HO HO 稅', '這一輪每次開口前，先說「HO HO HO」。'],
    ['老闆換人當', '請一位還沒當過指揮的隊員，代表你們說明這輪的行動。']
  ],
  6: [
    ['聖誕定格', '隊伍送出行動後，全員擺出聖誕樹的姿勢，定格三秒。'],
    ['精靈換手', '請平常最少操作平板的人，負責點選並送出最後一輪的行動。'],
    ['麋鹿導航', '由一人操作平板，其他隊員用「第幾列、第幾格」指路。']
  ]
};
function drawRoundEvent(round, random = Math.random) {
  const cards = eventCards[round];
  if (!cards) return null;
  const [title, description] = cards[Math.floor(random() * cards.length)];
  return {title, description};
}
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

const missions = {
  corners: ['四角守護者', '到最後一回合結束時，占住任意兩個角落。'],
  center: ['北極中心王', '遊戲結束時，中央四格裡有兩格是你們的。'],
  diagonal: ['斜線藝術家', '遊戲結束時，在同一條角落連到角落的斜線上，占住至少三格。'],
  square: ['聖誕包圍網', '遊戲結束時，在同一個 2×2 小方塊裡，占住至少三格。'],
  gifts: ['禮物收藏家', '遊戲結束時，第 2 格的禮物和第 15 格的緞帶都要在你們手上。'],
  border: ['邊境巡邏隊', '遊戲結束時，在同一條棋盤外側邊線上，占住至少三格。'],
  cities: ['雙城守護者', '遊戲結束時，占住兩對相鄰的格子。每對都要靠在一起，兩對之間不能相連。'],
  crossing: ['十字路口', '遊戲結束時，占住中央四格中的一格，再占住跟它相鄰的任意兩格。'],
  shield: ['防禦專家', '六回合裡，有一次真的用盾牌擋下別隊的進攻就算成功。']
};
let studentStage = 'rules';
let teacherPage = 'control';
let teamMission = null;
let drawnMissions = {};

function renderViews() {
  const teacher = isTeacher();
  const gameVisible = teacher ? teacherPage === 'control' : studentStage === 'game' && !!teamMission;
  $('logout').classList.toggle('hide', !teacher);
  $('teacherNav').classList.toggle('hide', !teacher);
  $('pairingPanel').classList.toggle('hide', !teacher || teacherPage !== 'pairing');
  $('playPanel').classList.toggle('hide', !gameVisible);
  $('studentIntro').classList.toggle('hide', teacher || gameVisible);
  $('studentRules').classList.toggle('hide', studentStage !== 'rules');
  $('studentDraw').classList.toggle('hide', studentStage !== 'draw');
  $('showControl').setAttribute('aria-pressed', String(teacherPage === 'control'));
  $('showPairing').setAttribute('aria-pressed', String(teacherPage === 'pairing'));

  if (!teacher) {
    const mission = missions[teamMission];
    $('missionReveal').className = 'mission-reveal' + (team ? ' ' + team : '');
    $('missionTeam').textContent = team ? names[team] + '的祕密任務' : '還沒加入隊伍';
    $('missionTitle').textContent = mission?.[0] || '等老師抽籤';
    $('missionDescription').textContent = mission?.[1] || (team ? '抽到的那張會出現在這裡。' : '請掃描老師提供的隊伍 QR Code。');
    $('studentMissionReminder').textContent = mission ? mission.join('｜') : '';
    $('enterGame').classList.toggle('hide', !mission);
  }
}

for (const [title, description] of Object.values(missions)) {
  const option = document.createElement('li');
  const heading = document.createElement('strong');
  const detail = document.createElement('p');
  heading.textContent = title;
  detail.textContent = description;
  option.append(heading, detail);
  $('missionOptions').append(option);
}
$('readRules').onclick = () => { studentStage = 'draw'; renderViews(); window.scrollTo(0, 0); };
$('backRules').onclick = () => { studentStage = 'rules'; renderViews(); window.scrollTo(0, 0); };
$('enterGame').onclick = () => {
  if (!teamMission) return;
  studentStage = 'game';
  renderViews();
  window.scrollTo(0, 0);
};
$('showControl').onclick = () => {
  teacherPage = 'control';
  $('teacherSecrets').open = false;
  renderViews();
};
$('showPairing').onclick = () => { teacherPage = 'pairing'; renderViews(); };

function renderMissionControls() {
  const allDrawn = teams.every(team => missions[drawnMissions[team]]);
  $('drawMissions').disabled = !ready || !connected || allDrawn;
  $('drawStatus').textContent = allDrawn ? '三隊的任務已抽好。' : '開場時，先替三隊一起抽祕密任務。';
  const summary = $('missionSummary');
  summary.replaceChildren();
  for (const team of teams) {
    const row = document.createElement('p');
    const mission = missions[drawnMissions[team]];
    row.textContent = names[team] + '｜' + (mission ? mission.join('：') : '尚未抽籤');
    summary.append(row);
  }
  return allDrawn;
}

function drawMissionSet() {
  const available = Object.keys(missions);
  return Object.fromEntries(teams.map(team => {
    const index = Math.floor(Math.random() * available.length);
    return [team, available.splice(index, 1)[0]];
  }));
}

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
  studentStage = 'rules';
  teacherPage = 'control';
  teamMission = null;
  drawnMissions = {};
  $('teacherSecrets').open = false;
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
      drawnMissions = game?.missions || {};
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
      teamMission = null;
      if (studentStage === 'game') studentStage = 'draw';
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
        const stopMission = onValue(ref(db, 'game/missions/' + team), result => {
          const nextMission = result.val();
          teamMission = missions[nextMission] ? nextMission : null;
          if (!teamMission && studentStage === 'game') studentStage = 'draw';
          renderViews();
        }, showReadError);
        stopGame = () => { stopPublic(); stopSubmission(); stopMission(); };
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
function render() {
  if (!user) return;
  renderViews();
  const teacher = isTeacher();
  $('teamBanner').className = 'team-banner ' + (!teacher && team ? 'score-' + team : 'hide');
  $('teamBanner').textContent = !teacher && team ? names[team] : '';
  $('phase').textContent = ({idle:'尚未開始',open:'開放提交',revealed:'本輪已結算',finished:'遊戲結束'})[state.phase] || state.phase;
  $('round').textContent = '第 ' + state.round + ' / 6 輪';
  const board = boardArray();
  const enabled = canChoose();
  $('board').replaceChildren();
  board.forEach((owner, cell) => {
    const move = draft.find(item => item.cell === cell);
    const tile = document.createElement('button');
    tile.className = 'cell ' + (owner === 'empty' ? '' : owner) + (move ? ' picked' : '');
    const ownerName = owner === 'empty' ? '空格' : names[owner];
    tile.innerHTML = '<span class="cell-number">' + (cell + 1) + '</span><span>' + symbols[cell] + '</span><small>' + ownerName + '</small>';
    if (move) {
      const mark = document.createElement('span');
      mark.className = 'move-mark';
      mark.textContent = actionIcons[move.type] + ' ' + actionNames[move.type];
      tile.append(mark);
    }
    tile.setAttribute('aria-label', '第 ' + (cell + 1) + ' 格，' + ownerName + (move ? '，已選' + actionNames[move.type] + '，再按取消' : ''));
    if (!teacher) {
      tile.disabled = !enabled;
      tile.setAttribute('aria-pressed', String(!!move));
      tile.onclick = () => choose(cell);
    }
    $('board').append(tile);
  });
  $('score').innerHTML = teams.map(t => `<p class="score-${t}"><b>${names[t]}</b>：${board.filter(owner => owner === t).length} 格</p>`).join('');
  renderRevealedMoves();
  const event = state.event;
  $('roundEvent').classList.toggle('hide', !event);
  $('eventRound').textContent = '第 ' + state.round + ' 輪・搞笑事件';
  $('eventTitle').textContent = typeof event === 'string' ? event.split('：')[0] : event?.title || '';
  $('eventDescription').textContent = typeof event === 'string' ? event.split('：').slice(1).join('：') : event?.description || '';
  $('history').textContent = (state.history || []).map(item => `第 ${item.round} 輪：${item.summary}`).join('\n');

  if (teacher) {
    const allDrawn = renderMissionControls();
    $('submissions').innerHTML = teams.map(t => `<div>${names[t]}：${state.submissions?.[t] ? '🔒 已送出' : '⏳ 未送出'}</div>`).join('');
    $('start').disabled = !allDrawn || !ready || !connected || state.phase === 'open' || state.round >= 6;
    $('resolve').disabled = !ready || !connected || state.phase !== 'open' || !teams.every(t => state.submissions?.[t]);
  } else {
    const submitted = !!state.submissions?.[team];
    $('teamStatus').textContent = submitted ? '🔒 已送出，等老師揭曉' : enabled ? '跟隊友商量後，選兩個行動' : '等待老師開啟回合';
    for (const button of document.querySelectorAll('[data-action]')) {
      const selected = button.dataset.action === kind;
      button.disabled = !enabled;
      button.setAttribute('aria-pressed', String(selected));
    }
    $('selection').textContent = '目前選擇：' + actionNames[kind] + '。點棋盤選格，再點同一格就能取消。';
    $('submit').disabled = !enabled || draft.length !== 2;
    $('pending').textContent = draft.map(move => actionNames[move.type] + ' 第 ' + (move.cell + 1) + ' 格').join('／');
  }
}

function renderRevealedMoves() {
  const list = $('revealedMoves');
  list.replaceChildren();
  const revealedRound = teams.map(t => state.revealed?.[t]?.round).find(Number.isInteger);
  $('actionsRound').textContent = revealedRound ? '第 ' + revealedRound + ' 輪的行動' : '各隊行動';
  if (!revealedRound) {
    const empty = document.createElement('p');
    empty.textContent = '等老師揭曉後，各隊的行動會顯示在這裡。';
    list.append(empty);
    return;
  }
  for (const t of teams) {
    const row = document.createElement('p');
    const label = document.createElement('strong');
    label.className = 'action-team score-' + t;
    label.textContent = names[t];
    const moves = state.revealed[t]?.moves || [];
    row.append(label, ' ' + (moves.map(move => actionIcons[move.type] + ' ' + actionNames[move.type] + '第 ' + (move.cell + 1) + ' 格').join('、') || '沒有行動'));
    list.append(row);
  }
}

function canChoose() {
  return studentStage === 'game' && !!teamMission && ready && connected && !submitting &&
    role === 'student' && !!team && state.phase === 'open' && !state.submissions?.[team];
}

function choose(cell) {
  if (!canChoose()) return;
  const selected = draft.findIndex(move => move.cell === cell);
  if (selected >= 0) {
    draft.splice(selected, 1);
    render();
    return;
  }
  if (draft.length >= 2) return alert('已經選好兩格。要改的話，再點一次想取消的格子。');
  const owner = boardArray()[cell];
  if (kind === 'claim' && owner !== 'empty') return alert('占領只能選空格');
  if (kind === 'attack' && (owner === 'empty' || owner === team)) return alert('進攻只能選敵方格');
  if (kind === 'defend' && owner !== team) return alert('防守只能選自己的格');
  draft.push({type: kind, cell});
  render();
}
for (const button of document.querySelectorAll('[data-action]')) {
  button.onclick = () => { kind = button.dataset.action; render(); };
}
$('submit').onclick = async () => {
  if (!canChoose() || draft.length !== 2) return;
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

$('drawMissions').onclick = () => {
  const chosen = drawMissionSet();
  return updateGame(game => {
    if (game?.missions) return;
    return {...game, missions: chosen};
  });
};

$('start').onclick = () => {
  const {round, session} = state;
  const newSession = crypto.randomUUID();
  const event = drawRoundEvent(round + 1);
  return updateGame(game => {
    const current = game?.public || initial();
    if (!game?.missions || current.round !== round || current.session !== session || current.phase === 'open' || current.round >= 6) return;
    return {missions: game.missions, public: {...current, session: current.session || newSession, round: current.round + 1, phase:'open', event}};
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
    return {missions: game.missions, public: {...result, revealed: submissions}};
  });
};

$('reset').onclick = () => {
  if (!confirm('確定重設全部六回合棋盤、祕密任務和紀錄？平板配對會保留。')) return;
  const session = crypto.randomUUID();
  return updateGame(() => ({public: {...initial(), session}}));
};
