from fastapi import WebSocket
from typing import Dict, Set
import json

class ConnectionManager:
    def __init__(self):
        # Store active connections: {group_id: {websocket, ...}}
        self.active_connections: Dict[int, Set[WebSocket]] = {}
        
    async def connect(self, websocket: WebSocket, group_id: int):
        await websocket.accept()
        if group_id not in self.active_connections:
            self.active_connections[group_id] = set()
        self.active_connections[group_id].add(websocket)
    
    def disconnect(self, websocket: WebSocket, group_id: int):
        self.active_connections[group_id].remove(websocket)
        if not self.active_connections[group_id]:
            del self.active_connections[group_id]
    
    async def broadcast_to_group(self, message: dict, group_id: int):
        if group_id in self.active_connections:
            for connection in self.active_connections[group_id]:
                try:
                    await connection.send_json(message)
                except:
                    await connection.close()