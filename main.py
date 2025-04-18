from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session, joinedload
from typing import List
import datetime
from uuid import uuid4

from database import SessionLocal, engine
from models import Base, User, Group, GroupUser, Message
from schemas import PrivateChatCreate, UserCreate, UserOut, GroupCreate, GroupOut, MessageCreate, MessageOut
from auth import create_access_token, get_current_user
from websocket_manager import ConnectionManager

# Создаем таблицы
Base.metadata.create_all(bind=engine)

app = FastAPI()

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Монтируем статические файлы
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/images", StaticFiles(directory="static/images"), name="images")

# Роуты для страниц
@app.get("/", response_class=FileResponse)
async def get_chat():
    return FileResponse("static/chat.html")

@app.get("/login", response_class=FileResponse)
async def get_login():
    return FileResponse("static/login.html")

@app.get("/registration", response_class=FileResponse)
async def get_login():
    return FileResponse("static/registration.html")

# Зависимость для получения сессии БД
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Менеджер WebSocket-соединений
manager = ConnectionManager()

# WebSocket эндпоинт
@app.websocket("/ws/{group_id}")
async def websocket_endpoint(websocket: WebSocket, group_id: int, db: Session = Depends(get_db)):
    await manager.connect(websocket, group_id)
    try:
        while True:
            data = await websocket.receive_json()
            content = data.get("content")
            author_id = data.get("author_id")

            if not content or not author_id:
                await websocket.send_json({"error": "Invalid message data"})
                continue

            # Проверяем, что пользователь состоит в группе
            group_user = db.query(GroupUser).filter(
                GroupUser.group_id == group_id,
                GroupUser.user_id == author_id
            ).first()
            if not group_user:
                await websocket.send_json({"error": "User not in group"})
                continue

            # Сохраняем сообщение в БД
            new_msg = Message(
                content=content,
                author_id=author_id,
                group_id=group_id,
                timestamp=datetime.datetime.now()
            )
            db.add(new_msg)
            db.commit()
            db.refresh(new_msg)

            # Формируем данные для отправки
            author = db.query(User).filter(User.id == author_id).first()
            message_data = {
                "type": "new_message",
                "data": {
                    "id": new_msg.id,
                    "content": new_msg.content,
                    "author_id": new_msg.author_id,
                    "author_username": author.username,
                    "group_id": new_msg.group_id,
                    "timestamp": new_msg.timestamp.isoformat()
                }
            }

            # Отправляем сообщение всем в группе
            await manager.broadcast_to_group(message_data, group_id)

    except WebSocketDisconnect:
        manager.disconnect(websocket, group_id)
    except Exception as e:
        print(f"WebSocket error: {e}")
        await websocket.send_json({"error": "Internal server error"})
        manager.disconnect(websocket, group_id)

# Пользователи
@app.post("/users", response_model=UserOut)
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Username already registered")
    new_user = User(username=user.username, password=user.password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.get("/users/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.get("/users", response_model=List[UserOut])
def get_users(db: Session = Depends(get_db)):
    return db.query(User).all()

@app.post("/login")
def login(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if not db_user or db_user.password != user.password:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    access_token = create_access_token(data={"sub": str(db_user.id)})
    return {"access_token": access_token, "token_type": "bearer", "user_id": db_user.id}

# Группы и чаты
@app.post("/groups", response_model=GroupOut)
def create_group(group: GroupCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    db_group = Group(name=group.name, background=group.background)
    db.add(db_group)
    db.commit()
    db.refresh(db_group)
    
    # Добавляем создателя в группу
    group_user = GroupUser(group_id=db_group.id, user_id=current_user.id)
    db.add(group_user)
    db.commit()
    
    return db_group

@app.get("/groups/{group_id}", response_model=GroupOut)
def get_group(group_id: int, db: Session = Depends(get_db)):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group

@app.post("/groups/{group_id}/add_user")
def add_user_to_group(group_id: int, user_id: int, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    group = db.query(Group).filter(Group.id == group_id).first()
    user = db.query(User).filter(User.id == user_id).first()
    if not group or not user:
        raise HTTPException(status_code=404, detail="Group or user not found")
    if db.query(GroupUser).filter(GroupUser.group_id == group_id, GroupUser.user_id == user_id).first():
        raise HTTPException(status_code=400, detail="User already in group")
    group_user = GroupUser(group_id=group_id, user_id=user_id)
    db.add(group_user)
    db.commit()
    return {"message": "User added to group"}

@app.get("/groups/{group_id}/users")
def get_group_users(group_id: int, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    users = db.query(User).join(GroupUser).filter(GroupUser.group_id == group_id).all()
    return [{"id": user.id, "username": user.username} for user in users]

@app.delete("/groups/{group_id}")
def delete_group(group_id: int, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if not db.query(GroupUser).filter(GroupUser.group_id == group_id, GroupUser.user_id == current_user.id).first():
        raise HTTPException(status_code=403, detail="You are not in this group")
    db.delete(group)
    db.commit()
    return {"message": "Group deleted"}

# Сообщения
@app.post("/messages", response_model=MessageOut)
async def create_message(msg: MessageCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    if msg.group_id and not db.query(GroupUser).filter(GroupUser.group_id == msg.group_id, GroupUser.user_id == current_user.id).first():
        raise HTTPException(status_code=403, detail="User not in group")
    
    new_msg = Message(
        content=msg.content,
        author_id=current_user.id,
        group_id=msg.group_id,
        recipient_id=msg.recipient_id,
        timestamp=datetime.datetime.now()
    )
    db.add(new_msg)
    db.commit()
    db.refresh(new_msg)
    
    if msg.group_id:
        message_data = {
            "type": "new_message",
            "data": {
                "id": new_msg.id,
                "content": new_msg.content,
                "author_id": new_msg.author_id,
                "author_username": current_user.username,
                "group_id": new_msg.group_id,
                "timestamp": new_msg.timestamp.isoformat()
            }
        }
        await manager.broadcast_to_group(message_data, msg.group_id)
    
    return new_msg

@app.get("/messages", response_model=List[MessageOut])
async def get_messages(group_id: int, db: Session = Depends(get_db)):
    messages = db.query(Message).filter(Message.group_id == group_id).options(
        joinedload(Message.author)  # Добавляем загрузку связанного автора
    ).all()
    return messages

@app.put("/messages/{message_id}", response_model=MessageOut)
async def edit_message(message_id: int, message_update: MessageCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    msg = db.query(Message).filter(Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to edit this message")
    
    msg.content = message_update.content
    msg.edited += 1
    db.commit()
    db.refresh(msg)
    
    if msg.group_id:
        message_data = {
            "type": "updated_message",
            "data": {
                "id": msg.id,
                "content": msg.content,
                "author_id": msg.author_id,
                "author_username": current_user.username,
                "group_id": msg.group_id,
                "timestamp": msg.timestamp.isoformat()
            }
        }
        await manager.broadcast_to_group(message_data, msg.group_id)
    
    return msg

@app.delete("/messages/{message_id}")
async def delete_message(message_id: int, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    msg = db.query(Message).filter(Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this message")
    
    db.delete(msg)
    db.commit()
    
    if msg.group_id:
        await manager.broadcast_to_group({"type": "deleted_message", "data": {"id": message_id}}, msg.group_id)
    
    return {"message": "Message deleted"}

# Чаты
@app.get("/chats")
def get_user_chats(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    groups = db.query(Group).join(GroupUser).filter(GroupUser.user_id == current_user.id).all()
    return [{
        "id": group.id,
        "name": group.name,
        "type": "group" if db.query(GroupUser).filter(GroupUser.group_id == group.id).count() > 2 else "private",
        "background": group.background
    } for group in groups]

@app.post("/chats", response_model=dict)
def create_private_chat(chat: PrivateChatCreate, db: Session = Depends(get_db)):
    # Check if users exist
    user = db.query(User).filter(User.id == chat.user_id).first()
    recipient = db.query(User).filter(User.id == chat.recipient_id).first()
    
    if not user or not recipient:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Generate chat name if not provided
    chat_name = chat.name or f"Chat with {recipient.username}"
    
    # Create a new group for this private chat
    db_group = Group(
        name=chat_name,
        type="private",
        background="#E5DDD5"
    )
    db.add(db_group)
    db.commit()
    db.refresh(db_group)
    
    # Add both users to the group
    user_group1 = GroupUser(group_id=db_group.id, user_id=chat.user_id)
    user_group2 = GroupUser(group_id=db_group.id, user_id=chat.recipient_id)
    db.add(user_group1)
    db.add(user_group2)
    db.commit()
    
    # Return the new chat info
    return {
        "id": db_group.id,
        "name": chat_name,
        "type": "private",
        "background": db_group.background
    }