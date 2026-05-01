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
    for ws in list(connected_websockets):
        try:
            state = game.get_state_for_player(id(ws))
            if state and not ws.closed:
                await ws.send_json({'type': 'STATE_UPDATE', 'state': state})
        except Exception as e:
            logger.error(f"Broadcast error: {e}")

async def websocket_handler(request):
    ws = web.WebSocketResponse(heartbeat=20.0)
    await ws.prepare(request)
    ws_id = id(ws)
    connected_websockets.add(ws)
    
    try:
        # Send initial empty state to trigger UI
        await ws.send_json({'type': 'STATE_UPDATE', 'state': game.get_state_for_player(ws_id)})
        
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                data = json.loads(msg.data)
                action = data.get('action')
                player_data = game.players.get(ws_id, {})
                pos = player_data.get('position')
                
                if action == 'get_state':
                    await ws.send_json({'type': 'STATE_UPDATE', 'state': game.get_state_for_player(ws_id)})

                elif action == 'join':
                    name = data.get('name', 'İsimsiz')
                    success, message = game.add_player(ws_id, name)
                    await ws.send_json({'type': 'JOIN_RESULT', 'success': success, 'message': message})
                    await broadcast_state()
                
                elif action == 'add_bot':
                    bot_pos = data.get('position')
                    logger.info(f"Bot talebi geldi: Koltuk {bot_pos}")
                    name = f"Bot {bot_pos + 1}"
                    success, message = game.add_player(f"bot_{bot_pos}", name, bot_pos)
                    logger.info(f"Bot ekleme sonucu: {success}, {message}")
                    if success:
                        game.is_bot[bot_pos] = True
                    await broadcast_state()
                
                elif action == 'start':
                    game.start_game()
                    await broadcast_state()
                
                elif action == 'bid':
                    game.handle_bid(pos, data.get('amount'))
                    await broadcast_state()
                    
                elif action == 'set_trump':
                    game.set_trump(pos, data.get('suit'))
                    await broadcast_state()
                    
                elif action == 'play_card':
                    game.play_card(pos, data.get('card_index'), data.get('player_pos'))
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
                                'to': to_pos, 'sender': sender_name, 'gift': gift_type
                            })
    finally:
        connected_websockets.remove(ws)
        game.remove_player(ws_id)
        await broadcast_state()
    return ws

async def bot_loop(app):
    while True:
        await asyncio.sleep(1.0)
        try:
            # Auto-clear trick if 4 cards are on the table
            if len(game.trick_cards) == 4:
                await asyncio.sleep(1.5)
                game.clear_trick()
                await broadcast_state()
                continue

            bot_pos = None
            if game.state == 'BIDDING': bot_pos = game.bidding_turn
            elif game.state == 'WAITING_TRUMP': bot_pos = game.highest_bidder
            elif game.state == 'PLAYING': bot_pos = game.current_turn
            
            if bot_pos is not None and game.is_bot.get(bot_pos):
                # REIS: İhaleyi alan takımda bir İNSAN varsa, o takımın botu asla kendi kendine oynamaz.
                winner = game.highest_bidder
                if winner is not None and game.state == 'PLAYING':
                    # Botun ortağı kim?
                    partner_of_bot = (bot_pos + 2) % 4
                    # Eğer botun takım arkadaşı ihaleyi kazandıysa VE o arkadaşı bir insansa: DUR.
                    if (winner == bot_pos or winner == partner_of_bot) and not game.is_bot.get(partner_of_bot if winner == bot_pos else winner):
                        continue

                action, value = game.get_bot_move(bot_pos)
                if action == 'bid':
                    game.handle_bid(bot_pos, value)
                    await broadcast_state()
                elif action == 'set_trump':
                    game.set_trump(bot_pos, value)
                    await broadcast_state()
                elif action == 'play_card':
                    game.play_card(bot_pos, value, bot_pos)
                    await broadcast_state()
        except Exception as e:
            logger.error(f"Bot loop error: {e}")

async def start_background_tasks(app):
    app['bot_task'] = asyncio.create_task(bot_loop(app))

async def cleanup_background_tasks(app):
    app['bot_task'].cancel()
    await app['bot_task']

def setup_app():
    app = web.Application()
    app.on_startup.append(start_background_tasks)
    app.on_cleanup.append(cleanup_background_tasks)
    app.add_routes([
        web.get('/', lambda r: web.FileResponse(os.path.join(FRONTEND_DIR, "index.html"))),
        web.get('/ws', websocket_handler),
        web.get('/health', lambda r: web.Response(text="OK"))
    ])
    app.router.add_static('/', path=FRONTEND_DIR, name='static')
    return app

if __name__ == '__main__':
    app = setup_app()
    web.run_app(app, host='0.0.0.0', port=PORT)
