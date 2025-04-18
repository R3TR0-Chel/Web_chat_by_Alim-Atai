const API_URL = "";
const token = localStorage.getItem("access_token");
const currentUserId = parseInt(localStorage.getItem("user_id")) || null;

if (!currentUserId || !token) {
    window.location.href = "/login";
}

let currentGroupId = null;
let ws = null;
let chats = [];
let users = [];

const messagesContainer = document.getElementById("messagesContainer");
const chatTitle = document.getElementById("chatTitle");
const chatMessageInput = document.getElementById("chatMessageInput");
const sendMessageBtn = document.getElementById("sendMessageBtn");

// Инициализация
document.addEventListener("DOMContentLoaded", initializeApp);

async function initializeApp() {
    await loadChats();
    setupEventListeners();
}

function setupEventListeners() {
    sendMessageBtn.addEventListener("click", sendMessage);
    chatMessageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendMessage();
    });
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".edit-delete")) {
            document.querySelectorAll(".dropdown-menu").forEach(m => m.style.display = "none");
        }
    });
    document.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('.message')) {
            e.preventDefault();
            const contextMenu = document.querySelector('.context-menu');
            if (contextMenu) contextMenu.remove();
        }
    });
}

// WebSocket
function connectWebSocket(groupId) {
    if (ws) {
        ws.close();
        ws = null;
    }
    
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/${groupId}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log(`WebSocket connected to group ${groupId}`);
        fetchMessages();
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.error) {
            console.error(data.error);
            return;
        }
        
        if (data.type === "new_message" && data.data.group_id === currentGroupId) {
            displayMessages([data.data], true);
        } else if (data.type === "updated_message" && data.data.group_id === currentGroupId) {
            updateMessage(data.data);
        } else if (data.type === "deleted_message" && data.data.group_id === currentGroupId) {
            removeMessage(data.data.id);
        }
    };
    
    ws.onclose = () => {
        console.log("WebSocket closed. Reconnecting...");
        setTimeout(() => connectWebSocket(groupId), 2000);
    };
    
    ws.onerror = (err) => console.error("WebSocket error:", err);
}

// Сообщения
async function sendMessage() {
    const content = chatMessageInput.value.trim();
    if (!content || !ws || ws.readyState !== WebSocket.OPEN || !currentGroupId) {
        return;
    }
    
    ws.send(JSON.stringify({
        content,
        author_id: currentUserId,
        group_id: currentGroupId
    }));
    
    chatMessageInput.value = "";
}

async function fetchMessages() {
    try {
        const response = await fetch(`${API_URL}/messages?group_id=${currentGroupId}`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (response.ok) {
            const messages = await response.json();
            displayMessages(messages);
        } else {
            throw new Error("Failed to fetch messages");
        }
    } catch (err) {
        console.error("Error fetching messages:", err);
    }
}

function displayMessages(messages, append = false) {
    if (!append) {
        messagesContainer.innerHTML = "";
    }
    
    messages.forEach(msg => {
        const isSentByMe = msg.author_id === currentUserId;
        const messageDiv = document.createElement("div");
        messageDiv.className = `message ${isSentByMe ? 'sent' : 'received'}`;
        messageDiv.id = `message-${msg.id}`;
        
        // Получаем имя автора
        const authorName = isSentByMe ? 'Вы' : 
            (msg.author && msg.author.username ? msg.author.username : 'Unknown');
        
        messageDiv.innerHTML = `
            <div class="message-wrapper">
                <div class="message-author">${authorName}</div>
                <div class="message-content">${msg.content}</div>
                <div class="message-info">
                    ${new Date(msg.timestamp).toLocaleTimeString()}
                    ${msg.edited ? '(изменено)' : ''}
                </div>
            </div>
        `;

        // Добавляем контекстное меню только для своих сообщений
        if (isSentByMe) {
            messageDiv.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showContextMenu(e, msg);
            });
        }
        
        messagesContainer.appendChild(messageDiv);
    });
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function updateMessage(updatedMsg) {
    const msgDiv = document.getElementById(`message-${updatedMsg.id}`);
    if (msgDiv) {
        const content = msgDiv.querySelector(".message-content");
        content.textContent = updatedMsg.content;
        
        const info = msgDiv.querySelector(".message-info");
        info.innerHTML = `
            ${new Date(updatedMsg.timestamp).toLocaleTimeString()}
            ${updatedMsg.edited ? '(изменено)' : ''}
        `;
    }
}

function removeMessage(messageId) {
    const msgDiv = messagesContainer.querySelector(`[data-message-id="${messageId}"]`);
    if (msgDiv) msgDiv.remove();
}

async function deleteMessage(messageId) {
    if (!confirm("Удалить сообщение?")) return;
    
    try {
        const response = await fetch(`${API_URL}/messages/${messageId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!response.ok) throw new Error("Failed to delete message");
    } catch (err) {
        console.error("Error deleting message:", err);
        alert("Ошибка при удалении сообщения");
    }
}

function openEditModal(msg) {
    const modal = document.getElementById("editMessageModal");
    const input = document.getElementById("editMessageInput");
    // Используем JSON.parse для преобразования строки в объект
    const message = typeof msg === 'string' ? JSON.parse(msg) : msg;
    
    input.value = message.content;
    input.dataset.messageId = message.id;
    modal.style.display = "flex";
    input.focus();
}

async function submitEdit() {
    const input = document.getElementById("editMessageInput");
    const messageId = input.dataset.messageId;
    const content = input.value.trim();
    
    if (!content) return;
    
    try {
        const response = await fetch(`${API_URL}/messages/${messageId}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ content })
        });
        
        if (!response.ok) {
            throw new Error("Failed to edit message");
        }
        
        closeModal("editMessageModal");
    } catch (err) {
        console.error("Error editing message:", err);
        alert("Ошибка при редактировании сообщения");
    }
}

// Чаты
async function loadChats() {
    try {
        const response = await fetch(`${API_URL}/chats`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (response.ok) {
            chats = await response.json();
            renderChatsList();
            if (chats.length > 0 && !currentGroupId) {
                switchToChat(chats[0].id);
            }
        } else {
            throw new Error("Failed to load chats");
        }
    } catch (err) {
        console.error("Error loading chats:", err);
        chats = [];
        renderChatsList();
    }
}

function renderChatsList() {
    const sidebar = document.querySelector(".sidebar");
    sidebar.innerHTML = `
        <div class="sidebar-header">
            <button class="new-chat" onclick="createPrivateChat()">Новый чат</button>
            <button class="new-group" onclick="createGroup()">Новая группа</button>
        </div>
        <div class="chat-list"></div>
    `;
    
    const chatList = sidebar.querySelector(".chat-list");
    chats.forEach(chat => {
        const chatItem = document.createElement("div");
        chatItem.classList.add("chat-item");
        if (chat.id === currentGroupId) chatItem.classList.add("active");
        
        chatItem.innerHTML = `
            <div class="chat-avatar">${chat.name.charAt(0)}</div>
            <div class="chat-info">
                <div class="chat-name">${chat.name}</div>
                <div class="chat-preview">...</div>
            </div>
            <button class="delete-chat" onclick="deleteChat(${chat.id})">×</button>
        `;
        
        chatItem.onclick = (e) => {
            if (!e.target.classList.contains("delete-chat")) {
                switchToChat(chat.id);
            }
        };
        chatList.appendChild(chatItem);
    });
}

function switchToChat(chatId) {
    if (currentGroupId === chatId) return;
    
    currentGroupId = chatId;
    const chat = chats.find(c => c.id === chatId);
    if (chat) {
        chatTitle.textContent = chat.name;
        messagesContainer.innerHTML = "";
        connectWebSocket(chatId);
        
        document.querySelectorAll(".chat-item").forEach(item => item.classList.remove("active"));
        const activeItem = document.querySelector(`.chat-item:has([onclick*="${chatId}"])`);
        if (activeItem) activeItem.classList.add("active");
    }
}

async function createPrivateChat() {
    await fetchUsers();
    const usersList = document.getElementById("usersList");
    usersList.innerHTML = "";
    
    users.forEach(user => {
        if (user.id === currentUserId) return;
        const userItem = document.createElement("div");
        userItem.classList.add("user-item");
        userItem.innerHTML = `
            <div class="user-avatar">${user.username.charAt(0)}</div>
            <div class="user-name">${user.username}</div>
        `;
        userItem.onclick = () => {
            document.getElementById("privateChatNameInput").dataset.recipientId = user.id;
            document.getElementById("userSelectionModal").style.display = "none";
            document.getElementById("privateChatNameModal").style.display = "flex";
        };
        usersList.appendChild(userItem);
    });
    
    document.getElementById("userSelectionModal").style.display = "flex";
}

async function submitPrivateChat() {
    const recipientId = document.getElementById("privateChatNameInput").dataset.recipientId;
    const name = document.getElementById("privateChatNameInput").value.trim();
    
    try {
        const response = await fetch(`${API_URL}/chats`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                user_id: currentUserId,
                recipient_id: parseInt(recipientId),
                name: name || undefined
            })
        });
        
        if (response.ok) {
            const newChat = await response.json();
            closeModal("privateChatNameModal");
            await loadChats();
            switchToChat(newChat.id);
        } else {
            throw new Error("Failed to create chat");
        }
    } catch (err) {
        console.error("Error creating chat:", err);
        alert("Ошибка при создании чата");
    }
}

async function createGroup() {
    const selectedUsers = [];
    await fetchUsers();
    
    const usersList = document.getElementById("groupUsersList");
    usersList.innerHTML = "";
    
    users.forEach(user => {
        if (user.id === currentUserId) return;
        const userItem = document.createElement("div");
        userItem.classList.add("user-item");
        userItem.innerHTML = `
            <div class="user-avatar">${user.username.charAt(0)}</div>
            <div class="user-name">${user.username}</div>
            <input type="checkbox" class="user-checkbox" data-user-id="${user.id}">
        `;
        
        const checkbox = userItem.querySelector(".user-checkbox");
        checkbox.onchange = (e) => {
            if (e.target.checked) {
                selectedUsers.push(user.id);
                userItem.classList.add("selected");
            } else {
                selectedUsers.splice(selectedUsers.indexOf(user.id), 1);
                userItem.classList.remove("selected");
            }
        };
        
        usersList.appendChild(userItem);
    });
    
    document.getElementById("createGroupModal").style.display = "flex";
}

async function submitGroupCreation() {
    const groupName = document.getElementById("groupNameInput").value.trim();
    const selectedUsers = Array.from(document.querySelectorAll(".user-checkbox:checked")).map(cb => parseInt(cb.dataset.userId));
    
    if (!groupName) {
        alert("Введите название группы");
        return;
    }
    
    if (selectedUsers.length === 0) {
        alert("Выберите хотя бы одного участника");
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/groups`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ name: groupName, background: "#ECE5DD" })
        });
        
        if (!response.ok) throw new Error("Failed to create group");
        
        const newGroup = await response.json();
        
        for (const userId of [...selectedUsers, currentUserId]) {
            await fetch(`${API_URL}/groups/${newGroup.id}/add_user?user_id=${userId}`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` }
            });
        }
        
        closeModal("createGroupModal");
        await loadChats();
        switchToChat(newGroup.id);
    } catch (err) {
        console.error("Error creating group:", err);
        alert("Ошибка при создании группы");
    }
}

async function deleteChat(chatId) {
    if (!confirm("Удалить чат?")) return;
    
    try {
        const response = await fetch(`${API_URL}/groups/${chatId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        
        if (response.ok) {
            if (currentGroupId === chatId) {
                currentGroupId = null;
                messagesContainer.innerHTML = "";
                chatTitle.textContent = "Выберите чат";
                if (ws) ws.close();
            }
            await loadChats();
        } else {
            throw new Error("Failed to delete chat");
        }
    } catch (err) {
        console.error("Error deleting chat:", err);
        alert("Ошибка при удалении чата");
    }
}

async function createChat(userId) {
    try {
        const response = await fetch(`${API_URL}/chats`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                user_id: currentUserId,
                recipient_id: userId,
                type: "private"
            })
        });

        if (response.ok) {
            const newChat = await response.json();
            closeModal("userSelectionModal");
            await loadChats();
            switchToChat(newChat.id);
        } else {
            throw new Error("Failed to create chat");
        }
    } catch (err) {
        console.error("Error creating chat:", err);
        alert("Ошибка при создании чата");
    }
}

// Утилиты
async function fetchUsers() {
    try {
        const response = await fetch(`${API_URL}/users`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (response.ok) {
            users = await response.json();
        } else {
            throw new Error("Failed to fetch users");
        }
    } catch (err) {
        console.error("Error fetching users:", err);
        users = [];
    }
}

function toggleDropdown(toggleElem) {
    const menu = toggleElem.querySelector(".dropdown-menu");
    document.querySelectorAll(".dropdown-menu").forEach(m => {
        if (m !== menu) m.style.display = "none";
    });
    menu.style.display = menu.style.display === "block" ? "none" : "block";
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = "none";
}

function openChatParticipants() {
    fetch(`${API_URL}/groups/${currentGroupId}/users`, {
        headers: { "Authorization": `Bearer ${token}` }
    })
        .then(response => {
            if (!response.ok) throw new Error("Failed to fetch participants");
            return response.json();
        })
        .then(participants => {
            const participantsList = document.getElementById("participantsList");
            participantsList.innerHTML = "";
            
            participants.forEach(user => {
                const participantDiv = document.createElement("div");
                participantDiv.classList.add("participant-item");
                participantDiv.innerHTML = `
                    <div class="participant-avatar">${user.username.charAt(0)}</div>
                    <div class="participant-name">${user.username}${user.id === currentUserId ? " (Вы)" : ""}</div>
                `;
                participantsList.appendChild(participantDiv);
            });
            
            document.getElementById("chatParticipantsModal").style.display = "flex";
        })
        .catch(err => {
            console.error("Error fetching participants:", err);
            alert("Ошибка при загрузке участников");
        });
}

function showContextMenu(e, msg) {
    const oldMenu = document.querySelector('.context-menu');
    if (oldMenu) oldMenu.remove();

    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.innerHTML = `
        <div class="context-menu-item" onclick="openEditModal('${JSON.stringify(msg).replace(/'/g, "\\'")}')">
            <i class="fas fa-edit"></i> Изменить
        </div>
        <div class="context-menu-item" onclick="deleteMessage(${msg.id})">
            <i class="fas fa-trash"></i> Удалить
        </div>
    `;

    contextMenu.style.left = `${e.pageX}px`;
    contextMenu.style.top = `${e.pageY}px`;

    document.body.appendChild(contextMenu);

    // Закрываем меню при клике вне его
    document.addEventListener('click', () => {
        contextMenu.remove();
    }, { once: true });
}