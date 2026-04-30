let ws;
let gameState = null;
let playerName = "";
let isPlayingCard = false; // Lock to prevent double-click

const SUIT_SYMBOLS = { 'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣' };
const VALUE_NAMES = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function getCardDisplay(card) {
    let valStr = VALUE_NAMES[card.value] || card.value.toString();
    let suitStr = SUIT_SYMBOLS[card.suit] || card.suit;
    let colorClass = (card.suit === 'H' || card.suit === 'D') ? 'red' : 'black';
    return { valStr, suitStr, colorClass };
}

function initWebSocket() {
    let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = protocol + '//' + window.location.host;
    ws = new WebSocket(wsUrl);
    
    ws.onmessage = (event) => {
        let msg = JSON.parse(event.data);
        if (msg.type === 'STATE_UPDATE') {
            gameState = msg.state;
            isPlayingCard = false; // Unlock after server confirms
            renderAll();
        } else if (msg.type === 'JOIN_RESULT') {
            if (msg.success) {
                document.getElementById('login-screen').style.display = 'none';
                document.getElementById('game-screen').style.display = 'block';
            } else {
                document.getElementById('login-error').innerText = msg.message;
            }
        } else if (msg.type === 'ERROR') {
            isPlayingCard = false; // Unlock on error too
            // Show subtle toast instead of alert
            showToast(msg.message);
        }
    };
    
    ws.onclose = () => {
        document.getElementById('status-message').innerText = "Sunucu ile bağlantı kesildi!";
    };
}

function joinGame() {
    let name = document.getElementById('player-name').value;
    if (!name) return;
    playerName = name;
    
    if (!ws || ws.readyState === WebSocket.CLOSED) {
        initWebSocket();
    }
    
    if (ws.readyState === WebSocket.CONNECTING) {
        let checkInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                clearInterval(checkInterval);
                ws.send(JSON.stringify({action: 'join', name: name}));
            } else if (ws.readyState === WebSocket.CLOSED) {
                clearInterval(checkInterval);
                alert("Bağlantı kurulamadı, sayfayı yenileyin.");
            }
        }, 100);
    } else if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({action: 'join', name: name}));
    }
}

function startGame() { ws.send(JSON.stringify({action: 'start'})); }
function placeBid(amount) { ws.send(JSON.stringify({action: 'bid', amount: amount})); }
function setTrump(suit) { ws.send(JSON.stringify({action: 'set_trump', suit: suit})); }
function playCard(index) {
    if (isPlayingCard) return; // Block double-click
    isPlayingCard = true;
    ws.send(JSON.stringify({action: 'play_card', card_index: index}));
    // Safety timeout - unlock after 2s if server doesn't respond
    setTimeout(() => { isPlayingCard = false; }, 2000);
}
function clearTrick() { ws.send(JSON.stringify({action: 'clear_trick'})); }
function nextRound() { ws.send(JSON.stringify({action: 'next_round'})); }
function resetScores() { ws.send(JSON.stringify({action: 'reset_scores'})); }

function showToast(msg) {
    let toast = document.getElementById('toast-msg');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-msg';
        toast.style.cssText = 'position:fixed;bottom:220px;left:50%;transform:translateX(-50%);background:rgba(200,50,50,0.9);color:white;padding:10px 20px;border-radius:20px;z-index:999;pointer-events:none;font-family:Outfit,sans-serif;transition:opacity 0.5s;';
        document.body.appendChild(toast);
    }
    toast.innerText = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

function renderAll() {
    if (!gameState) return;
    
    let myPos = gameState.my_position;
    
    // Status text
    let statusText = "Bekleniyor...";
    if (gameState.state === 'LOBBY') {
        let count = Object.keys(gameState.players).length;
        statusText = `Oyuncular bekleniyor (${count}/4)...`;
        if (count === 4 && myPos === 0) {
            document.getElementById('btn-start').style.display = 'block';
        } else {
            document.getElementById('btn-start').style.display = 'none';
        }
    } else {
        document.getElementById('btn-start').style.display = 'none';
        if (gameState.state === 'BIDDING') {
            statusText = `İhale aşaması. Sıra: ${gameState.players[gameState.bidding_turn]}`;
        } else if (gameState.state === 'WAITING_TRUMP') {
            statusText = `İhale ${gameState.highest_bidder === myPos ? 'sizde' : gameState.players[gameState.highest_bidder] + ' onda'}. Koz bekleniyor...`;
        } else if (gameState.state === 'PLAYING') {
            statusText = `Sıra: ${gameState.players[gameState.current_turn]}`;
        } else if (gameState.state === 'ROUND_END') {
            statusText = "Tur bitti!";
        }
    }
    document.getElementById('status-message').innerText = statusText;

    // Relative Positions: bottom=myPos, left=(myPos+1)%4, top=(myPos+2)%4, right=(myPos+3)%4
    let relPos = {
        'bottom': myPos,
        'left': (myPos + 1) % 4,
        'top': (myPos + 2) % 4,
        'right': (myPos + 3) % 4
    };

    // Render players & hands
    for (const [uiPos, gamePos] of Object.entries(relPos)) {
        let pName = gameState.players[gamePos] || "Boş";
        
        let extraInfo = "";
        if (gameState.bids && gamePos in gameState.bids) extraInfo = ` (İhale: ${gameState.bids[gamePos]})`;
        if (gameState.highest_bidder === gamePos) extraInfo = ` (İhaleyi Aldı: ${gameState.current_bid})`;
        
        // Mark active
        let el = document.getElementById('player-' + uiPos);
        if (el) {
            el.className = 'player-area ' + uiPos;
            if (gameState.state === 'BIDDING' && gameState.bidding_turn === gamePos) el.classList.add('active');
            if (gameState.state === 'PLAYING' && gameState.current_turn === gamePos) el.classList.add('active');
        }

        document.querySelector(`#player-${uiPos} .player-name`).innerText = pName + extraInfo;

        renderHand(uiPos, gamePos);
        renderPlayedCard(uiPos, gamePos);
    }

    // Modal logic
    document.getElementById('bidding-modal').style.display = 
        (gameState.state === 'BIDDING' && gameState.bidding_turn === myPos) ? 'flex' : 'none';
        
    if (gameState.state === 'BIDDING' && gameState.bidding_turn === myPos) {
        let bidContainer = document.getElementById('bid-numbers');
        bidContainer.innerHTML = '';
        let startBid = Math.max(8, gameState.current_bid + 1);
        for(let i=startBid; i<=13; i++) {
            let b = document.createElement('button');
            b.className = 'btn-primary';
            b.innerText = i;
            b.onclick = () => placeBid(i);
            bidContainer.appendChild(b);
        }
    }

    document.getElementById('trump-modal').style.display = 
        (gameState.state === 'WAITING_TRUMP' && gameState.highest_bidder === myPos) ? 'flex' : 'none';

    // Buttons
    let isTrickFull = Object.keys(gameState.trick_cards || {}).length === 4;
    document.getElementById('btn-next-trick').style.display = 
        (isTrickFull && gameState.trick_leader === myPos) ? 'block' : 'none';

    if (isTrickFull && gameState.trick_leader === myPos) {
        if (!window.trickClearTimeout) {
            window.trickClearTimeout = setTimeout(() => {
                clearTrick();
                window.trickClearTimeout = null;
            }, 2500);
        }
    } else {
        if (window.trickClearTimeout) {
            clearTimeout(window.trickClearTimeout);
            window.trickClearTimeout = null;
        }
    }

    document.getElementById('btn-next-round').style.display = 
        (gameState.state === 'ROUND_END' && myPos === 0) ? 'block' : 'none';

    // Top scoreboard with player names
    let myTeamName = [gameState.players[myPos], gameState.players[(myPos+2)%4]].filter(Boolean).join(' & ');
    let theirTeamName = [gameState.players[(myPos+1)%4], gameState.players[(myPos+3)%4]].filter(Boolean).join(' & ');
    document.getElementById('score-us-label').innerText = (myTeamName || 'Biz') + ':';
    document.getElementById('score-them-label').innerText = (theirTeamName || 'Onlar') + ':';
    document.getElementById('score-us').innerText = gameState.total_scores[myPos % 2];
    document.getElementById('score-them').innerText = gameState.total_scores[(myPos + 1) % 2];

    // Tricks won this round
    let myTricks = (gameState.tricks_won[myPos] || 0) + (gameState.tricks_won[(myPos+2)%4] || 0);
    let theirTricks = (gameState.tricks_won[(myPos+1)%4] || 0) + (gameState.tricks_won[(myPos+3)%4] || 0);
    let tricksEl = document.getElementById('tricks-info');
    if (tricksEl && gameState.state === 'PLAYING' || gameState.state === 'ROUND_END') {
        let bid = gameState.current_bid;
        let bidder = gameState.highest_bidder;
        let bidderTeam = (bidder !== null && bidder !== undefined) ? (bidder % 2 === myPos % 2 ? 'bizim' : 'onların') : '';
        tricksEl.innerText = `Bu turda: Biz ${myTricks} - Onlar ${theirTricks} el aldı${bid ? ` (İhale: ${bid} ${bidderTeam} takımda)` : ''}`;
    } else if (tricksEl) {
        tricksEl.innerText = '';
    }
    
    if (gameState.trump_suit) {
        document.getElementById('trump-indicator').innerText = "Koz: " + SUIT_SYMBOLS[gameState.trump_suit];
        document.getElementById('trump-indicator').className = 
            "trump-indicator " + ((gameState.trump_suit === 'H'||gameState.trump_suit === 'D') ? 'red' : 'black');
    } else {
        document.getElementById('trump-indicator').innerText = "";
    }
}

function renderHand(uiPos, gamePos) {
    let handContainer = document.getElementById('hand-' + uiPos);
    handContainer.innerHTML = '';
    
    let cards = gameState.hands[gamePos] || [];
    
    // Use server-provided playable indices
    // playable_indices is only set for the cards this player CAN play
    // (own cards or partner's when bidder)
    let playableSet = new Set();
    let isMyHand = (gamePos === gameState.my_position);
    let myPos = gameState.my_position;
    let partnerPos = (gameState.highest_bidder + 2) % 4;
    let isPartnerHand = (gameState.highest_bidder === myPos && gamePos === partnerPos);
    
    if ((isMyHand || isPartnerHand) && gameState.playable_indices) {
        gameState.playable_indices.forEach(i => playableSet.add(i));
    }
    
    let isMyTurn = (gameState.state === 'PLAYING' && gameState.playable_indices && gameState.playable_indices.length > 0);

    cards.forEach((card, index) => {
        let div = document.createElement('div');
        
        if (card.suit === '?') {
            div.className = 'card hidden';
        } else {
            let display = getCardDisplay(card);
            let isPlayable = (isMyHand || isPartnerHand) && playableSet.has(index);
            let isInvalid = (isMyHand || isPartnerHand) && isMyTurn && !playableSet.has(index);
            
            let extraClass = isPlayable ? 'playable' : (isInvalid ? 'unplayable' : '');
            div.className = `card ${display.colorClass} ${extraClass}`;
            div.innerHTML = `
                <div class="card-top-left">
                    <div class="value">${display.valStr}</div>
                    <div class="suit">${display.suitStr}</div>
                </div>
                <div class="center-suit">${display.suitStr}</div>
                <div class="card-bottom-right">
                    <div class="value">${display.valStr}</div>
                    <div class="suit">${display.suitStr}</div>
                </div>
            `;
            if (isPlayable) {
                div.onclick = () => playCard(index);
            }
        }
        handContainer.appendChild(div);
    });
}

function renderPlayedCard(uiPos, gamePos) {
    let container = document.getElementById('played-' + uiPos);
    container.innerHTML = '';
    
    if (gameState.trick_cards && gameState.trick_cards[gamePos]) {
        let card = gameState.trick_cards[gamePos];
        let display = getCardDisplay(card);
        let div = document.createElement('div');
        div.className = `card ${display.colorClass}`;
        div.innerHTML = `
            <div class="card-top-left">
                <div class="value">${display.valStr}</div>
                <div class="suit">${display.suitStr}</div>
            </div>
            <div class="center-suit">${display.suitStr}</div>
            <div class="card-bottom-right">
                <div class="value">${display.valStr}</div>
                <div class="suit">${display.suitStr}</div>
            </div>
        `;
        container.appendChild(div);
    }
}

