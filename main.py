# main.py
from fastapi import FastAPI, Depends, HTTPException
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from typing import List
from database import SessionLocal, engine
from models import Base, User, Group, GroupUser, Message
from schemas import PrivateChatCreate, UserCreate, UserOut, GroupCreate, GroupOut, MessageCreate, MessageOut
from auth import create_access_token, get_current_user  # Импорт из auth.py

# Создаем таблицы (если их нет)
Base.metadata.create_all(bind=engine)

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

# Зависимость для получения сессии
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# =============== Пользователи ===============
@app.post("/users", response_model=UserOut)
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    new_user = User(username=user.username, password=user.password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.get("/users/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    return db_user

@app.get("/users", response_model=List[UserOut])
def get_users(db: Session = Depends(get_db)):
    return db.query(User).all()

# Изменяем эндпоинт логина, чтобы возвращать токен
@app.post("/login")
def login(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if not db_user or db_user.password != user.password:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    access_token = create_access_token(data={"sub": str(db_user.id)})
    return {"access_token": access_token, "token_type": "bearer", "user_id": db_user.id}

# =============== Группы ===============
@app.post("/groups", response_model=GroupOut)
def create_group(group: GroupCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    db_group = Group(name=group.name, background=group.background)
    db.add(db_group)
    db.commit()
    db.refresh(db_group)
    return db_group

@app.get("/groups/{group_id}", response_model=GroupOut)
def get_group(group_id: int, db: Session = Depends(get_db)):
    db_group = db.query(Group).filter(Group.id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
    return db_group

@app.post("/groups/{group_id}/add_user")
def add_user_to_group(group_id: int, user_id: int, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    group = db.query(Group).filter(Group.id == group_id).first()
    user = db.query(User).filter(User.id == user_id).first()
    if not group or not user:
        raise HTTPException(status_code=404, detail="Group or user not found")
    existing = db.query(GroupUser).filter(GroupUser.group_id == group_id, GroupUser.user_id == user_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="User already in group")
    group_user = GroupUser(group_id=group_id, user_id=user_id)
    db.add(group_user)
    db.commit()
    return {"message": "User added to group"}

@app.get("/groups/{group_id}/users")
def get_group_users(group_id: int, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    # Check if group exists
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Get all users in the group
    users = db.query(User).join(GroupUser).filter(GroupUser.group_id == group_id).all()
    
    return [{"id": user.id, "username": user.username} for user in users]

@app.delete("/groups/{group_id}")
def delete_group(group_id: int, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    db_group = db.query(Group).filter(Group.id == group_id).first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
    db.delete(db_group)
    db.commit()
    return {"message": "Group deleted"}

# =============== Сообщения ===============
@app.post("/messages", response_model=MessageOut)
def create_message(msg: MessageCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    new_msg = Message(
        content=msg.content,
        author_id=current_user.id,  # Берем ID из токена
        group_id=msg.group_id,
        recipient_id=msg.recipient_id
    )
    db.add(new_msg)
    db.commit()
    db.refresh(new_msg)
    return new_msg

@app.get("/messages", response_model=List[MessageOut])
def get_messages(group_id: int = None, recipient_id: int = None, db: Session = Depends(get_db)):
    query = db.query(Message)
    if group_id:
        query = query.filter(Message.group_id == group_id)
    if recipient_id:
        query = query.filter(Message.recipient_id == recipient_id)
    return query.all()

@app.put("/messages/{message_id}", response_model=MessageOut)
def edit_message(message_id: int, message_update: dict, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    db_msg = db.query(Message).filter(Message.id == message_id).first()
    if not db_msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if db_msg.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Нет доступа для редактирования этого сообщения")
    
    content = message_update.get("content", "")
    if not content:
        raise HTTPException(status_code=400, detail="Content cannot be empty")
        
    db_msg.content = content
    db_msg.edited += 1
    db.commit()
    db.refresh(db_msg)
    return db_msg

@app.delete("/messages/{message_id}")
def delete_message(message_id: int, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    db_msg = db.query(Message).filter(Message.id == message_id).first()
    if not db_msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if db_msg.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Нет доступа для удаления этого сообщения")
    
    db.delete(db_msg)
    db.commit()
    return {"message": "Message deleted"}

@app.get("/chats")
def get_user_chats(user_id: int, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user_groups = db.query(Group).join(GroupUser).filter(GroupUser.user_id == user_id).all()
    chats = []
    for group in user_groups:
        chats.append({
            "id": group.id,
            "name": group.name,
            "type": "group",
            "background": group.background
        })
    return chats

@app.post("/chats", response_model=dict)
def create_private_chat(chat: PrivateChatCreate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == chat.user_id).first()
    recipient = db.query(User).filter(User.id == chat.recipient_id).first()
    
    if not user or not recipient:
        raise HTTPException(status_code=404, detail="User not found")
    
    chat_name = f"Chat with {recipient.username}"
    db_group = Group(name=chat_name, background="#E5DDD5")
    db.add(db_group)
    db.commit()
    db.refresh(db_group)
    
    user_group1 = GroupUser(group_id=db_group.id, user_id=chat.user_id)
    user_group2 = GroupUser(group_id=db_group.id, user_id=chat.recipient_id)
    db.add(user_group1)
    db.add(user_group2)
    db.commit()
    
    return {
        "id": db_group.id,
        "name": chat_name,
        "type": "private",
        "background": db_group.background
    }
