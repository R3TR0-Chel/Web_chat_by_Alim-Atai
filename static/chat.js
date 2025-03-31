const API_URL = "http://127.0.0.1:8000";
// Для учебного примера предполагаем, что id пользователя уже сохранён
const currentUserId = parseInt(localStorage.getItem("user_id")) || null;
if (!currentUserId) {
  window.location.href = '/static/login.html';
}
// Для примера работаем с группой с id = 1
let currentGroupId = 1;
const token = localStorage.getItem("access_token");
let messageBeingEdited = null;

let chats = [];
let users = [];
let selectedGroupUsers = [];

document.getElementById("sendMessageBtn").addEventListener("click", sendMessage);
document.getElementById("chatMessageInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});

// Функция отправки сообщения
async function sendMessage() {
  const input = document.getElementById("chatMessageInput");
  const content = input.value.trim();
  if (!content) return;
  
  try {
    const response = await fetch(`${API_URL}/messages`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ 
        content, 
        group_id: currentGroupId,
        author_id: parseInt(currentUserId) // Убедимся что ID числовой
      })
    });
    
    if (response.ok) {
      input.value = "";
      await fetchUsers(); // Обновляем список пользователей
      fetchMessages(); // Обновляем сообщения
    } else {
      const errorData = await response.json();
      alert("Ошибка: " + errorData.detail);
    }
  } catch (err) {
    console.error(err);
    alert("Ошибка соединения с сервером");
  }
}

// Функция рендеринга сообщений в контейнере
function displayMessages(messages) {
  const container = document.getElementById("messagesContainer");
  container.innerHTML = "";

  if (messages.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-messages";
    emptyState.textContent = "Нет сообщений. Начните общение!";
    emptyState.style.textAlign = "center";
    emptyState.style.color = "#888";
    emptyState.style.margin = "auto";
    container.appendChild(emptyState);
    return;
  }

  // Сначала загрузим актуальный список пользователей
  fetchUsers().then(() => {
    messages.forEach(msg => {
      const msgDiv = document.createElement("div");
      msgDiv.classList.add("message");

      // Проверяем автора сообщения
      const isCurrentUser = parseInt(msg.author_id) === parseInt(currentUserId);

      if (isCurrentUser) {
        msgDiv.classList.add("sent");
      } else {
        msgDiv.classList.add("received");
      }

      // Информация об авторе
      const infoDiv = document.createElement("div");
      infoDiv.classList.add("info");

      // Ищем автора в списке пользователей
      const author = users.find(user => parseInt(user.id) === parseInt(msg.author_id));
      let authorName = author ? author.username : `User ${msg.author_id}`;

      if (isCurrentUser) {
        authorName = "Вы"; // Display "Вы" for the current user
      }

      infoDiv.textContent = authorName;

      // Текст сообщения
      const textDiv = document.createElement("div");
      textDiv.classList.add("text");
      textDiv.textContent = msg.content;

      // Время сообщения
      const timeDiv = document.createElement("div");
      timeDiv.classList.add("time");
      const timestamp = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      timeDiv.textContent = timestamp;

      msgDiv.appendChild(infoDiv);
      msgDiv.appendChild(textDiv);
      msgDiv.appendChild(timeDiv);

      // Добавляем кнопки редактирования только для сообщений текущего пользователя
      if (isCurrentUser) {
        const dropdownToggle = document.createElement("div");
        dropdownToggle.classList.add("edit-delete");
        dropdownToggle.innerHTML = `<i class="fas fa-ellipsis-v"></i>`;
        dropdownToggle.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleDropdown(dropdownToggle);
        });

        const dropdownMenu = document.createElement("div");
        dropdownMenu.classList.add("dropdown-menu");

        const editBtn = document.createElement("button");
        editBtn.textContent = "Изменить";
        editBtn.addEventListener("click", () => openEditModal(msg));

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Удалить";
        deleteBtn.addEventListener("click", () => deleteMessage(msg.id));

        dropdownMenu.appendChild(editBtn);
        dropdownMenu.appendChild(deleteBtn);
        dropdownToggle.appendChild(dropdownMenu);
        msgDiv.appendChild(dropdownToggle);
      }

      container.appendChild(msgDiv);
    });

    // Прокрутка к последнему сообщению
    container.scrollTop = container.scrollHeight;
  });
}

// Переключение видимости выпадающего меню
function toggleDropdown(toggleElem) {
  const menu = toggleElem.querySelector(".dropdown-menu");
  // Закрываем все открытые меню перед открытием нового
  document.querySelectorAll(".dropdown-menu").forEach(m => {
    if (m !== menu) m.style.display = "none";
  });
  menu.style.display = (menu.style.display === "block") ? "none" : "block";
}

// Функция удаления сообщения
async function deleteMessage(messageId) {
  if (!confirm("Удалить сообщение?")) return;
  
  try {
    const response = await fetch(`${API_URL}/messages/${messageId}`, {
      method: "DELETE",
      headers: { 
        "Authorization": `Bearer ${token}`
      }
    });
    if (response.ok) {
      fetchMessages();
    } else {
      const errorData = await response.json();
      alert("Ошибка: " + errorData.detail);
    }
  } catch (err) {
    console.error(err);
    alert("Ошибка соединения с сервером");
  }
}

// Открытие модального окна редактирования сообщения
function openEditModal(msg) {
  messageBeingEdited = msg;
  const modal = document.getElementById("editMessageModal");
  document.getElementById("editMessageInput").value = msg.content;
  modal.style.display = "flex";
  // Закрываем dropdown
  document.querySelectorAll(".dropdown-menu").forEach(m => m.style.display = "none");
}

// Отправка изменений редактирования
async function submitEdit() {
  const newContent = document.getElementById("editMessageInput").value.trim();
  if (!newContent) return;
  
  try {
    const response = await fetch(`${API_URL}/messages/${messageBeingEdited.id}`, {
      method: "PUT",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ content: newContent })
    });
    if (response.ok) {
      closeModal("editMessageModal");
      fetchMessages();
    } else {
      const errorData = await response.json();
      alert("Ошибка: " + errorData.detail);
    }
  } catch (err) {
    console.error(err);
    alert("Ошибка соединения с сервером");
  }
}

// Функция открытия модального окна настроек приложения
function openAppSettings() {
  document.getElementById("appSettingsModal").style.display = "flex";
}

async function openChatParticipants() {
  try {
    // Fetch participants from the API
    const response = await fetch(`${API_URL}/groups/${currentGroupId}/users`, {
      headers: { 
        "Authorization": `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error("Failed to fetch participants");
    }

    const participants = await response.json();
    const participantsList = document.getElementById("participantsList");
    participantsList.innerHTML = "";

    // Create and append participant elements
    participants.forEach(user => {
      const participantDiv = document.createElement("div");
      participantDiv.classList.add("participant-item");
      
      participantDiv.innerHTML = `
        <div class="participant-avatar">${user.username.charAt(0)}</div>
        <div class="participant-name">
          ${user.username}
          ${user.id === currentUserId ? ' (Вы)' : ''}
        </div>
      `;
      
      participantsList.appendChild(participantDiv);
    });

    // Add CSS styles if not already present
    if (!document.querySelector('#participantStyles')) {
      const style = document.createElement('style');
      style.id = 'participantStyles';
      style.textContent = `
        .participant-item {
          display: flex;
          align-items: center;
          padding: 10px;
          border-bottom: 1px solid #eee;
        }
        .participant-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background-color: #075E54;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-right: 10px;
          font-weight: bold;
        }
        .participant-name {
          font-size: 16px;
        }
      `;
      document.head.appendChild(style);
    }

    document.getElementById("chatParticipantsModal").style.display = "flex";
  } catch (err) {
    console.error("Error fetching participants:", err);
    alert("Ошибка при загрузке списка участников");
  }
}

// Закрытие модального окна
function closeModal(modalId) {
  document.getElementById(modalId).style.display = "none";
}

// Функция создания личного чата
function createPrivateChat() {
  // Загружаем и отображаем список пользователей
  fetchUsers().then(() => {
    const usersList = document.getElementById("usersList");
    usersList.innerHTML = "";
    
    users.forEach(user => {
      if (user.id != currentUserId) { // Не показываем текущего пользователя
        const userItem = document.createElement("div");
        userItem.classList.add("user-item");
        userItem.innerHTML = `
          <div class="user-avatar">${user.username ? user.username.charAt(0) : 'U'}</div>
          <div class="user-name">${user.username || 'User ' + user.id}</div>
        `;
        userItem.addEventListener("click", () => createChat(user.id));
        usersList.appendChild(userItem);
      }
    });
    
    document.getElementById("userSelectionModal").style.display = "flex";
  });
}

// Функция создания персонального чата
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
      loadChats(); // Обновляем список чатов
      switchToChat(newChat.id); // Переключаемся на новый чат
    } else {
      const errorData = await response.json();
      alert("Ошибка: " + errorData.detail);
    }
  } catch (err) {
    console.error(err);
    alert("Ошибка соединения с сервером");
  }
}

// Функция создания группы
function createGroup() {
  // Сбрасываем предыдущий выбор
  selectedGroupUsers = [];
  document.getElementById("groupNameInput").value = "";
  
  // Загружаем и отображаем список пользователей
  fetchUsers().then(() => {
    const usersList = document.getElementById("groupUsersList");
    usersList.innerHTML = "";
    
    users.forEach(user => {
      if (user.id != currentUserId) { // Не показываем текущего пользователя
        const userItem = document.createElement("div");
        userItem.classList.add("user-item");
        userItem.innerHTML = `
          <div class="user-avatar">${user.username ? user.username.charAt(0) : 'U'}</div>
          <div class="user-name">${user.username || 'User ' + user.id}</div>
          <input type="checkbox" class="user-checkbox" data-user-id="${user.id}">
        `;
        
        const checkbox = userItem.querySelector(".user-checkbox");
        checkbox.addEventListener("change", (e) => {
          if (e.target.checked) {
            selectedGroupUsers.push(user.id);
            userItem.classList.add("selected");
          } else {
            selectedGroupUsers = selectedGroupUsers.filter(id => id !== user.id);
            userItem.classList.remove("selected");
          }
        });
        
        usersList.appendChild(userItem);
      }
    });
    
    document.getElementById("createGroupModal").style.display = "flex";
  });
}

// Подтверждение создания группы
async function submitGroupCreation() {
  const groupName = document.getElementById("groupNameInput").value.trim();
  
  if (!groupName) {
    alert("Введите название группы");
    return;
  }
  
  if (selectedGroupUsers.length === 0) {
    alert("Выберите хотя бы одного участника");
    return;
  }
  
  try {
    // Create the group first
    const response = await fetch(`${API_URL}/groups`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ 
        name: groupName,
        background: "#E5DDD5" // Default background
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error("Ошибка: " + errorData.detail);
    }
    
    const newGroup = await response.json();
    
    // Now add all selected users to the group
    for (const userId of selectedGroupUsers) {
      await fetch(`${API_URL}/groups/${newGroup.id}/add_user?user_id=${userId}`, {
        method: "POST",
        headers: { 
          "Authorization": `Bearer ${token}`
        }
      });
    }
    
    // Add the current user to the group as well
    await fetch(`${API_URL}/groups/${newGroup.id}/add_user?user_id=${currentUserId}`, {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${token}`
      }
    });
    
    closeModal("createGroupModal");
    await loadChats(); // Reload chats
    switchToChat(newGroup.id); // Switch to new group
    
  } catch (err) {
    console.error(err);
    alert("Ошибка при создании группы: " + err.message);
  }
}

// Функция загрузки пользователей из API
async function fetchUsers() {
  try {
    const response = await fetch(`${API_URL}/users`, {
      headers: { 
        "Authorization": `Bearer ${token}`
      }
    });
    if (response.ok) {
      users = await response.json();
      console.log("Loaded users:", users);
    } else {
      console.error("Ошибка при загрузке пользователей:", response.status);
      // Fallback to mock data if API fails
      users = [
        { id: 1, username: "Текущий пользователь" },
        { id: 2, username: "Пользователь 2" },
        { id: 3, username: "Пользователь 3" }
      ];
    }
  } catch (err) {
    console.error("Ошибка при загрузке пользователей:", err);
    users = []; 
  }
}

// Функция загрузки списка чатов и групп
// Update loadChats function
async function loadChats() {
  try {
    const response = await fetch(`${API_URL}/chats?user_id=${currentUserId}`, {
      headers: { 
        "Authorization": `Bearer ${token}`
      }
    });
    if (response.ok) {
      chats = await response.json();
      renderChatsList();
      
      // If we have chats but none is selected, select the first one
      if (chats.length > 0 && (!currentGroupId || !chats.find(c => c.id === currentGroupId))) {
        switchToChat(chats[0].id, chats[0].type === "group");
      }
    } else {
      console.error("Ошибка при загрузке списка чатов:", response.status);
      chats = []; // Empty chats on error
    }
  } catch (err) {
    console.error("Ошибка при загрузке чатов:", err);
    chats = [];
  }
}

// Отображение списка чатов в левой панели
function renderChatsList() {
  const sidebar = document.querySelector(".sidebar");
  
  // Сохраняем элементы для создания чата и группы
  const createChatBtn = document.querySelector(".sidebar .user");
  const createGroupBtn = document.querySelector(".sidebar .group");
  const settingsBtn = document.querySelector(".sidebar .settings");
  
  // Очищаем панель
  sidebar.innerHTML = "";
  
  // Добавляем обратно кнопки для создания
  sidebar.appendChild(createChatBtn);
  sidebar.appendChild(createGroupBtn);
  
  // Добавляем разделитель
  const divider = document.createElement("div");
  divider.style.borderBottom = "1px solid #ccc";
  divider.style.margin = "10px 0";
  sidebar.appendChild(divider);
  
  // Добавляем заголовок для списка чатов
  const chatsHeader = document.createElement("h4");
  chatsHeader.textContent = "Ваши чаты";
  chatsHeader.style.padding = "5px 10px";
  sidebar.appendChild(chatsHeader);
  
  // Создаём контейнер для списка чатов
  const chatList = document.createElement("div");
  chatList.classList.add("chat-list");
  
  // Добавляем чаты в список
  chats.forEach(chat => {
    const chatItem = document.createElement("div");
    chatItem.classList.add("chat-item");
    if (chat.id === currentGroupId) chatItem.classList.add("active");
    
    chatItem.innerHTML = `
      <div class="user-avatar">${chat.name.charAt(0)}</div>
      <div class="user-name">${chat.name}</div>
    `;
    
    chatItem.addEventListener("click", () => {
      switchToChat(chat.id, chat.type === "group");
      // Обновляем активный класс
      document.querySelectorAll(".chat-item").forEach(item => item.classList.remove("active"));
      chatItem.classList.add("active");
    });
    
    chatList.appendChild(chatItem);
  });
  
  sidebar.appendChild(chatList);
  sidebar.appendChild(settingsBtn);
}

// Функция переключения чата
function switchToChat(chatId, isGroup = false) {
  currentGroupId = chatId;
  const chat = chats.find(c => c.id === chatId);
  
  if (chat) {
    document.getElementById("chatTitle").textContent = chat.name;
    fetchMessages();
  }
}

// Модифицированная функция получения сообщений для работы с чатами и группами
async function fetchMessages() {
  try {
    const response = await fetch(`${API_URL}/messages?group_id=${currentGroupId}`, {
      headers: { 
        "Authorization": `Bearer ${token}`
      }
    });
    if (response.ok) {
      const messages = await response.json();
      displayMessages(messages);
    } else {
      console.error("Ошибка при загрузке сообщений");
    }
  } catch (err) {
    console.error(err);
  }
}


// Загружаем сообщения при открытии страницы
loadChats();
fetchMessages();

// Периодическое обновление сообщений
setInterval(fetchMessages, 5000);
