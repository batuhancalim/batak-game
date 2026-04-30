"""
Unified HTTP + WebSocket server for Batak game.
Uses Python's built-in asyncio + websockets library.
"""
import asyncio
import json
import os
import sys
import mimetypes
import websockets
from websockets.http11 import Response
from websockets.datastructures import Headers
from game import GameEngine

game = GameEngine()
connected = set()
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
PORT = 8080

async def broadcast_state():
    for ws in list(connected):
        try:
            state = game.get_state_for_player(id(ws))
            if state:
                await ws.send(json.dumps({'type': 'STATE_UPDATE', 'state': state}))
        except:
            pass

async def handler(websocket):
    connected.add(websocket)
    try:
        async for message in websocket:
            data = json.loads(message)
            action = data.get('action')
            pos = game.players.get(id(websocket), {}).get('position')
            if action == 'join':
                success, msg = game.add_player(id(websocket), data.get('name'))
                await websocket.send(json.dumps({'type': 'JOIN_RESULT', 'success': success, 'message': msg}))
                await broadcast_state()
            elif action == 'start':
                game.start_game()
                await broadcast_state()
            elif action == 'bid':
                success, msg = game.handle_bid(pos, data.get('amount'))
                if not success:
                    await websocket.send(json.dumps({'type': 'ERROR', 'message': msg}))
                await broadcast_state()
            elif action == 'set_trump':
                success, msg = game.set_trump(pos, data.get('suit'))
                if not success:
                    await websocket.send(json.dumps({'type': 'ERROR', 'message': msg}))
                await broadcast_state()
            elif action == 'play_card':
                success, msg = game.play_card(pos, data.get('card_index'))
                if not success:
                    await websocket.send(json.dumps({'type': 'ERROR', 'message': msg}))
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
    except Exception:
        pass
    finally:
        if websocket in connected:
            connected.remove(websocket)
        game.remove_player(id(websocket))
        await broadcast_state()

def serve_file(path):
    """Serve a static file, returns (status, headers, body)."""
    if path == "/" or path == "":
        path = "/index.html"
    
    local_path = os.path.normpath(os.path.join(FRONTEND_DIR, path.lstrip("/")))
    # Security check
    if not local_path.startswith(FRONTEND_DIR):
        return 403, {}, b"Forbidden"
    
    if not os.path.isfile(local_path):
        return 404, {}, b"Not Found"
    
    with open(local_path, "rb") as f:
        body = f.read()
    
    mime, _ = mimetypes.guess_type(local_path)
    return 200, {"Content-Type": mime or "application/octet-stream", "Content-Length": str(len(body))}, body

async def process_request(connection, request):
    # Let WebSocket handshakes through
    upgrade = request.headers.get("Upgrade", "").lower()
    if upgrade == "websocket":
        return None  # Let websockets library handle it
    
    # Serve static files for HTTP requests
    path = request.path.split("?")[0]
    try:
        status, extra_headers, body = serve_file(path)
        headers = Headers(list(extra_headers.items()))
        return Response(status, "OK" if status == 200 else "Error", headers, body)
    except Exception as e:
        return Response(500, "Internal Server Error", Headers(), b"500 Internal Server Error")

async def main():
    mimetypes.init()
    ws_logger = __import__('logging').getLogger('websockets')
    ws_logger.setLevel(__import__('logging').CRITICAL)  # Silence health-check noise
    
    print(f"Sunucu port {PORT} üzerinde başlatılıyor (HTTP + WebSocket)...")
    
    async with websockets.serve(
        handler, 
        "0.0.0.0", 
        PORT, 
        process_request=process_request,
        ping_interval=20,
        ping_timeout=20,
    ):
        print(f"Sunucu hazır! http://localhost:{PORT}")
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Sunucu durduruldu.")
