// login.js
const API_URL = "http://127.0.0.1:8000";

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  
  try {
    const response = await fetch(`${API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      // Сохраняем токен и user_id в localStorage
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("user_id", data.user_id);
      alert("Вход выполнен успешно!");
      window.location.href = "chat.html";
    } else {
      alert("Ошибка: " + data.detail);
    }
  } catch (err) {
    console.error(err);
    alert("Ошибка соединения с сервером");
  }
});
