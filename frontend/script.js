let ws;
let gameState = null;
let playerName = "";
let isPlayingCard = false;

const SUIT_SYMBOLS = { 'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣' };

function initWebSocket() {
    let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + window.location.host + '/ws');
    ws.onmessage = (event) => {
        let msg = JSON.parse(event.data);
        if (msg.type === 'STATE_UPDATE') {
            gameState = msg.state;
            renderAll();
        } else if (msg.type === 'JOIN_RESULT') {
            if (msg.success) {
                document.getElementById('login-screen').style.display = 'none';
                document.getElementById('game-screen').style.display = 'flex';
            } else {
                document.getElementById('login-error').innerText = msg.message;
            }
        } else if (msg.type === 'GIFT') {
            showGiftAnimation(msg.to, msg.sender, msg.gift);
        }
    };
    ws.onclose = () => setTimeout(initWebSocket, 2000);
}

function joinGame() {
    let name = document.getElementById('player-name').value;
    if (!name) return alert("İsim gir!");
    playerName = name;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        initWebSocket();
        setTimeout(() => ws.send(JSON.stringify({action:'join', name: name})), 1000);
    } else {
        ws.send(JSON.stringify({action:'join', name: name}));
    }
}

function addBotAt(pos) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({action: 'add_bot', position: pos}));
    }
}

function startGame() { ws.send(JSON.stringify({action: 'start'})); }
function placeBid(amount) { ws.send(JSON.stringify({action: 'bid', amount: amount})); }
function setTrump(suit) { ws.send(JSON.stringify({action: 'set_trump', suit: suit})); }
function playCard(i, p) { ws.send(JSON.stringify({action: 'play_card', card_index: i, player_pos: p})); }
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
    }

    // Status & Center
    let statusText = "Bekleniyor...";
    if (gameState.state === 'LOBBY') {
        let count = Object.keys(gameState.players || {}).length;
        statusText = `Masa Doluyor (${count}/4)...`;
        document.getElementById('btn-start').style.display = (count === 4) ? 'block' : 'none';
    } else {
        document.getElementById('btn-start').style.display = 'none';
        if (gameState.state === 'BIDDING') statusText = `İhale: ${gameState.players[gameState.bidding_turn]}`;
        else if (gameState.state === 'PLAYING') statusText = `Sıra: ${gameState.players[gameState.current_turn]}`;
        else if (gameState.state === 'WAITING_TRUMP') statusText = "Koz Belirleniyor...";
        else if (gameState.state === 'ROUND_END') statusText = "Tur Bitti!";
    }
    document.getElementById('status-message').innerText = statusText;

    // Relative Positions
    let rel = { 'bottom': myPos, 'left': (myPos+1)%4, 'top': (myPos+2)%4, 'right': (myPos+3)%4 };
    for (const [ui, gp] of Object.entries(rel)) {
        let name = gameState.players[gp] || "Boş";
        let area = document.getElementById('player-' + ui);
        if (area) {
            let infoText = (gp === myPos ? playerName : name);
            if (gameState.highest_bidder === gp) infoText += ` (İhaleyi Aldı: ${gameState.current_bid})`;
            area.querySelector('.player-name').innerText = infoText;
            
            let btn = area.querySelector('.btn-add-bot');
            if (btn) btn.style.display = (name === "Boş") ? 'block' : 'none';

            let giftMenu = area.querySelector('.gift-menu');
            if (giftMenu) {
                giftMenu.style.display = (name !== "Boş") ? 'flex' : 'none';
                giftMenu.querySelectorAll('span').forEach(s => s.onclick = () => sendGift(gp, s.getAttribute('data-type')));
            }
        }
        renderHand(ui, gp);
        renderPlayedCard(ui, gp);
    }

    // Scoreboard with Team Names
    let p0 = gameState.players[0] || "1. Oyuncu";
    let p2 = gameState.players[2] || "3. Oyuncu";
    let p1 = gameState.players[1] || "2. Oyuncu";
    let p3 = gameState.players[3] || "4. Oyuncu";
    document.getElementById('score-us-label').innerText = `${p0} & ${p2}:`;
    document.getElementById('score-them-label').innerText = `${p1} & ${p3}:`;
    document.getElementById('score-us').innerText = gameState.total_scores[0] || 0;
    document.getElementById('score-them').innerText = gameState.total_scores[1] || 0;

    // Tricks Info
    let tw0 = (gameState.tricks_won[0] || 0) + (gameState.tricks_won[2] || 0);
    let tw1 = (gameState.tricks_won[1] || 0) + (gameState.tricks_won[3] || 0);
    let tricksEl = document.getElementById('tricks-info');
    if (gameState.state === 'PLAYING' || gameState.state === 'ROUND_END') {
        tricksEl.innerText = `Bu turda: Takım1 ${tw0} - Takım2 ${tw1} el aldı. (İhale: ${gameState.current_bid})`;
    } else { tricksEl.innerText = ""; }

    // Trump Info
    let trumpEl = document.getElementById('trump-indicator');
    if (gameState.trump_suit) {
        trumpEl.innerHTML = `Koz: <span class="${(gameState.trump_suit==='H'||gameState.trump_suit==='D')?'red':'black'}">${SUIT_SYMBOLS[gameState.trump_suit]}</span>`;
    } else { trumpEl.innerHTML = ""; }

    // Modals
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
    let container = document.getElementById('hand-' + ui);
    container.innerHTML = '';
    let cards = gameState.hands[gp] || [];
    let playable = new Set(gameState.playable_indices || []);
    let myPos = gameState.my_position;
    let partnerPos = (gameState.highest_bidder + 2) % 4;
    let isPartnerView = (myPos === gameState.highest_bidder || gameState.is_manager);

    cards.forEach((card, i) => {
        let div = document.createElement('div');
        if (card.suit === '?') {
            div.className = 'card card-back';
        } else {
            let color = (card.suit === 'H' || card.suit === 'D') ? 'red' : 'black';
            let canClick = (gp === myPos || (isPartnerView && gp === partnerPos)) && playable.has(i);
            let isMyTurn = (gameState.current_turn === gp);
            
            // State: playable (glowing), unplayable (faded), or just normal
            let stateClass = "";
            if (canClick) stateClass = "playable";
            else if (gp === myPos || (isPartnerView && gp === partnerPos)) stateClass = "unplayable";

            div.className = `card ${color} ${stateClass}`;
            let val = {11:'J', 12:'Q', 13:'K', 14:'A'}[card.value] || card.value;
            let sym = SUIT_SYMBOLS[card.suit];
            div.innerHTML = `<div class="card-top-left">${val}<br>${sym}</div><div class="center-suit">${sym}</div>`;
            if (canClick) div.onclick = () => playCard(i, gp);
        }
        container.appendChild(div);
    });
}

function renderPlayedCard(ui, gp) {
    let container = document.getElementById('played-' + ui);
    container.innerHTML = '';
    if (gameState.trick_cards && gameState.trick_cards[gp]) {
        let card = gameState.trick_cards[gp];
        let color = (card.suit === 'H' || card.suit === 'D') ? 'red' : 'black';
        let val = {11:'J', 12:'Q', 13:'K', 14:'A'}[card.value] || card.value;
        let sym = SUIT_SYMBOLS[card.suit];
        container.innerHTML = `<div class="card ${color}"><div class="card-top-left">${val}<br>${sym}</div><div class="center-suit">${sym}</div></div>`;
    }
}

function showGiftAnimation(to, sender, type) {
    const map = { 'tea': '☕', 'oralet': '🍵', 'banana': '🍌', 'cheers': '🥂' };
    let uiPos = ['bottom', 'left', 'top', 'right'][(to - gameState.my_position + 4) % 4];
    let area = document.getElementById('player-' + uiPos);
    if (area) {
        let el = document.createElement('div'); el.className = 'gift-animation'; el.innerText = map[type];
        area.appendChild(el); setTimeout(() => el.remove(), 2500);
    }
}

initWebSocket();
setInterval(() => { if (ws && ws.readyState === WebSocket.OPEN && !gameState) ws.send(JSON.stringify({action:'get_state'})); }, 1500);
