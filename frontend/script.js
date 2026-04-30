let ws;
let gameState = null;
let playerName = "";
let isPlayingCard = false;

const SUIT_SYMBOLS = { 'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣' };
const VALUE_NAMES = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function getCardDisplay(card) {
    let valStr = VALUE_NAMES[card.value] || card.value.toString();
    let suitStr = SUIT_SYMBOLS[card.suit] || card.suit;
    let colorClass = (card.suit === 'H' || card.suit === 'D') ? 'red' : 'black';
    return { valStr, suitStr, colorClass };
}

function initWebSocket(callback) {
    let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = protocol + '//' + window.location.host + '/ws';
    ws = new WebSocket(wsUrl);
    ws.onopen = () => { if (callback) callback(); };
    ws.onmessage = (event) => {
        let msg = JSON.parse(event.data);
        if (msg.type === 'STATE_UPDATE') {
            gameState = msg.state;
            isPlayingCard = false;
            renderAll();
        } else if (msg.type === 'JOIN_RESULT') {
            if (!msg.success) document.getElementById('login-error').innerText = msg.message;
        } else if (msg.type === 'GIFT') {
            showGiftAnimation(msg.to, msg.sender, msg.gift);
        } else if (msg.type === 'ERROR') {
            isPlayingCard = false;
            console.error("Game Error:", msg.message);
        }
    };
}

function joinGame() {
    let name = document.getElementById('player-name').value;
    if (!name) { alert("Lütfen adınızı girin!"); return; }
    playerName = name;
    
    let sendJoin = () => ws.send(JSON.stringify({action: 'join', name: name}));
    if (!ws || ws.readyState !== WebSocket.OPEN) initWebSocket(sendJoin); else sendJoin();
}

function addBotAt(pos) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({action: 'add_bot', position: pos}));
    }
}

function startGame() { ws.send(JSON.stringify({action: 'start'})); }
function placeBid(amount) { ws.send(JSON.stringify({action: 'bid', amount: amount})); }
function setTrump(suit) { ws.send(JSON.stringify({action: 'set_trump', suit: suit})); }
function playCard(index, pPos) {
    if (isPlayingCard) return;
    isPlayingCard = true;
    ws.send(JSON.stringify({action: 'play_card', card_index: index, player_pos: pPos}));
    setTimeout(() => { isPlayingCard = false; }, 2000);
}
function clearTrick() { ws.send(JSON.stringify({action: 'clear_trick'})); }
function nextRound() { ws.send(JSON.stringify({action: 'next_round'})); }
function resetScores() { ws.send(JSON.stringify({action: 'reset_scores'})); }
function sendGift(toPos, type) { ws.send(JSON.stringify({action: 'send_gift', to: toPos, gift: type})); }

function renderAll() {
    if (!gameState) return;
    let myPos = gameState.my_position;

    if (myPos !== undefined && myPos !== null) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'flex';
    } else {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('game-screen').style.display = 'none';
        return;
    }

    // Status
    let statusText = "Bekleniyor...";
    if (gameState.state === 'LOBBY') {
        let count = Object.keys(gameState.players).length;
        statusText = `Oyuncular bekleniyor (${count}/4)...`;
        document.getElementById('btn-start').style.display = (count === 4) ? 'block' : 'none';
    } else {
        document.getElementById('btn-start').style.display = 'none';
        if (gameState.state === 'BIDDING') statusText = `İhale: ${gameState.players[gameState.bidding_turn]}`;
        else if (gameState.state === 'PLAYING') statusText = `Sıra: ${gameState.players[gameState.current_turn]}`;
        else if (gameState.state === 'ROUND_END') statusText = "Tur Bitti!";
    }
    document.getElementById('status-message').innerText = statusText;

    let relPos = { 'bottom': myPos, 'left': (myPos+1)%4, 'top': (myPos+2)%4, 'right': (myPos+3)%4 };
    for (const [ui, gp] of Object.entries(relPos)) {
        let pName = gameState.players[gp] || "Boş";
        let area = document.getElementById('player-' + ui);
        if (!area) continue;
        
        area.querySelector('.player-name').innerText = pName;
        let botBtn = area.querySelector('.btn-add-bot');
        if (botBtn) botBtn.style.display = (pName === "Boş") ? 'block' : 'none';
        
        let giftMenu = area.querySelector('.gift-menu');
        if (giftMenu) {
            giftMenu.style.display = (gp !== myPos && pName !== "Boş") ? 'flex' : 'none';
            giftMenu.querySelectorAll('span').forEach(s => s.onclick = () => sendGift(gp, s.getAttribute('data-type')));
        }
        
        renderHand(ui, gp);
        renderPlayedCard(ui, gp);
    }

    // Modals & Scores
    document.getElementById('score-us').innerText = gameState.total_scores[myPos%2];
    document.getElementById('score-them').innerText = gameState.total_scores[(myPos+1)%2];
    document.getElementById('bidding-modal').style.display = (gameState.state === 'BIDDING' && gameState.bidding_turn === myPos) ? 'flex' : 'none';
    if (gameState.state === 'BIDDING' && gameState.bidding_turn === myPos) {
        let c = document.getElementById('bid-numbers'); c.innerHTML = '';
        for (let i = Math.max(8, gameState.current_bid+1); i <= 13; i++) {
            let b = document.createElement('button'); b.innerText = i; b.className='btn-primary'; b.onclick = () => placeBid(i);
            c.appendChild(b);
        }
    }
    document.getElementById('trump-modal').style.display = (gameState.state === 'WAITING_TRUMP' && gameState.highest_bidder === myPos) ? 'flex' : 'none';
    let isFull = Object.keys(gameState.trick_cards || {}).length === 4;
    document.getElementById('btn-next-trick').style.display = (isFull && gameState.trick_leader === myPos) ? 'block' : 'none';
    document.getElementById('btn-next-round').style.display = (gameState.state === 'ROUND_END' && myPos === 0) ? 'block' : 'none';
}

function renderHand(ui, gp) {
    let c = document.getElementById('hand-' + ui); c.innerHTML = '';
    let cards = gameState.hands[gp] || [];
    let myPos = gameState.my_position;
    let isManager = gameState.is_manager;
    let partnerPos = (gameState.highest_bidder + 2) % 4;
    let playable = new Set(gameState.playable_indices || []);

    cards.forEach((card, i) => {
        let div = document.createElement('div');
        if (card.suit === '?') div.className = 'card card-back';
        else {
            let d = getCardDisplay(card);
            let isP = (gp === myPos || (isManager && gp === (gameState.highest_bidder === myPos ? partnerPos : gameState.highest_bidder))) && playable.has(i);
            // Wait, is_manager logic: if bidder is bot and me is partner
            let partnerView = (myPos === gameState.highest_bidder || isManager);
            let p_pos = (partnerView && gp === partnerPos);
            let canClick = (gp === myPos || p_pos) && playable.has(i);
            
            div.className = `card ${d.colorClass} ${canClick ? 'playable' : ''}`;
            div.innerHTML = `<div class="card-top-left">${d.valStr}<br>${d.suitStr}</div><div class="center-suit">${d.suitStr}</div>`;
            if (canClick) div.onclick = () => playCard(i, gp);
        }
        c.appendChild(div);
    });
}

function renderPlayedCard(ui, gp) {
    let c = document.getElementById('played-' + ui); c.innerHTML = '';
    if (gameState.trick_cards && gameState.trick_cards[gp]) {
        let d = getCardDisplay(gameState.trick_cards[gp]);
        let div = document.createElement('div');
        div.className = `card ${d.colorClass}`;
        div.innerHTML = `<div class="card-top-left">${d.valStr}<br>${d.suitStr}</div><div class="center-suit">${d.suitStr}</div>`;
        c.appendChild(div);
    }
}

function showGiftAnimation(to, sender, type) {
    const map = { 'tea': '☕', 'oralet': '🍵', 'banana': '🍌', 'cheers': '🥂' };
    let uiPos = ['bottom', 'left', 'top', 'right'][(to - gameState.my_position + 4) % 4];
    let area = document.getElementById('player-' + uiPos);
    if (!area) return;
    let el = document.createElement('div'); el.className = 'gift-animation'; el.innerText = map[type];
    area.appendChild(el); setTimeout(() => el.remove(), 2500);
}

initWebSocket(() => { setInterval(() => { if (!gameState) ws.send(JSON.stringify({action: 'get_state'})); }, 2000); });
