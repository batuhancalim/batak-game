import asyncio
import json
import os
import logging
from aiohttp import web, WSCloseCode
from game import GameEngine

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('batak-server')

game = GameEngine()
connected_websockets = set()
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
PORT = int(os.environ.get("PORT", 8080))

async def broadcast_state():
    if not connected_websockets:
        return
    
    # We need to send state to each player based on their perspective
    for ws in list(connected_websockets):
        try:
            state = game.get_state_for_player(id(ws))
            if state and not ws.closed:
                await ws.send_json({'type': 'STATE_UPDATE', 'state': state})
        except Exception as e:
            logger.error(f"Broadcast error for {id(ws)}: {e}")

async def websocket_handler(request):
    ws = web.WebSocketResponse(heartbeat=20.0)
    await ws.prepare(request)
    
    ws_id = id(ws)
    connected_websockets.add(ws)
    logger.info(f"Yeni WebSocket bağlantısı: {ws_id}. Toplam: {len(connected_websockets)}")

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                data = json.loads(msg.data)
                action = data.get('action')
                player_data = game.players.get(ws_id, {})
                pos = player_data.get('position')
                
                if action == 'join':
                    name = data.get('name', 'İsimsiz')
                    success, message = game.add_player(ws_id, name)
                    await ws.send_json({'type': 'JOIN_RESULT', 'success': success, 'message': message})
                    await broadcast_state()
                
                elif action == 'start':
                    game.start_game()
                    await broadcast_state()
                
                elif action == 'bid':
                    success, msg_err = game.handle_bid(pos, data.get('amount'))
                    if not success: await ws.send_json({'type': 'ERROR', 'message': msg_err})
                    await broadcast_state()
                    
                elif action == 'set_trump':
                    success, msg_err = game.set_trump(pos, data.get('suit'))
                    if not success: await ws.send_json({'type': 'ERROR', 'message': msg_err})
                    await broadcast_state()
                    
                elif action == 'play_card':
                    success, msg_err = game.play_card(pos, data.get('card_index'))
                    if not success: await ws.send_json({'type': 'ERROR', 'message': msg_err})
                    await broadcast_state()
                    
                elif action == 'clear_trick':
                    game.clear_trick()
                    await broadcast_state()
                    
                elif action == 'next_round':
                    game.state = 'BIDDING'
                    game.reset_round()
                    game.deal_cards()
                    game.bidding_turn = game.first_to_bid
                    await broadcast_state()
                    
                elif action == 'reset_scores':
                    game.total_scores = {0: 0, 1: 0}
                    await broadcast_state()
                    
                elif action == 'send_gift':
                    to_pos = data.get('to')
                    gift_type = data.get('gift')
                    sender_name = player_data.get('name', 'Biri')
                    for client_ws in list(connected_websockets):
                        if not client_ws.closed:
                            await client_ws.send_json({
                                'type': 'GIFT',
                                'to': to_pos,
                                'sender': sender_name,
                                'gift': gift_type
                            })
                            
            elif msg.type == web.WSMsgType.ERROR:
                logger.error(f'ws connection closed with exception {ws.exception()}')

    finally:
        connected_websockets.remove(ws)
        game.remove_player(ws_id)
        logger.info(f"Bağlantı kesildi: {ws_id}. Kalan: {len(connected_websockets)}")
        await broadcast_state()

    return ws

async def index_handler(request):
    return web.FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

async def health_check(request):
    return web.Response(text="Hala ayaktayız! ☕")

def setup_app():
    app = web.Application()
    app.add_routes([
        web.get('/', index_handler),
        web.get('/ws', websocket_handler),
        web.get('/health', health_check),
        web.static('/styles', FRONTEND_DIR) # Just in case
    ])
    # Automatically serve all files in frontend directory
    app.router.add_static('/', path=FRONTEND_DIR, name='static')
    return app

if __name__ == '__main__':
    app = setup_app()
    logger.info(f"Sunucu {PORT} portunda başlatılıyor...")
    web.run_app(app, host='0.0.0.0', port=PORT)
