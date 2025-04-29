/* ========= CONFIG ========= */
// IMPORTANT SECURITY WARNING: Exposed API Key! Move server-side for production.
console.log("Script.js loaded!");

// Replace with your actual API key or move server-side
const OPENAI_API_KEY = "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"; // Replace or remove if implementing server-side logic
const OPENAI_MODEL = "gpt-4.1-mini"; // Or your preferred model
const phoneIds = [1, 2, 3, 4];

// *** Assign names to phone IDs ***
const phoneNames = {
    1: "Alex",
    2: "Ben",
    3: "Charlie",
    4: "Dana"
};

// Typing Indicator Timeout Logic
const typingTimers = {}; // Stores active timers { senderId: timerId }
const TYPING_TIMEOUT_DURATION = 1500; // ms (1.5 seconds)

/* ====== Helpers ===== */
const lang_names = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', zh: 'Chinese', jp: 'Japanese' };
const translationCache = new Map(); // key: src|tgt|msg

// Regex patterns (more robust versions)
const emailRegex = /[\w\-\.]+@([\w\-]+\.)+[\w\-]{2,4}/g; // Find emails
const urlRegex = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)/g; // Find URLs

function scramble(span, target) {
  const R = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  if (span._scr) clearInterval(span._scr);
  span._scr = null;
  const max = Math.max(span.textContent.length, target.length);
  let f = 0, frames = 18;
  span._scr = setInterval(() => {
    let out = '';
    for (let i = 0; i < max; i++) {
      const t = target[i] || '';
      if (t === ' ' || t === '\n') { out += t; continue; }
      out += i < (f / frames) * max ? t : R[Math.random() * R.length | 0];
    }
    span.textContent = out;
    if (++f > frames) {
      clearInterval(span._scr);
      span.textContent = target;
      span._scr = null;
    }
  }, 16);
}

/* ====== Typing indicators ===== */
const typing_state = Object.fromEntries(phoneIds.map(id => [id, false]));

function show_typing(sender) {
  let didShow = false;
  const senderName = phoneNames[sender] || `User ${sender}`;
  phoneIds.forEach(recv => {
    if (recv === sender) return;
    const id = `typing_${sender}_to_${recv}`;
    if (document.getElementById(id)) return;
    const area = document.getElementById(`msgs_${recv}`);
    if (!area) return;
    let lastMessageBubble = area.lastElementChild;
    while(lastMessageBubble && lastMessageBubble.classList.contains('typing')) {
        lastMessageBubble = lastMessageBubble.previousElementSibling;
    }
    const lastMessageSenderId = lastMessageBubble ? lastMessageBubble.dataset.senderId : null;
    let showTypingName = !lastMessageBubble || String(sender) !== lastMessageSenderId;
    const b = document.createElement('div');
    b.className = 'bubble incoming typing';
    b.id = id;
    if (showTypingName) {
        const nameDiv = document.createElement('div');
        nameDiv.className = 'sender_name typing_name';
        nameDiv.textContent = `${senderName} is typing`;
        b.appendChild(nameDiv);
    }
    const dots = document.createElement('div');
    dots.className = 'typing_indicator';
    dots.innerHTML = '<span></span><span></span><span></span>';
    b.appendChild(dots);
    area.appendChild(b);
    area.scrollTop = area.scrollHeight;
    didShow = true;
  });
  if (didShow || !typing_state[sender]) {
      typing_state[sender] = true;
  }
}

function hide_typing(sender, immediate = false) {
    clearTimeout(typingTimers[sender]);
    delete typingTimers[sender];
    if (!typing_state[sender]) return;
    typing_state[sender] = false;
    phoneIds.forEach(recv => {
        if (recv === sender) return;
        const el = document.getElementById(`typing_${sender}_to_${recv}`);
        if (el) {
            if (immediate || el.classList.contains('hiding')) {
                 if (el.parentNode) el.remove();
            } else {
                el.classList.add('hiding');
                el.addEventListener('animationend', () => {
                    if (el.parentNode) el.remove();
                }, { once: true });
            }
        }
    });
}

function update_typing(sender, val) {
  clearTimeout(typingTimers[sender]);
  if (val) {
    if (!typing_state[sender]) {
      show_typing(sender);
    }
    typingTimers[sender] = setTimeout(() => {
        hide_typing(sender, false);
    }, TYPING_TIMEOUT_DURATION);
  } else {
    hide_typing(sender, true);
  }
}

/* ====== Queues per sender ===== */
const queues = Object.fromEntries(phoneIds.map(id => [id, []]));
const processing = Object.fromEntries(phoneIds.map(id => [id, false]));

async function queueMsg(sender, text) {
  if (!text) return;
  hide_typing(sender, true);
  const inputElement = document.getElementById(`input_${sender}`);
  if (inputElement) inputElement.value = '';
  const senderName = phoneNames[sender] || `User ${sender}`;
  appendBubble(sender, sender, senderName, text, 'outgoing');
  queues[sender].push(text);
  if (!processing[sender]) {
    processing[sender] = true;
    try {
        await processQueue(sender);
    } catch (error) {
        console.error(`Error processing queue for sender ${sender}:`, error);
    } finally {
        processing[sender] = false;
    }
  }
}

// --- Translation Skipping/Placeholder Logic ---

// Checks if the entire message should skip translation
function shouldSkipTranslation(message) {
    const trimmed = message.trim();
    if (trimmed === '') return true; // Whitespace only
    if (/^[\p{P}\p{S}\s]*$/u.test(message)) return true; // Punctuation/Symbols only
    if (/^[\d.,+\-€$£¥\s]*$/.test(message)) return true; // Numerical only (adjust symbols)

    // Check if it's ONLY a URL
    urlRegex.lastIndex = 0; // Reset regex state
    const urlMatch = urlRegex.exec(trimmed);
    if (urlMatch && urlMatch[0].length === trimmed.length) return true;

    // Check if it's ONLY an email
    emailRegex.lastIndex = 0; // Reset regex state
    const emailMatch = emailRegex.exec(trimmed);
    if (emailMatch && emailMatch[0].length === trimmed.length) return true;

    // Emoji check (if the message ONLY contains emojis and whitespace)
    const emojiOnlyRegex = /^(?:[\p{Emoji}\p{Emoji_Component}\s]|[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}])+$/u;
    if (emojiOnlyRegex.test(message)) {
        const nonEmojiWs = message.replace(/[\p{Emoji}\p{Emoji_Component}\s]|[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu, '');
        if (nonEmojiWs.length === 0) return true;
    }

    return false; // Otherwise, attempt translation
}

// Extracts Emails/URLs and replaces them with placeholders
function extractPlaceholders(message) {
    const placeholdersMap = new Map();
    let currentMessage = message;
    let placeholderIndex = 0;

    // Function to replace matches with placeholders
    const replacer = (match) => {
        const placeholder = `@@PLACEHOLDER_${placeholderIndex++}@@`;
        placeholdersMap.set(placeholder, match); // Store original value
        return placeholder;
    };

    // Replace URLs
    urlRegex.lastIndex = 0; // Reset regex state before use
    currentMessage = currentMessage.replace(urlRegex, replacer);

    // Replace Emails
    emailRegex.lastIndex = 0; // Reset regex state before use
    currentMessage = currentMessage.replace(emailRegex, replacer);

    return { messageWithPlaceholders: currentMessage, placeholdersMap };
}

// Reinserts original values back into the translated text
function reinsertPlaceholders(translatedMessage, placeholdersMap) {
    let finalMessage = translatedMessage;
    // Iterate through the map and replace placeholders with original values
    for (const [placeholder, originalValue] of placeholdersMap.entries()) {
        // Use replaceAll for safety in case a placeholder appears multiple times (unlikely but possible)
        finalMessage = finalMessage.replaceAll(placeholder, originalValue);
    }
    return finalMessage;
}


// --- Main Processing Logic ---
async function processQueue(sender) {
  while (queues[sender].length) {
    const originalMessage = queues[sender].shift();
    const senderName = phoneNames[sender] || `User ${sender}`;

    // Check if the entire message should bypass translation
    if (shouldSkipTranslation(originalMessage)) {
      console.log(`Skipping translation for: "${originalMessage}"`);
      // Distribute original message directly
      for (const recv of phoneIds) {
        if (recv === sender) continue;
        appendBubble(sender, recv, senderName, originalMessage, 'incoming', originalMessage);
      }
      continue; // Go to next message in queue
    }

    // --- Prepare for translation (extract placeholders if needed) ---
    const { messageWithPlaceholders, placeholdersMap } = extractPlaceholders(originalMessage);
    let textToSend = messageWithPlaceholders; // Default to text with placeholders

    // --- Translation Loop ---
    const selectElement = document.getElementById(`select_${sender}`);
    const srcCode = selectElement ? selectElement.value : 'en';
    const srcName = lang_names[srcCode] || srcCode;

    for (const recv of phoneIds) {
      if (recv === sender) continue;

      const targetSelect = document.getElementById(`select_${recv}`);
      const tgtCode = targetSelect ? targetSelect.value : 'en';
      const tgtName = lang_names[tgtCode] || tgtCode;
      let finalMessageToSend = originalMessage; // Fallback to original if errors occur

      if (srcCode !== tgtCode) {
        try {
          console.log(`Translating from ${srcCode} to ${tgtCode}: "${textToSend}"`);
          const translatedText = await translate(textToSend, srcName, tgtName, srcCode, tgtCode);

          // Reinsert placeholders into the translated text
          console.log(`Reinserting placeholders into: "${translatedText}"`);
          finalMessageToSend = reinsertPlaceholders(translatedText, placeholdersMap);
          console.log(`Final message after reinsertion: "${finalMessageToSend}"`);

        } catch (e) {
          console.error(`Translation/Reinsertion error from ${srcName} to ${tgtName}:`, e);
          // Display error in the receiver's chat
          appendBubble(sender, recv, senderName, `Error translating message: ${e.message}`, 'incoming error', originalMessage);
          continue; // Skip appending bubble below for this receiver
        }
      } else {
         // If languages are the same, no translation needed, but still need to use the original
         // (placeholders were extracted but not used for translation call)
         finalMessageToSend = originalMessage;
      }

      // Append the final message (translated+reinserted or original)
      appendBubble(sender, recv, senderName, finalMessageToSend, 'incoming', originalMessage);
    }
  }
}

// --- Translate function (calls OpenAI API) ---
async function translate(msg, srcName, tgtName, srcCode, tgtCode) {
  // No changes needed here from the previous version,
  // it just receives text (potentially with placeholders)
  const key = `${srcCode}|${tgtCode}|${msg}`;
  if (translationCache.has(key)) return translationCache.get(key);

  if (!OPENAI_API_KEY || OPENAI_API_KEY.includes("placeholder") || OPENAI_API_KEY.length < 20) {
    console.warn("Using placeholder translation due to invalid or missing OpenAI API Key.");
    return `[${tgtCode}] ${msg}`; // Return placeholder text
  }

  // Note: Placeholders like @@PLACEHOLDER_0@@ might be slightly altered
  // by the translation model (e.g., spacing changes). The reinsertion logic
  // using replaceAll should still work if the core placeholder text remains.
  const prompt = `Translate the user text message by keeping any ${srcName} text unchanged and translating any ${srcName} text into ${tgtName}, maintaining a 1:1 translation ratio. Ensure the tone and meaning are perfectly transferred. Maintain punctuation exactly as it appears in the original message; do not add any, including after abbreviations, if it's not in the original. Preserve any original spelling mistakes, punctuation, abbreviations, slang, and other informal expressions in the translation. The translated text should sound natural to a native speaker. Never correct mistakes in the user message.

# Output Format

Provide a final text that mirrors the original in tone, meaning, spelling mistakes, punctuation, abbreviation usage, and slang, with all ${srcName} maintained and ${tgtName} translated to ${tgtName} in a 1:1 translation, while ensuring the translated text sounds natural to a native ${tgtName} speaker.

# Notes

- Ensure to maintain any placeholders like @@PLACEHOLDER_X@@ exactly as they appear in the original message.
- Abbreviations and slang should be maintained as in the original without added punctuation.
- Ensure that no additional punctuation is added to the translation if it isn't present in the original message.
- These are text messages, so maintain features typical of text messages, such as informal language and brevity but don't force it.
- Unless it happens in the text, do not mix languages.
- Do not forget to translate the text.`;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: msg }
        ],
        temperature: 0.1, // Slightly higher temp might help preserve placeholders better
        max_tokens: 1024
      })
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("OpenAI API Error Response:", data);
      const errorMsg = data.error?.message ? `Translation Error: ${data.error.message}` : `Translation failed (status ${res.status})`;
      throw new Error(errorMsg);
    }
    const out = (data.choices?.[0]?.message?.content || msg).trim();
    translationCache.set(key, out);
    return out;
  } catch (error) {
    console.error("Error during fetch to OpenAI:", error);
    throw error;
  }
}


// *** appendBubble function (No changes needed from previous version) ***
function appendBubble(senderId, receiverId, senderName, text, cls, original = null) {
    const area = document.getElementById(`msgs_${receiverId}`);
    if (!area) {
        console.error(`Message area msgs_${receiverId} not found.`);
        return;
    }
    let lastMessageBubble = area.lastElementChild;
    while(lastMessageBubble && lastMessageBubble.classList.contains('typing')) {
        lastMessageBubble = lastMessageBubble.previousElementSibling;
    }
    let isConsecutive = false;
    let isFirstInSequence = true;
    if (lastMessageBubble && lastMessageBubble.dataset.senderId === String(senderId)) {
        isConsecutive = true;
        isFirstInSequence = false;
        lastMessageBubble.classList.remove('last-in-sequence');
        lastMessageBubble.classList.add('middle-in-sequence');
    }
    const typingIndicatorId = `typing_${senderId}_to_${receiverId}`;
    const typingIndicator = document.getElementById(typingIndicatorId);
    if (typingIndicator && typingIndicator.parentNode === area) {
        hide_typing(senderId, !isConsecutive);
        if (typingIndicator.parentNode === area) {
            typingIndicator.remove();
        }
    }
    const b = document.createElement('div');
    b.className = `bubble ${cls}`;
    b.dataset.senderId = String(senderId);
    if (isFirstInSequence) {
        b.classList.add('first-in-sequence');
    }
    b.classList.add('last-in-sequence');
    if (isConsecutive) {
        b.classList.add('consecutive');
    }
    const lastMessageSenderId = lastMessageBubble ? lastMessageBubble.dataset.senderId : null;
    const showName = cls.includes('incoming') && String(senderId) !== lastMessageSenderId;
    if (showName) {
        const nameDiv = document.createElement('div');
        nameDiv.className = 'sender_name';
        nameDiv.textContent = senderName;
        b.appendChild(nameDiv);
    }
    const span = document.createElement('span');
    span.textContent = text;
    b.appendChild(span);
    if (original !== null && cls.includes('incoming') && !cls.includes('error') && typeof scramble === 'function') {
      b.dataset.original = original;
      b.dataset.translated = text;
      b.dataset.state = 'translated';
      b.style.cursor = 'pointer';
      span._scr = null;
       const showOriginal = () => {
            if (b.dataset.state === 'translated' && span._scr === null) {
                b.dataset.state = 'original';
                scramble(span, b.dataset.original);
            }
        };
        const restoreTranslated = () => {
            if (b.dataset.state === 'original' && span._scr === null) {
                b.dataset.state = 'translated';
                scramble(span, b.dataset.translated);
            }
        };
      b.addEventListener('pointerdown', showOriginal);
      b.addEventListener('pointerup', restoreTranslated);
      b.addEventListener('pointerleave', restoreTranslated);
    }
    area.appendChild(b);
    setTimeout(() => {
        const isScrolledNearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 100;
        if (isScrolledNearBottom) {
             area.scrollTop = area.scrollHeight;
        }
    }, 50);
}


/* ====== Initial Setup (No changes needed here) ===== */
function initializeChat() {
    console.log("Initializing Chat...");
    const container = document.querySelector('.container');
    const tpl = document.getElementById('phone_template')?.content;
    if (!container || !tpl) {
        console.error("Initialization failed: Container or template not found.");
        return;
    }
    phoneIds.forEach(id => {
        const node = tpl.cloneNode(true);
        const phoneDiv = node.querySelector('.phone');
        if(phoneDiv) phoneDiv.id = `phone_${id}`;
        ['blob', 'select', 'msgs', 'input', 'send'].forEach(k => {
            const element = node.querySelector(`#${k}_ID`);
            if(element) {
                element.id = `${k}_${id}`;
            } else {
                console.warn(`  Element with template ID ${k}_ID not found for phone ${id}`);
            }
        });
        container.appendChild(node);
        const input = document.getElementById(`input_${id}`);
        const send = document.getElementById(`send_${id}`);
        const sel = document.getElementById(`select_${id}`);
        const blob = document.getElementById(`blob_${id}`);
        if (sel && blob) {
            sel.addEventListener('change', e => {
               const displayValue = e.target.options[e.target.selectedIndex].text;
               const textNode = blob.firstChild && blob.firstChild.nodeType === Node.TEXT_NODE ? blob.firstChild : blob;
               textNode.textContent = displayValue;
            });
            const initialDisplayValue = sel.options[sel.selectedIndex].text;
            const textNode = blob.firstChild && blob.firstChild.nodeType === Node.TEXT_NODE ? blob.firstChild : blob;
            textNode.textContent = initialDisplayValue;
        }
        if (input && typeof update_typing === 'function' && typeof queueMsg === 'function') {
            input.addEventListener('input', e => update_typing(id, e.target.value));
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    queueMsg(id, input.value.trim());
                }
            });
            input.addEventListener('blur', () => update_typing(id, ''));
        }
        if (send && typeof queueMsg === 'function') {
            send.addEventListener('click', () => {
                if(input) queueMsg(id, input.value.trim());
            });
        }
    });
    console.log("Chat Initialization Complete.");
}
document.addEventListener('DOMContentLoaded', initializeChat);