const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const feedback = document.getElementById("feedback");

const loginForm = document.getElementById("login-form");
const routingForm = document.getElementById("routing-form");
const welcomeForm = document.getElementById("welcome-form");
const promptForm = document.getElementById("prompt-form");
const staffForm = document.getElementById("staff-form");

const initialQueueSelect = document.getElementById("initial-queue-id");
const aiQueueSelect = document.getElementById("ai-queue-id");
const humanQueueSelect = document.getElementById("human-queue-id");
const welcomeContent = document.getElementById("welcome-content");
const promptMeta = document.getElementById("prompt-meta");
const promptContent = document.getElementById("prompt-content");
const staffList = document.getElementById("staff-list");
const staffNumberInput = document.getElementById("staff-number");

const refreshRoutingButton = document.getElementById("refresh-routing-button");
const refreshWelcomeButton = document.getElementById("refresh-welcome-button");
const refreshPromptButton = document.getElementById("refresh-prompt-button");
const refreshStaffButton = document.getElementById("refresh-staff-button");
const logoutButton = document.getElementById("logout-button");

let availableQueues = [];

function showFeedback(message, isError = false) {
  feedback.textContent = message;
  feedback.classList.remove("hidden");
  feedback.style.background = isError ? "#9f2d2d" : "#1d1b18";

  window.clearTimeout(showFeedback.timeoutId);
  showFeedback.timeoutId = window.setTimeout(() => {
    feedback.classList.add("hidden");
  }, 3200);
}

async function request(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };

  if (options.body !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, {
    credentials: "same-origin",
    headers,
    ...options,
  });

  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const message =
      payload?.message || payload?.error || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function setAuthenticatedView(authenticated) {
  loginView.classList.toggle("hidden", authenticated);
  appView.classList.toggle("hidden", !authenticated);
}

async function loadDashboardData() {
  const results = await Promise.allSettled([
    loadQueuesAndRoutingConfig(),
    loadWelcomeMessage(),
    loadPrompt(),
    loadStaffContacts(),
  ]);

  const firstRejected = results.find((result) => result.status === "rejected");

  if (firstRejected && firstRejected.reason instanceof Error) {
    showFeedback(firstRejected.reason.message, true);
  }
}

async function loadSession() {
  const data = await request("/admin-ui/api/session", {
    headers: {},
  });

  setAuthenticatedView(Boolean(data.authenticated));

  if (data.authenticated) {
    await loadDashboardData();
  }
}

function renderQueueOptions(selectElement, selectedValue) {
  selectElement.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "Não configurado";
  selectElement.appendChild(emptyOption);

  for (const queue of availableQueues) {
    const option = document.createElement("option");
    option.value = String(queue.id);
    option.textContent = `${queue.id} - ${queue.name}`;
    selectElement.appendChild(option);
  }

  selectElement.value =
    selectedValue && Number.isFinite(Number(selectedValue))
      ? String(selectedValue)
      : "";
}

async function loadQueuesAndRoutingConfig() {
  const [queues, config] = await Promise.all([
    request("/admin-ui/api/queues"),
    request("/admin-ui/api/mtalk-routing-config"),
  ]);

  availableQueues = Array.isArray(queues) ? queues : [];

  renderQueueOptions(initialQueueSelect, config.initialQueueId);
  renderQueueOptions(aiQueueSelect, config.aiQueueId);
  renderQueueOptions(humanQueueSelect, config.humanQueueId);
}

async function loadPrompt() {
  const prompt = await request("/admin-ui/api/prompt");
  promptMeta.textContent = `Chave: ${prompt.key} | versão: ${prompt.version} | criado em: ${new Date(prompt.createdAt).toLocaleString("pt-BR")}`;
  promptContent.value = prompt.content;
}

async function loadWelcomeMessage() {
  const welcomeMessage = await request("/admin-ui/api/welcome-message");
  welcomeContent.value = welcomeMessage.content;
}

function renderStaffContacts(contacts) {
  staffList.innerHTML = "";

  if (!contacts.length) {
    const item = document.createElement("li");
    item.className = "list-item";
    item.innerHTML = "<span class=\"muted\">Nenhum telefone cadastrado.</span>";
    staffList.appendChild(item);
    return;
  }

  for (const number of contacts) {
    const item = document.createElement("li");
    item.className = "list-item";

    const label = document.createElement("code");
    label.textContent = number;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "danger";
    removeButton.textContent = "Remover";
    removeButton.addEventListener("click", async () => {
      try {
        await request(`/admin-ui/api/staff-contacts/${encodeURIComponent(number)}`, {
          method: "DELETE",
        });
        await loadStaffContacts();
        showFeedback("Telefone removido.");
      } catch (error) {
        showFeedback(error.message, true);
      }
    });

    item.appendChild(label);
    item.appendChild(removeButton);
    staffList.appendChild(item);
  }
}

async function loadStaffContacts() {
  const contacts = await request("/admin-ui/api/staff-contacts");
  renderStaffContacts(Array.isArray(contacts) ? contacts : []);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(loginForm);
  const username = String(formData.get("username") || "");
  const password = String(formData.get("password") || "");

  try {
    await request("/admin-ui/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    setAuthenticatedView(true);
    await loadDashboardData();
    showFeedback("Login realizado.");
  } catch (error) {
    showFeedback(error.message, true);
  }
});

routingForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const toNullableNumber = (value) => {
    const normalizedValue = String(value || "").trim();

    if (!normalizedValue) {
      return null;
    }

    const parsedValue = Number(normalizedValue);
    return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
  };

  try {
    await request("/admin-ui/api/mtalk-routing-config", {
      method: "PUT",
      body: JSON.stringify({
        initialQueueId: toNullableNumber(initialQueueSelect.value),
        aiQueueId: toNullableNumber(aiQueueSelect.value),
        humanQueueId: toNullableNumber(humanQueueSelect.value),
      }),
    });
    await loadQueuesAndRoutingConfig();
    showFeedback("Roteamento salvo.");
  } catch (error) {
    showFeedback(error.message, true);
  }
});

welcomeForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await request("/admin-ui/api/welcome-message", {
      method: "PUT",
      body: JSON.stringify({ content: welcomeContent.value }),
    });
    await loadWelcomeMessage();
    showFeedback("Mensagem de apresentação atualizada.");
  } catch (error) {
    showFeedback(error.message, true);
  }
});

promptForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await request("/admin-ui/api/prompt", {
      method: "PUT",
      body: JSON.stringify({ content: promptContent.value }),
    });
    await loadPrompt();
    showFeedback("Prompt atualizado.");
  } catch (error) {
    showFeedback(error.message, true);
  }
});

staffForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await request("/admin-ui/api/staff-contacts", {
      method: "POST",
      body: JSON.stringify({ number: staffNumberInput.value }),
    });
    staffNumberInput.value = "";
    await loadStaffContacts();
    showFeedback("Telefone adicionado.");
  } catch (error) {
    showFeedback(error.message, true);
  }
});

refreshRoutingButton.addEventListener("click", async () => {
  try {
    await loadQueuesAndRoutingConfig();
    showFeedback("Filas recarregadas.");
  } catch (error) {
    showFeedback(error.message, true);
  }
});

refreshWelcomeButton.addEventListener("click", async () => {
  try {
    await loadWelcomeMessage();
    showFeedback("Mensagem de apresentação recarregada.");
  } catch (error) {
    showFeedback(error.message, true);
  }
});

refreshPromptButton.addEventListener("click", async () => {
  try {
    await loadPrompt();
    showFeedback("Prompt recarregado.");
  } catch (error) {
    showFeedback(error.message, true);
  }
});

refreshStaffButton.addEventListener("click", async () => {
  try {
    await loadStaffContacts();
    showFeedback("Whitelist recarregada.");
  } catch (error) {
    showFeedback(error.message, true);
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await request("/admin-ui/api/logout", {
      method: "POST",
    });
    setAuthenticatedView(false);
    showFeedback("Sessão encerrada.");
  } catch (error) {
    showFeedback(error.message, true);
  }
});

loadSession().catch((error) => {
  console.error(error);
  setAuthenticatedView(false);
});
