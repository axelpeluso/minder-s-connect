/**
 * Bella — Bellezza Miami chat widget.
 *
 * Drop into any page:
 *   <script src="bella.js" data-api="https://your-backend.example"></script>
 * Or set window.BELLA_API_URL before loading.
 */
(function () {
  "use strict";

  const SCRIPT = document.currentScript;
  const API_URL =
    window.BELLA_API_URL ||
    (SCRIPT && SCRIPT.dataset.api) ||
    "http://127.0.0.1:8765";
  // Conversation id lives in memory only — refreshing the page starts fresh.
  let conversationId = null;

  const CSS = `
    #bella-root, #bella-root * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
    #bella-bubble {
      position: fixed; right: 24px; bottom: 24px; z-index: 2147483640;
      width: 60px; height: 60px; border: none; border-radius: 50%;
      background: linear-gradient(135deg, #ff6f9c 0%, #e84b6b 100%);
      color: #fff; font-size: 28px; cursor: pointer;
      box-shadow: 0 12px 32px rgba(232, 75, 107, 0.35);
      transition: transform .15s ease, box-shadow .15s ease;
    }
    #bella-bubble:hover { transform: translateY(-2px); box-shadow: 0 16px 40px rgba(232, 75, 107, 0.45); }
    #bella-bubble:active { transform: translateY(0); }

    #bella-panel {
      position: fixed; right: 24px; bottom: 96px; z-index: 2147483641;
      width: 380px; height: 560px; max-height: calc(100vh - 120px);
      background: #fffaf8; border-radius: 18px; overflow: hidden;
      box-shadow: 0 24px 60px rgba(40, 10, 30, 0.22), 0 4px 12px rgba(40, 10, 30, 0.08);
      display: flex; flex-direction: column;
      animation: bella-rise .2s ease-out;
    }
    @keyframes bella-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }

    #bella-header {
      background: linear-gradient(135deg, #ff6f9c 0%, #e84b6b 100%);
      color: #fff; padding: 16px 18px; display: flex; align-items: center; justify-content: space-between;
    }
    #bella-header .title { display: flex; align-items: center; gap: 10px; }
    #bella-header .avatar {
      width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,.22);
      display: grid; place-items: center; font-size: 18px;
    }
    #bella-header .name { font-weight: 600; font-size: 15px; line-height: 1.1; }
    #bella-header .sub { font-size: 12px; opacity: .82; }
    #bella-close {
      background: transparent; border: none; color: #fff; font-size: 22px;
      cursor: pointer; padding: 4px 8px; border-radius: 6px; line-height: 1;
    }
    #bella-close:hover { background: rgba(255,255,255,.15); }

    #bella-messages {
      flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px;
      background: #fffaf8;
    }
    .bella-msg {
      max-width: 82%; padding: 10px 14px; border-radius: 16px; font-size: 14px;
      line-height: 1.45; white-space: pre-wrap; word-wrap: break-word;
    }
    .bella-msg.assistant { background: #fff; color: #2a1a1f; border: 1px solid #f1e0e6; align-self: flex-start; border-bottom-left-radius: 4px; }
    .bella-msg.user      { background: #e84b6b; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
    .bella-msg.welcome   { background: transparent; color: #7a6b72; font-size: 13px; align-self: center; text-align: center; max-width: 100%; padding: 6px 12px; }

    #bella-typing {
      align-self: flex-start; display: inline-flex; gap: 4px; padding: 10px 14px;
      background: #fff; border: 1px solid #f1e0e6; border-radius: 16px; border-bottom-left-radius: 4px;
    }
    #bella-typing span {
      width: 6px; height: 6px; border-radius: 50%; background: #c79aae;
      animation: bella-bounce 1.2s infinite ease-in-out;
    }
    #bella-typing span:nth-child(2) { animation-delay: .15s; }
    #bella-typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes bella-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: .5; } 40% { transform: translateY(-4px); opacity: 1; } }

    #bella-form {
      display: flex; gap: 6px; padding: 10px; border-top: 1px solid #f1e0e6; background: #fff; align-items: center;
    }
    #bella-input {
      flex: 1; border: 1px solid #f1e0e6; border-radius: 22px; padding: 10px 14px;
      font-size: 14px; outline: none; background: #fffaf8; color: #2a1a1f; min-width: 0;
    }
    #bella-input:focus { border-color: #e84b6b; }
    #bella-send, #bella-mic, #bella-image {
      width: 40px; height: 40px; border: 1px solid #f1e0e6; border-radius: 50%;
      background: #fff; color: #7a6b72; font-size: 16px; cursor: pointer;
      display: grid; place-items: center; flex-shrink: 0;
      transition: background .12s, color .12s, transform .08s;
    }
    #bella-send {
      background: #e84b6b; color: #fff; border-color: #e84b6b; font-size: 18px;
    }
    #bella-mic:hover, #bella-image:hover { background: #fff0f3; color: #e84b6b; }
    #bella-mic:active, #bella-image:active, #bella-send:active { transform: scale(0.95); }
    #bella-send:disabled { opacity: .4; cursor: not-allowed; }
    #bella-mic.recording {
      background: #e84b6b; color: #fff; border-color: #e84b6b;
      animation: bella-pulse 1s infinite ease-in-out;
    }
    @keyframes bella-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
    #bella-file { display: none; }

    .bella-attach-preview {
      align-self: flex-end; max-width: 82%; display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 10px; background: #fff0f3; border: 1px dashed #e84b6b; border-radius: 12px;
      color: #e84b6b; font-size: 12px;
    }
    .bella-attach-preview img { width: 36px; height: 36px; object-fit: cover; border-radius: 6px; }
    .bella-attach-preview button {
      background: transparent; border: none; color: #e84b6b; cursor: pointer; font-size: 16px; line-height: 1;
    }

    .bella-msg.media { padding: 6px; max-width: 240px; }
    .bella-msg.media img { display: block; max-width: 100%; border-radius: 10px; }
    .bella-msg.media audio { display: block; width: 100%; }

    #bella-link {
      align-self: flex-start; background: #fff; border: 1px solid #e84b6b; border-radius: 14px;
      padding: 8px 14px; color: #e84b6b; font-size: 13px; font-weight: 600; text-decoration: none;
    }
    #bella-link:hover { background: #e84b6b; color: #fff; }

    @media (max-width: 480px) {
      #bella-panel { right: 0; bottom: 0; width: 100vw; height: 100vh; max-height: 100vh; border-radius: 0; }
      #bella-bubble { right: 16px; bottom: 16px; }
    }
  `;

  const HTML = `
    <button id="bella-bubble" aria-label="Chat with Bella">💅</button>
    <div id="bella-panel" hidden>
      <div id="bella-header">
        <div class="title">
          <div class="avatar">💅</div>
          <div>
            <div class="name">Bella</div>
            <div class="sub">Bellezza Miami</div>
          </div>
        </div>
        <button id="bella-close" aria-label="Close chat">×</button>
      </div>
      <div id="bella-messages" role="log" aria-live="polite"></div>
      <div id="bella-attach-slot"></div>
      <form id="bella-form">
        <button id="bella-image" type="button" aria-label="Attach image" title="Attach image">📎</button>
        <button id="bella-mic" type="button" aria-label="Hold to record voice note" title="Hold to record">🎙</button>
        <input id="bella-input" type="text" autocomplete="off"
               placeholder="Pregúntame algo / ask me anything…" maxlength="2000" />
        <input id="bella-file" type="file" accept="image/*" />
        <button id="bella-send" type="submit" aria-label="Send">↑</button>
      </form>
    </div>
  `;

  // ---------- Boot ----------

  function boot() {
    if (document.getElementById("bella-root")) return;

    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement("div");
    root.id = "bella-root";
    root.innerHTML = HTML;
    document.body.appendChild(root);

    const $ = (id) => document.getElementById(id);
    const panel = $("bella-panel");
    const messages = $("bella-messages");
    const attachSlot = $("bella-attach-slot");
    const form = $("bella-form");
    const input = $("bella-input");
    const send = $("bella-send");
    const micBtn = $("bella-mic");
    const imageBtn = $("bella-image");
    const fileInput = $("bella-file");

    let opened = false;
    let typingEl = null;
    let currentBubble = null;
    let inflight = false;
    let pendingImageUrl = null;
    let mediaRecorder = null;
    let recordedChunks = [];

    function open() {
      panel.hidden = false;
      input.focus();
      if (!opened) {
        opened = true;
        addWelcome();
      }
    }
    function close() { panel.hidden = true; }

    $("bella-bubble").addEventListener("click", open);
    $("bella-close").addEventListener("click", close);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (inflight) return;
      const text = input.value.trim();
      const imageUrl = pendingImageUrl;
      if (!text && !imageUrl) return;
      input.value = "";
      pendingImageUrl = null;
      attachSlot.innerHTML = "";
      if (imageUrl) addMediaBubble("user", "image", imageUrl);
      if (text) addBubble("user", text);
      await streamReply(text, imageUrl);
    });

    // ---------- Image upload ----------
    imageBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      fileInput.value = "";
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        addBubble("assistant", "That doesn't look like an image — try again?");
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      showAttachPreview(objectUrl);
      const fd = new FormData();
      fd.append("image", file);
      try {
        const res = await fetch(`${API_URL}/image/analyze`, { method: "POST", body: fd });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.image_url) {
          pendingImageUrl = json.image_url;
          input.focus();
        } else {
          attachSlot.innerHTML = "";
          addBubble("assistant", "No pude subir esa imagen. ¿Probamos otra?");
        }
      } catch (err) {
        attachSlot.innerHTML = "";
        addBubble("assistant", "No pude subir esa imagen. ¿Probamos otra?");
      }
    });

    function showAttachPreview(objectUrl) {
      attachSlot.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.className = "bella-attach-preview";
      const img = document.createElement("img");
      img.src = objectUrl;
      const label = document.createElement("span");
      label.textContent = "image attached";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "×";
      cancel.setAttribute("aria-label", "Remove attachment");
      cancel.addEventListener("click", () => { pendingImageUrl = null; attachSlot.innerHTML = ""; });
      wrap.append(img, label, cancel);
      attachSlot.appendChild(wrap);
    }

    // ---------- Voice notes ----------
    async function startRecording() {
      if (mediaRecorder && mediaRecorder.state === "recording") return;
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        addBubble("assistant", "Tu navegador no soporta grabación de voz.");
        return;
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        addBubble("assistant", "No pude acceder al micrófono — revisa los permisos.");
        return;
      }
      recordedChunks = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorder.addEventListener("dataavailable", (e) => {
        if (e.data && e.data.size > 0) recordedChunks.push(e.data);
      });
      mediaRecorder.addEventListener("stop", async () => {
        stream.getTracks().forEach((t) => t.stop());
        micBtn.classList.remove("recording");
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        if (blob.size === 0) return;
        const audioUrl = URL.createObjectURL(blob);
        addMediaBubble("user", "audio", audioUrl);
        await transcribeAndFill(blob);
      });
      mediaRecorder.start();
      micBtn.classList.add("recording");
    }

    function stopRecording() {
      if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
    }

    micBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); startRecording(); });
    micBtn.addEventListener("pointerup", stopRecording);
    micBtn.addEventListener("pointerleave", stopRecording);
    micBtn.addEventListener("pointercancel", stopRecording);

    async function transcribeAndFill(blob) {
      const fd = new FormData();
      const ext = (blob.type.split("/")[1] || "webm").split(";")[0];
      fd.append("audio", blob, `recording.${ext}`);
      try {
        const res = await fetch(`${API_URL}/audio/transcribe`, { method: "POST", body: fd });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.text) {
          input.value = json.text;
          input.focus();
        }
      } catch (err) {
        addBubble("assistant", "No pude transcribir el audio.");
      }
    }

    function addMediaBubble(role, kind, url) {
      const div = document.createElement("div");
      div.className = `bella-msg ${role} media`;
      const el = document.createElement(kind === "audio" ? "audio" : "img");
      el.src = url;
      if (kind === "audio") el.controls = true;
      div.appendChild(el);
      messages.appendChild(div);
      scrollDown();
      return div;
    }

    function addBubble(role, text) {
      const div = document.createElement("div");
      div.className = `bella-msg ${role}`;
      div.textContent = text;
      messages.appendChild(div);
      scrollDown();
      return div;
    }

    function addWelcome() {
      const div = document.createElement("div");
      div.className = "bella-msg welcome";
      div.textContent = "Soy Bella, te ayudo a encontrar tus uñas perfectas — I'm Bella, here to help you find the right nails 💅";
      messages.appendChild(div);
      scrollDown();
    }

    function showTyping() {
      if (typingEl) return;
      typingEl = document.createElement("div");
      typingEl.id = "bella-typing";
      typingEl.innerHTML = "<span></span><span></span><span></span>";
      messages.appendChild(typingEl);
      scrollDown();
    }
    function hideTyping() {
      if (typingEl) { typingEl.remove(); typingEl = null; }
    }

    function addLinkButton(url) {
      const a = document.createElement("a");
      a.id = "bella-link";
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Open checkout →";
      messages.appendChild(a);
      scrollDown();
    }

    function scrollDown() { messages.scrollTop = messages.scrollHeight; }

    async function streamReply(text, imageUrl) {
      const convId = conversationId;
      inflight = true;
      send.disabled = true;
      currentBubble = null;
      showTyping();

      const body = {
        conversation_id: convId,
        message: text || "",
        entry_page: window.location.pathname,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
      };
      if (imageUrl) body.image_url = imageUrl;

      let res;
      try {
        res = await fetch(`${API_URL}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        hideTyping();
        addBubble("assistant", "No pude conectar con el servidor. ¿Probamos otra vez?");
        inflight = false; send.disabled = false;
        return;
      }

      if (!res.ok || !res.body) {
        hideTyping();
        addBubble("assistant", `Algo salió mal (HTTP ${res.status}). ¿Probamos otra vez?`);
        inflight = false; send.disabled = false;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const chunks = buf.split("\n\n");
          buf = chunks.pop() || "";
          for (const chunk of chunks) handleSseChunk(chunk);
        }
      } catch (err) {
        // stream broken
      }

      hideTyping();
      inflight = false;
      send.disabled = false;
      input.focus();
    }

    function handleSseChunk(chunk) {
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) return;
      let data;
      try { data = JSON.parse(dataLine.slice(6)); } catch { return; }

      switch (data.type) {
        case "conversation":
          if (data.conversation_id) conversationId = data.conversation_id;
          break;
        case "tool_call_start":
          // Claude is calling a tool — keep typing indicator visible
          showTyping();
          break;
        case "tool_result":
          if (data.name === "send_checkout_link" && data.result && data.result.url) {
            addLinkButton(data.result.url);
          }
          if (data.name === "handoff_to_agent") {
            addBubble("assistant", "Te conecté con nuestro equipo — alguien te escribirá pronto.");
          }
          break;
        case "text_delta":
          hideTyping();
          if (!currentBubble) currentBubble = addBubble("assistant", "");
          currentBubble.textContent += data.text || "";
          scrollDown();
          break;
        case "done":
          hideTyping();
          currentBubble = null;
          break;
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
