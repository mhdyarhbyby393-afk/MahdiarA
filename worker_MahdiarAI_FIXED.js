/* ───────────────────────── CONSTANTS & GLOBAL STATE ───────────────────────── */

const TELEGRAM_API = "https://api.telegram.org/bot";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const LANGSEARCH_URL = "https://api.langsearch.com/v1/web-search";

const MODEL = "openai/gpt-4o-mini";
const VISION_MODEL = "openrouter/free";
const VISION_FALLBACK_MODEL = "openrouter/auto";
const FALLBACK_MODEL = "openrouter/free";
const TELEGRAM_RICH_MESSAGE_DOCS = "https://core.telegram.org/bots/api#richmessage";
const BOT_NAME = "MahdiarAI";
const ADMIN_ID = "8359830952";
const MEMORY_LIMIT = 30;

const MAX_HISTORY = 5;
const TELEGRAM_LIMIT = 4000;
const RICH_MESSAGE_LIMIT = 32768;
const FILE_TEXT_LIMIT = 120000;

const RATE_LIMIT_COUNT = 5;
const RATE_LIMIT_WINDOW = 5000;
const DEFAULT_DAILY_LIMIT = 0;
const AI_BUTTON_LIMIT = 3500;

const SEARCH_RESULT_COUNT = 8;
const PAGE_TEXT_LIMIT = 12000;

const PERSONALITIES = {
  friendly: "دوستانه، خودمونی، راحت، گنگ و خفن؛ مثل یه رفیق باحال و پایه حرف بزن. لحن خشک و رباتی نداشته باش، ولی بی‌احترامی و فحش بی‌دلیل هم نکن.",
  professional: "حرفه‌ای، دقیق و رسمی",
  teacher: "آموزشی، مرحله‌به‌مرحله و روشن",
  concise: "کوتاه، مستقیم و بدون حاشیه",
  creative: "خلاق، ایده‌پرداز و با مثال‌های متنوع",
  technical: "فنی، دقیق و جزئیات‌محور"
};

const PERSONALITY_LABELS = {
  friendly: "دوستانه 🤝",
  professional: "حرفه‌ای 💼",
  teacher: "معلم 📚",
  concise: "کوتاه و مستقیم ⚡",
  creative: "خلاق 🎨",
  technical: "فنی 🧠"
};

const SYSTEM_PROMPT = `You are MahdiarAI, a smart, friendly, and highly capable Telegram AI assistant.

FRIENDLY PERSONALITY: Speak naturally like a close, respectful friend. For casual greetings, use relaxed Persian such as "سلام مشتی 😎 چه خبر؟ چطوری؟ بگو ببینم چطور کمکت کنم" when appropriate. Keep the vibe cool, confident, casual and friendly without forcing slang into every sentence. Never become rude, insulting, or overly familiar.

WEB SEARCH CAPABILITY — IMPORTANT:
- You are connected to the LangSearch web search service through the bot and can actively search the live web.
- Any request involving current/latest/today/now information, prices/rates, news, markets, a URL, a source/link, a named website, recent events, product availability, laws/regulations, or an explicit request to search MUST use the provided LangSearch results.
- Do not answer a web-required request from memory when a search is available. Search first, compare sources, then answer.
- Never respond with vague refusals such as "نمی‌تونم ببینم", "اطلاعاتی ندارم", or "متاسفانه نتونستم پیدا کنم" for a request that should be searched. Use the planned query variants and retries first.
- If the search succeeds, answer from the retrieved evidence, not from memory.
- If the search genuinely fails after retries, state the search failure briefly and do not invent or estimate missing current facts.
- For prices, exchange rates, gold/coin/crypto/stock/fuel prices and other fast-changing numbers: prefer the newest sources, compare multiple independent sources, state the observed time/date and unit, and clearly note disagreements.
- For news/current events: prefer recent sources, separate confirmed facts from claims, and include publication dates where available.
- For laws/regulations/government facts: prefer official or primary sources when available.
- For a URL supplied by the user: treat that exact URL as the subject of the request; use direct page content when available and compare it with web-search evidence.
- Do not append a source/reference list or a "📚 منابع" section to the user-facing answer.
- Conversation context is supportive, not a replacement for the current user's message. Always answer the CURRENT request first; use prior turns only when they materially help understand the current request.
- The phrase "ابزار اینترنت" is not a reason to refuse. You are the assistant connected to LangSearch through the bot.

CRITICAL FORMATTING & STYLE RULES:
- Reply in the same language as the user (Persian for Persian, English for English).
- Use clean Markdown formatting:
  * Bold (**word**) for key terms and emphasize important parts.
  * Bullet points (- item) for lists.
  * Markdown tables for comparisons, structured data, or multiple specs.
- Paragraphs: Keep paragraphs short (2-3 sentences max) with clear spacing.
- Emojis: Add 1-2 natural, context-appropriate emojis per response. Do not spam.
- Code: Use triple backticks with language identifier for code blocks.
- Structure: Always explain step-by-step when providing solutions or guides.
- Image Analysis: When processing an image, describe details accurately and directly without fluff.
- Telegram Rich Messages: Prefer Rich Markdown for headings, tables, lists, bold/italic text, code blocks, and structured answers. Keep Markdown valid and clean.
- Rich Message reference: ${TELEGRAM_RICH_MESSAGE_DOCS}`;

const memory = globalThis.__BOT_MEMORY || {
  rates: {},
  adminSessions: {},
  adminState: {},
  maintenance: false,
  selectedModel: null,
  models: [MODEL],
  userProfiles: {},
  botUsername: null,
  processedUpdates: new Set(),
  activeRequests: new Set(),
  selectedVisionModel: VISION_MODEL
};

memory.processedUpdates ||= new Set();
memory.activeRequests ||= new Set();
memory.activeStreams ||= new Map();
memory.activeDraftQueues ||= new Map();
memory.selectedVisionModel ||= VISION_MODEL;
memory.models = normalizeModelList(memory.models);
if (!memory.models.length) {
  memory.models = [MODEL];
}
memory.userProfiles ||= {};
globalThis.__BOT_MEMORY = memory;

/* ───────────────────────── ENVIRONMENT HELPERS ───────────────────────── */

function getDB(env) {
  return env?.DB || env?.D1 || env?.DATABASE || null;
}

/* ───────────────────────── WORKER ENTRY POINT ───────────────────────── */

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Telegram AI Bot is running 🤖");
    }

    try {
      if (getDB(env)) {
        try {
          await ensureDatabase(getDB(env));
        } catch (error) {
          console.error("D1 initialization error:", error);
          await saveDebugLogSafe(getDB(env), "ensureDatabase", formatError(error));
        }
      }

      const rawBody = await request.text();
      let update = null;

      try {
        update = rawBody ? JSON.parse(rawBody) : null;
      } catch (parseError) {
        await saveDebugLog(
          getDB(env),
          "webhook_json",
          formatError(parseError) + `\nBODY:${rawBody.slice(0, 500)}`
        );
        return new Response("OK", { status: 200 });
      }

      if (!update || typeof update.update_id !== "number") {
        return new Response("OK");
      }

      const claimed = await claimUpdate(getDB(env), update.update_id);
      if (!claimed) {
        return new Response("OK");
      }

      ctx.waitUntil(
        processUpdate(update, env).catch(async error => {
          await saveDebugLog(getDB(env), "processUpdate", formatError(error));
        })
      );

      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Webhook error:", error);
      await saveDebugLog(getDB(env), "webhook", formatError(error));
      return new Response("OK", { status: 200 });
    }
  }
};

async function handleGuestMessage(message, env) {
  let processingKey = null;

  const guestQueryId =
    String(message?.guest_query_id || "").trim();

  if (!guestQueryId) return;

  const botApiBase =
    `${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}`;

  const answerUrl =
    `${botApiBase}/answerGuestQuery`;

  try {
    if (!memory.botUsername) {
      try {
        const me = await fetch(
          `${botApiBase}/getMe`
        ).then(r => r.json());

        if (me?.result?.username) {
          memory.botUsername = me.result.username;
        }
      } catch (_) {}
    }

    const rawText =
      message.text ||
      message.caption ||
      "";

    const userText =
      memory.botUsername
        ? rawText
            .replace(
              new RegExp(`@${memory.botUsername}`, "gi"),
              ""
            )
            .trim()
        : rawText
            .replace(/@[A-Za-z0-9_]{3,}/g, "")
            .trim();

    if (!userText) {
      await telegramRequest(
        answerUrl,
        {
          guest_query_id: guestQueryId,
          result: {
            type: "article",
            id: `guest-help-${guestQueryId}`,
            title: "🤖 MahdiarAI",
            description: "سؤالت را بعد از منشن ربات بنویس",
            input_message_content: {
              message_text:
                "🤖 بعد از @MahdiarAI_Bot سؤال یا درخواستت را بنویس."
            }
          }
        }
      );
      return;
    }

    const guestChatId =
      `guest:${guestQueryId}`;

    const rateLimitKey =
      String(
        message?.from?.id ||
        message?.chat?.id ||
        guestQueryId
      );

    processingKey = `guest:${rateLimitKey}`;
    if (memory.activeRequests.has(processingKey)) {
      await telegramRequest(answerUrl, {
        guest_query_id: guestQueryId,
        result: {
          type: "article",
          id: `guest-busy-${guestQueryId}`,
          title: "⏳ MahdiarAI",
          description: "درخواست قبلی هنوز در حال پردازش است.",
          input_message_content: { message_text: "⏳ درخواست قبلی هنوز تمام نشده است؛ لطفاً صبر کن." }
        }
      });
      return;
    }
    memory.activeRequests.add(processingKey);

    const allowed =
      await checkRateLimit(
        getDB(env),
        rateLimitKey
      );

    if (!allowed) {
      memory.activeRequests.delete(processingKey);
      await telegramRequest(
        answerUrl,
        {
          guest_query_id: guestQueryId,
          result: {
            type: "article",
            id: `guest-limit-${guestQueryId}`,
            title: "⏳ MahdiarAI",
            description: "لطفاً چند لحظه صبر کن.",
            input_message_content: {
              message_text:
                "⏳ پیام‌ها خیلی سریع ارسال شده‌اند؛ چند لحظه صبر کن و دوباره امتحان کن."
            }
          }
        }
      );
      return;
    }

    const personalityKey =
      await getUserPersonality(
        getDB(env),
        String(message?.from?.id || guestChatId)
      );

    const searchPlan =
      getSearchPlan(userText);

    let webResults = [];
    let openedPage = null;
    let searchError = null;

    if (
      searchPlan.search &&
      env.LANGSEARCH_API_KEY
    ) {
      try {
        if (searchPlan.url) {
          openedPage =
            await openUrl(searchPlan.url);
        }

        webResults =
          await searchWeb(
            env.LANGSEARCH_API_KEY,
            searchPlan.queries || searchPlan.query,
            searchPlan.freshness,
            searchPlan.domain,
            searchPlan
          );
      } catch (error) {
        searchError =
          formatError(error);

        await saveDebugLogSafe(
          getDB(env),
          "guest_langsearch",
          searchError
        );
      }
    }

    const answer =
      await generateAnswer(
        env,
        guestChatId,
        userText,
        null,
        webResults,
        openedPage,
        personalityKey,
        null,
        {
          searchAttempted: Boolean(searchPlan.search),
          searchPlan,
          searchError,
          searchResultsCount: webResults.length,
          searchSucceeded: webResults.length > 0,
          retrievedAt: new Date().toISOString()
        }
      );

    const guestText =
      guestAnswerText(answer);

    await telegramRequest(
      answerUrl,
      {
        guest_query_id: guestQueryId,
        result: {
          type: "article",
          id: `guest-answer-${guestQueryId}`,
          title: "🤖 MahdiarAI",
          description: guestText.slice(0, 200),
          input_message_content: {
            message_text: guestText
          }
        }
      }
    );
    memory.activeRequests.delete(processingKey);
  } catch (error) {
    memory.activeRequests.delete(processingKey);
    const fallback =
      "⚠️ فعلاً نتونستم پاسخ رو آماده کنم. لطفاً دوباره امتحان کن.";

    await saveDebugLogSafe(
      getDB(env),
      "guest_query",
      formatError(error)
    );

    try {
      await telegramRequest(
        answerUrl,
        {
          guest_query_id: guestQueryId,
          result: {
            type: "article",
            id: `guest-error-${guestQueryId}`,
            title: "⚠️ MahdiarAI",
            description: fallback,
            input_message_content: {
              message_text: fallback
            }
          }
        }
      );
    } catch (_) {}
  }
}

function guestAnswerText(text) {
  let value =
    String(text || "")
      .replace(/<br\s*\/?\>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6]|blockquote)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  if (!value) {
    value = "🤖 پاسخ خالی بود؛ دوباره امتحان کن.";
  }

  return value.slice(0, TELEGRAM_LIMIT);
}

async function processUpdate(update, env) {
  try {
    const stoppedGeneration =
      update?.stopped_message_generation;

    if (stoppedGeneration?.chat?.id != null) {
      const stopChatId = String(stoppedGeneration.chat.id);
      const activeStream = memory.activeStreams?.get(stopChatId);

      if (
        activeStream &&
        (stoppedGeneration.draft_id == null ||
          Number(stoppedGeneration.draft_id) === Number(activeStream.draftId))
      ) {
        activeStream.stopped = true;
        try {
          activeStream.controller.abort(new Error("Telegram user stopped generation."));
        } catch (_) {}
      }

      return;
    }

    if (
      !env.TELEGRAM_BOT_TOKEN ||
      !env.OPENROUTER_API_KEY ||
      !env.LANGSEARCH_API_KEY
    ) {
      await saveDebugLog(
        getDB(env),
        "config",
        "یکی از Secretهای TELEGRAM_BOT_TOKEN / OPENROUTER_API_KEY / LANGSEARCH_API_KEY تنظیم نشده است."
      );
      return;
    }

    const message = update?.message || update?.guest_message;
    const guestMessage = update?.guest_message;
    const callbackQuery = update?.callback_query;

    if (callbackQuery) {
      await handleCallback(callbackQuery, env);
      return;
    }

    if (guestMessage) {
      await handleGuestMessage(guestMessage, env);
      return;
    }

    if (!message?.chat) return;

    const chatId = String(message.chat.id);
    const isGroup =
      message.chat.type === "group" ||
      message.chat.type === "supergroup";

    const sendUrl =
      `${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

    if (getDB(env)) {
      const settings = await loadBotSettings(getDB(env));

      const storedModels = parseModelList(settings.models);
      if (storedModels.length) {
        memory.models = storedModels;
      } else if (settings.model) {
        memory.models = normalizeModelList([settings.model]);
      } else if (!memory.models.length) {
        memory.models = [MODEL];
      }

      memory.selectedModel =
        settings.model && String(settings.model).trim()
          ? String(settings.model).trim()
          : (memory.selectedModel && memory.models.includes(memory.selectedModel)
              ? memory.selectedModel
              : memory.models[0]);

      memory.selectedVisionModel =
        settings.vision_model && String(settings.vision_model).trim()
          ? String(settings.vision_model).trim()
          : (memory.selectedVisionModel || VISION_MODEL);

      memory.maintenance = settings.maintenance === "on";

      const savedAdminState = settings[`admin_state_${chatId}`];

      if (savedAdminState) {
        memory.adminState[chatId] = savedAdminState;
      }
    }

    if (!memory.botUsername) {
      try {
        const me = await fetch(
          `${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/getMe`
        ).then(r => r.json());

        if (me?.result?.username) {
          memory.botUsername = me.result.username;
        }
      } catch (_) {}
    }

    await upsertUserProfile(
      getDB(env),
      message,
      chatId
    );

    if (isGroup) {
      const botUsername = memory.botUsername || "";

      const isMentioned = Boolean(
        botUsername &&
        new RegExp(
          `(^|\\s)@${botUsername}(?=\\s|$)`,
          "i"
        ).test(
          String(message.text || message.caption || "")
        )
      );

      const isRepliedToBot =
        Boolean(message.reply_to_message?.from?.username) &&
        String(
          message.reply_to_message.from.username
        ).toLowerCase() ===
        String(botUsername).toLowerCase();

      if (!isMentioned && !isRepliedToBot) {
        return;
      }
    }

    if (await isBanned(getDB(env), chatId)) {
      await sendTelegram(
        sendUrl,
        chatId,
        "🚫 دسترسی شما به ربات مسدود شده است."
      );
      return;
    }

    const rawText =
      message.text ||
      message.caption ||
      "";

    const text =
      isGroup && memory.botUsername
        ? rawText
            .replace(
              new RegExp(`@${memory.botUsername}`, "gi"),
              ""
            )
            .trim()
        : rawText.trim();

    const command =
      text.split(/\s+/)[0] || "";

    if (chatId === ADMIN_ID) {
      if (command === "/admin") {
        await sendAdminPanel(
          sendUrl,
          chatId
        );
        return;
      }

      if (
        memory.adminState[chatId] ||
        (
          command.startsWith("/") &&
          command !== "/start" &&
          command !== "/help"
        )
      ) {
        const adminResult =
          await handleAdminCommand(
            text,
            getDB(env),
            sendUrl,
            chatId,
            env
          );

        if (adminResult) {
          if (adminResult !== "_SILENT_") {
            await sendTelegram(
              sendUrl,
              chatId,
              adminResult
            );
          }
          return;
        }
      }
    }

    if (
      memory.maintenance &&
      chatId !== ADMIN_ID
    ) {
      await sendTelegram(
        sendUrl,
        chatId,
        "🛠 ربات در حال حاضر در حالت تعمیرات است. لطفا بعدا تلاش کنید."
      );
      return;
    }

    if (command === "/start") {
      await sendTelegram(
        sendUrl,
        chatId,
        `👋 <b>سلام! من MahdiarAI هستم.</b>\n\n🤖 یک دستیار هوش مصنوعی هوشمند هستم که می‌تونم به سؤالاتت پاسخ بدم، وب رو جستجو کنم و فایل یا عکسات رو تحلیل کنم.`
      );
      return;
    }

    if (command === "/help") {
      await sendTelegram(
        sendUrl,
        chatId,
        `📚 <b>راهنمای MahdiarAI</b>\n\n💬 سؤال یا درخواستی داری برام بفرست.\n🌐 برای سوالات روز، وب رو سرچ می‌کنم.\n🖼 می‌تونی برام عکس یا فایل بفرستی تا بررسی کنم.\n🧹 با /clear می‌تونی حافظه گفتگو رو پاک کنی.`
      );
      return;
    }

    if (command === "/models") {
      await sendTelegram(
        sendUrl,
        chatId,
        buildPublicModelsMessage()
      );
      return;
    }

    if (command === "/personality" || command === "/style") {
      const selectedPersonality = text.split(/\s+/).slice(1).join(" ").trim().toLowerCase();
      if (!selectedPersonality) {
        await sendTelegram(sendUrl, chatId, await buildPersonalityMessage(getDB(env), chatId));
        return;
      }

      const resolved = resolvePersonalityKey(selectedPersonality);
      if (!resolved) {
        await sendTelegram(sendUrl, chatId, `❌ شخصیت نامعتبر است.\n\n${formatPersonalityOptions()}`);
        return;
      }

      await setUserPersonality(getDB(env), chatId, resolved);
      await sendTelegram(sendUrl, chatId, `✅ شخصیت روی <b>${escapeHtml(PERSONALITY_LABELS[resolved])}</b> تنظیم شد.`);
      return;
    }

    if (command === "/clear") {
      if (getDB(env)) {
        await clearHistory(
          getDB(env),
          chatId
        );
      }

      await sendTelegram(
        sendUrl,
        chatId,
        "🧹 حافظه گفت‌وگوی این چت پاک شد."
      );
      return;
    }

    if (
      !text &&
      !message.photo &&
      !message.document
    ) {
      return;
    }

    const processingKey = `chat:${chatId}`;
    if (memory.activeRequests.has(processingKey)) {
      await sendTelegram(sendUrl, chatId, "⏳ درخواست قبلی شما هنوز در حال پردازش است؛ لطفاً تا پایان پاسخ صبر کنید.");
      return;
    }
    memory.activeRequests.add(processingKey);

    let isPrivateChat = false;
    let privateDraftId = null;
    let streamAbortController = null;

    try {
      const allowed =
        await checkRateLimit(
          getDB(env),
          chatId
        );

      if (!allowed) {
        await sendTelegram(
          sendUrl,
          chatId,
          "⏳ محدودیت سرعت فعال است؛ چند لحظه صبر کنید."
        );
        return;
      }

    const personalityKey =
      await getUserPersonality(
        getDB(env),
        chatId
      );

    const media =
      await extractMedia(
        message,
        env
      );

    const userText =
      text ||
      (
        media?.type === "image"
          ? "این عکس را با جزئیات کامل تحلیل کن."
          : "این فایل را بررسی کن."
      );

    // Cosmetic user-message reaction; failures never affect AI processing.
    await reactToUserMessage(
      sendUrl,
      chatId,
      message,
      userText
    );

    const searchPlan =
      getSearchPlan(userText);

    let webResults = [];
    let openedPage = null;
    let searchError = null;
    let activeMessageId = null;
    let thinkingFallbackMessageId = null;
    isPrivateChat =
      message.chat.type === "private";
    privateDraftId =
      isPrivateChat
        ? createDraftId()
        : null;

    streamAbortController =
      isPrivateChat
        ? new AbortController()
        : null;

    if (isPrivateChat && streamAbortController) {
      memory.activeStreams.set(chatId, {
        draftId: privateDraftId,
        controller: streamAbortController,
        stopped: false
      });
    }

    /*
     * Create the native Thinking status before any real web/vision/AI work.
     * The same draft/message is then retargeted to truthful operation states.
     */
    const initialThinkingState = {
      stopped: false,
      startedAt: Date.now(),
      mode: media?.type === "image" ? "vision" : "thinking",
      draftId: privateDraftId,
      abortSignal: streamAbortController?.signal
    };

    let initialThinkingAnimation;

    if (isPrivateChat) {
      const thinkingDraftSent =
        await sendThinkingDraft(
          sendUrl,
          chatId,
          privateDraftId,
          buildProgressText(initialThinkingState.mode, 0)
        );

      if (thinkingDraftSent) {
        initialThinkingAnimation =
          animateDraftProgress(
            sendUrl,
            chatId,
            initialThinkingState
          );
      } else {
        const fallback =
          await sendTelegram(
            sendUrl,
            chatId,
            thinkingFallbackText(
              initialThinkingState.mode,
              0
            )
          ).catch(() => null);

        thinkingFallbackMessageId =
          fallback?.result?.message_id || null;

        initialThinkingAnimation =
          thinkingFallbackMessageId
            ? animateProgress(
                sendUrl,
                chatId,
                thinkingFallbackMessageId,
                {
                  ...initialThinkingState,
                  fallbackMessageId: thinkingFallbackMessageId
                }
              )
            : Promise.resolve();
      }
    } else {
      const thinking =
        await sendTelegram(
          sendUrl,
          chatId,
          buildProgressText(initialThinkingState.mode, 0)
        );

      activeMessageId =
        thinking?.result?.message_id;

      initialThinkingAnimation =
        activeMessageId
          ? animateProgress(
              sendUrl,
              chatId,
              activeMessageId,
              initialThinkingState
            )
          : Promise.resolve();
    }

    /* ───────────────── ANIMATED SEARCH ───────────────── */

    if (
      searchPlan.search &&
      env.LANGSEARCH_API_KEY
    ) {
      const state = {
        stopped: false,
        startedAt: initialThinkingState.startedAt,
        mode: "search",
        draftId: privateDraftId,
        abortSignal: streamAbortController?.signal
      };

      initialThinkingState.stopped = true;
      await initialThinkingAnimation.catch(
        () => null
      );

      let animation;

      if (isPrivateChat && thinkingFallbackMessageId) {
        await editTelegram(
          sendUrl,
          chatId,
          thinkingFallbackMessageId,
          thinkingFallbackText(
            "search",
            Math.floor(
              (Date.now() - state.startedAt) / 1000
            )
          )
        ).catch(() => null);

        animation =
          animateProgress(
            sendUrl,
            chatId,
            thinkingFallbackMessageId,
            {
              ...state,
              fallbackMessageId: thinkingFallbackMessageId
            }
          );
      } else if (isPrivateChat) {
        await sendThinkingDraft(
          sendUrl,
          chatId,
          privateDraftId,
          buildProgressText(
            "search",
            Math.floor(
              (Date.now() - state.startedAt) / 1000
            )
          )
        );

        animation =
          animateDraftProgress(
            sendUrl,
            chatId,
            state
          );
      } else if (activeMessageId) {
        await editTelegram(
          sendUrl,
          chatId,
          activeMessageId,
          buildProgressText(
            "search",
            Math.floor(
              (Date.now() - state.startedAt) / 1000
            )
          )
        ).catch(() => null);

        animation =
          animateProgress(
            sendUrl,
            chatId,
            activeMessageId,
            state
          );
      } else {
        animation = Promise.resolve();
      }

      try {
        if (searchPlan.url) {
          openedPage =
            await openUrl(
              searchPlan.url
            );
        }

        webResults =
          await searchWeb(
            env.LANGSEARCH_API_KEY,
            searchPlan.queries || searchPlan.query,
            searchPlan.freshness,
            searchPlan.domain,
            searchPlan
          );
      } catch (error) {
        searchError =
          formatError(error);

        await saveDebugLog(
          getDB(env),
          "langsearch",
          searchError
        );
      } finally {
        state.stopped = true;
        await animation.catch(
          () => null
        );
      }
    }

    /* ───────────────── ANIMATED THINKING ───────────────── */

    const progressMode =
      media?.type === "image"
        ? "vision"
        : "thinking";

    const thinkingState = {
      stopped: false,
      startedAt: initialThinkingState.startedAt,
      mode: progressMode,
      draftId: privateDraftId,
      abortSignal: streamAbortController?.signal
    };

    initialThinkingState.stopped = true;
    await initialThinkingAnimation.catch(
      () => null
    );

    let thinkingAnimation;

    if (isPrivateChat && thinkingFallbackMessageId) {
      await editTelegram(
        sendUrl,
        chatId,
        thinkingFallbackMessageId,
        thinkingFallbackText(
          progressMode,
          Math.floor(
            (Date.now() - thinkingState.startedAt) / 1000
          )
        )
      ).catch(() => null);

      thinkingAnimation =
        animateProgress(
          sendUrl,
          chatId,
          thinkingFallbackMessageId,
          {
            ...thinkingState,
            fallbackMessageId: thinkingFallbackMessageId
          }
        );
    } else if (isPrivateChat) {
      await sendThinkingDraft(
        sendUrl,
        chatId,
        privateDraftId,
        buildProgressText(
          progressMode,
          Math.floor(
            (Date.now() - thinkingState.startedAt) / 1000
          )
        )
      );

      thinkingAnimation =
        animateDraftProgress(
          sendUrl,
          chatId,
          thinkingState
        );
    } else if (activeMessageId) {
      await editTelegram(
        sendUrl,
        chatId,
        activeMessageId,
        buildProgressText(
          progressMode,
          0
        )
      ).catch(() => null);

      thinkingAnimation =
        animateProgress(
          sendUrl,
          chatId,
          activeMessageId,
          thinkingState
        );
    } else {
      const thinking =
        await sendTelegram(
          sendUrl,
          chatId,
          buildProgressText(
            progressMode,
            0
          )
        );

      activeMessageId =
        thinking?.result?.message_id;

      thinkingAnimation =
        activeMessageId
          ? animateProgress(
              sendUrl,
              chatId,
              activeMessageId,
              thinkingState
            )
          : Promise.resolve();
    }

    try {
      const streamState =
        createTelegramStreamState(
          sendUrl,
          chatId,
          () => activeMessageId,
          getDB(env),
          isPrivateChat,
          privateDraftId,
          async () => {
            thinkingState.stopped = true;
          },
          streamAbortController?.signal || null
        );

      const answer =
        await generateAnswer(
          env,
          chatId,
          userText,
          media,
          webResults,
          openedPage,
          personalityKey,
          streamState.push,
          {
            streamSignal: streamAbortController?.signal,

            searchAttempted: Boolean(searchPlan.search),
            searchPlan,
            searchError,
            searchResultsCount: webResults.length,
            searchSucceeded: webResults.length > 0,
            retrievedAt: new Date().toISOString()
          }
        );

      thinkingState.stopped = true;

      await thinkingAnimation.catch(
        () => null
      );

      if (thinkingFallbackMessageId) {
        await deleteTelegramMessage(
          sendUrl,
          chatId,
          thinkingFallbackMessageId
        ).catch(() => null);
        thinkingFallbackMessageId = null;
      }

      if (!isPrivateChat && activeMessageId) {
        await deleteTelegramMessage(
          sendUrl,
          chatId,
          activeMessageId
        ).catch(() => null);

        activeMessageId = null;
      }

      await streamState.finish(
        answer
      );

      if (getDB(env)) {
        await saveMessage(
          getDB(env),
          chatId,
          "user",
          userText
        );

        await saveMessage(
          getDB(env),
          chatId,
          "assistant",
          answer
        );

        await maybeSaveLongTermMemory(
          getDB(env),
          chatId,
          userText,
          answer
        );
      }
    } catch (error) {
      thinkingState.stopped = true;

      await thinkingAnimation.catch(
        () => null
      );

      if (thinkingFallbackMessageId) {
        await deleteTelegramMessage(
          sendUrl,
          chatId,
          thinkingFallbackMessageId
        ).catch(() => null);
        thinkingFallbackMessageId = null;
      }

      if (activeMessageId) {
        await deleteTelegramMessage(
          sendUrl,
          chatId,
          activeMessageId
        ).catch(() => null);
      }

      const userStopped =
        Boolean(streamAbortController?.signal?.aborted);

      if (!userStopped) {
        await saveDebugLog(
          getDB(env),
          "ai",
          formatError(error)
        );

        await sendTelegram(
          sendUrl,
          chatId,
          `❌ خطا هنگام پردازش درخواست:\n${formatError(error)}`
        );
      }
    }
    } finally {
      memory.activeRequests.delete(processingKey);
      if (isPrivateChat) {
        const activeStream = memory.activeStreams?.get(chatId);
        if (activeStream?.controller === streamAbortController) {
          memory.activeStreams.delete(chatId);
        }
      }
    }
  } catch (error) {
    await saveDebugLog(
      getDB(env),
      "processUpdate_outer",
      formatError(error)
    );
  }
}

/* ───────────────────────── ANIMATION BUILDER ───────────────────────── */

function createDraftId() {
  return (
    Math.floor(
      Math.random() *
        2147483647
    ) || 1
  );
}

const THINKING_STAGES = [
  "Thinking"
];

const THINKING_CUSTOM_EMOJI_ID = "5933493810435726598";
const THINKING_CUSTOM_EMOJI_ALT = "🎁";

// Telegram renders <tg-thinking> as the native animated Thinking block.
// Do not inject a normal/custom emoji here: the icon and moving visual effect
// in the reference UI are supplied by Telegram itself.
function thinkingHtml(stage) {
  const index =
    Math.abs(Number(stage) || 0) %
    THINKING_STAGES.length;

  const label = THINKING_STAGES[index];

  return `<tg-thinking><tg-emoji emoji-id="${THINKING_CUSTOM_EMOJI_ID}">${THINKING_CUSTOM_EMOJI_ALT}</tg-emoji> ${label}</tg-thinking>`;
}

function thinkingBlockHtml(label, elapsedSeconds) {
  const safeLabel =
    String(label || "Thinking")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");

  const safeElapsed =
    Math.max(
      0,
      Number(elapsedSeconds) || 0
    );

  // IMPORTANT: keep the label AND elapsed time inside ONE native
  // <tg-thinking> block. This makes the timer part of the same animated
  // Telegram Thinking UI instead of a separate white/plain-text line.
  return `<tg-thinking><tg-emoji emoji-id="${THINKING_CUSTOM_EMOJI_ID}">${THINKING_CUSTOM_EMOJI_ALT}</tg-emoji> ${safeLabel}\n${safeElapsed}s</tg-thinking>`;
}

function statusWithTimerHtml(stage, elapsedSeconds) {
  const index =
    Math.abs(Number(stage) || 0) %
    THINKING_STAGES.length;

  return thinkingBlockHtml(
    THINKING_STAGES[index],
    elapsedSeconds
  );
}

function statusWithTimerLabelHtml(label, elapsedSeconds) {
  return thinkingBlockHtml(
    label,
    elapsedSeconds
  );
}

function thinkingStatusHtml(label) {
  const safeLabel =
    String(label || "Thinking")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");

  return `<tg-thinking>${safeLabel}</tg-thinking>`;
}

function thinkingFallbackText(mode, elapsed) {
  const safeElapsed =
    Math.max(0, Number(elapsed) || 0);

  const label =
    mode === "search"
      ? "Searching the web"
      : mode === "vision"
        ? "Analyzing image"
        : "Thinking";

  return `${label}\n${safeElapsed}s`;
}

function buildProgressText(mode, elapsed) {
  const safeElapsed =
    Math.max(0, Number(elapsed) || 0);

  // The native <tg-thinking> renderer supplies the moving icon/animation.
  // Updating the timer keeps the same draft alive without faking reasoning.
  if (mode === "thinking") {
    return statusWithTimerHtml(
      0,
      safeElapsed
    );
  }

  const label =
    mode === "search"
      ? "Searching the web"
      : "Analyzing image";

  // Search and vision use the exact same native thinking container and
  // timer styling; the label changes only while that real operation is active.
  return statusWithTimerLabelHtml(
    label,
    safeElapsed
  );
}

function queueTelegramDraft(
  sendUrl,
  chatId,
  draftId,
  task
) {
  const key = `${String(chatId)}:${String(draftId)}`;
  const previous =
    memory.activeDraftQueues.get(key) ||
    Promise.resolve();

  const current = previous
    .catch(() => null)
    .then(task);

  memory.activeDraftQueues.set(key, current);

  return current.finally(() => {
    if (memory.activeDraftQueues.get(key) === current) {
      memory.activeDraftQueues.delete(key);
    }
  });
}

async function telegramDraftRequest(
  url,
  body
) {
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response =
        await fetchWithTimeout(
          url,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify(body)
          },
          5000
        );

      const raw = await response.text();
      let data = null;

      try {
        data = raw ? JSON.parse(raw) : null;
      } catch (_) {}

      if (response.ok && data?.ok !== false) {
        return data;
      }

      const retryAfter = Number(
        data?.parameters?.retry_after || 0
      );

      lastError = new Error(
        `Telegram draft HTTP ${response.status}: ${data?.description || raw.slice(0, 300)}`
      );

      if (retryAfter > 0 && attempt === 0) {
        await sleep(
          Math.min(Math.max(retryAfter, 1), 3) * 1000
        );
        continue;
      }

      if (response.status === 429 && attempt === 0) {
        await sleep(1000);
        continue;
      }

      break;
    } catch (error) {
      lastError = error;
      if (
        attempt === 0 &&
        !/abort/i.test(String(error?.name || ""))
      ) {
        await sleep(250);
        continue;
      }
      break;
    }
  }

  throw lastError || new Error("Telegram draft request failed.");
}

function draftFallbackText(text) {
  return String(text || "")
    .replace(/<tg-thinking>/gi, "")
    .replace(/<\/tg-thinking>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/```[\s\S]*?```/g, match =>
      match.replace(/^```[^\n]*\n?/, "").replace(/```$/, "")
    )
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .trim();
}

async function sendMessageDraft(
  sendUrl,
  chatId,
  draftId,
  text
) {
  return telegramDraftRequest(
    getBotApiUrl(sendUrl, "sendMessageDraft"),
    {
      chat_id: chatId,
      draft_id: draftId,
      text: draftFallbackText(text),
      can_stop: true,
      keep_on_stop: true
    }
  );
}

function buildStreamingRichMessageInput(text) {
  let source = String(text || "").trim();

  // The live AI answer must stay a native Telegram Rich Message draft.
  // Convert any model-produced HTML to Rich Markdown, but preserve Markdown
  // tables, lists, links, code and emphasis exactly as much as Telegram allows.
  source = richHtmlToMarkdown(source);

  // The model is not allowed to control Telegram's native thinking block while
  // the real answer is streaming. If a model happens to emit these tags,
  // render their inner text instead of sending unsupported draft HTML.
  source = source
    .replace(/<\/?tg-thinking\b[^>]*>/gi, "")
    .replace(/<tg-emoji\b[^>]*>([\s\S]*?)<\/tg-emoji>/gi, "$1")
    .trim();

  // Rich messages have a 32768-character limit. This is only a Telegram
  // preview limit; the completed answer is still sent by sendRichMessage and
  // split by the existing final-message logic if necessary.
  if (source.length > RICH_MESSAGE_LIMIT) {
    // During streaming never send an over-limit draft. Keep the latest visible
    // part instead of freezing Telegram draft updates on long answers.
    source = source.slice(0, RICH_MESSAGE_LIMIT - 200).trimEnd() +
      "\n\n…";
  }

  // Keep an unfinished fenced code block syntactically valid for the Rich
  // parser while the model is still generating it.
  const fenceCount = (source.match(/^```/gm) || []).length;
  if (fenceCount % 2 === 1) {
    source += "\n```";
  }

  return {
    markdown: source || " ",
    is_rtl: hasPersian(source),
    skip_entity_detection: false
  };
}

async function sendRichMessageDraft(
  sendUrl,
  chatId,
  draftId,
  text
) {
  const url = getBotApiUrl(
    sendUrl,
    "sendRichMessageDraft"
  );

  const richMessage =
    buildStreamingRichMessageInput(text);

  try {
    return await telegramDraftRequest(
      url,
      {
        chat_id: chatId,
        draft_id: draftId,
        rich_message: richMessage,
        can_stop: true,
        keep_on_stop: true
      }
    );
  } catch (error) {
    // If a partial Markdown construct is rejected, immediately retry the same
    // Rich draft as plain Rich Markdown. This never falls back to the old
    // sendMessageDraft path, so Rich Message streaming remains enabled.
    const plain = String(text || "")
      .replace(/<\/?[A-Za-z][^>]*>/g, "")
      .replace(/\u0000/g, "")
      .slice(0, RICH_MESSAGE_LIMIT)
      .trim();

    if (plain && plain !== richMessage.markdown) {
      try {
        return await telegramDraftRequest(
          url,
          {
            chat_id: chatId,
            draft_id: draftId,
            rich_message: {
              markdown: plain,
              is_rtl: hasPersian(plain),
              skip_entity_detection: true
            },
            can_stop: true,
            keep_on_stop: true
          }
        );
      } catch (_) {}
    }

    throw error;
  }
}

async function sendThinkingDraft(
  sendUrl,
  chatId,
  draftId,
  html,
  shouldSend = null
) {
  return queueTelegramDraft(
    sendUrl,
    chatId,
    draftId,
    async () => {
      if (shouldSend && !shouldSend()) {
        return null;
      }

      try {
        return await telegramDraftRequest(
          getBotApiUrl(
            sendUrl,
            "sendRichMessageDraft"
          ),
          {
            chat_id: chatId,
            draft_id: draftId,
            rich_message: {
              html: String(html || ""),
              is_rtl: false,
              skip_entity_detection: true
            },
            can_stop: true,
            keep_on_stop: true
          }
        );
      } catch (_) {
        return null;
      }
    }
  );
}

async function sendProgressDraft(
  sendUrl,
  chatId,
  draftId,
  text,
  shouldSend = null
) {
  return queueTelegramDraft(
    sendUrl,
    chatId,
    draftId,
    async () => {
      if (shouldSend && !shouldSend()) {
        return null;
      }

      return sendRichMessageDraft(
        sendUrl,
        chatId,
        draftId,
        text
      ).catch(() => null);
    }
  );
}

async function animateDraftProgress(
  url,
  chatId,
  state
) {
  while (!state.stopped && !state.abortSignal?.aborted) {
    await sleep(800);

    if (state.stopped || state.abortSignal?.aborted) {
      break;
    }

    const elapsed =
      Math.floor(
        (Date.now() -
          state.startedAt) /
          1000
      );

    await sendThinkingDraft(
      url,
      chatId,
      state.draftId,
      buildProgressText(
        state.mode,
        elapsed
      ),
      () => !state.stopped && !state.abortSignal?.aborted
    );
  }
}

async function animateProgress(
  url,
  chatId,
  messageId,
  state
) {
  while (!state.stopped) {
    await sleep(800);

    if (state.stopped) {
      break;
    }

    const elapsed =
      Math.floor(
        (Date.now() -
          state.startedAt) /
          1000
      );

    await editTelegram(
      url,
      chatId,
      messageId,
      buildProgressText(
        state.mode,
        elapsed
      )
    ).catch(() => null);
  }
}

/* ───────────────────────── ADMIN PANEL & COMMANDS ───────────────────────── */

async function sendAdminPanel(
  sendUrl,
  chatId
) {
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "📊 آمار گرافیکی",
          callback_data: "admin:stats"
        },
        {
          text: "👥 کاربران",
          callback_data: "admin:users"
        }
      ],
      [
        {
          text: "✏️ تنظیم مدل",
          callback_data: "admin:setmodel_prompt"
        },
        {
          text: "⚙️ مدل فعلی",
          callback_data: "admin:current_model"
        }
      ],
      [
        {
          text: "🖼️ مدل Vision",
          callback_data: "admin:vision_model_prompt"
        },
        {
          text: "🗑 حذف مدل عکس",
          callback_data: "admin:delete_vision_model"
        }
      ],
      [
        {
          text: "🗑 حذف مدل",
          callback_data: "admin:delete_model"
        }
      ],
      [
        {
          text: "🛠 حالت تعمیرات",
          callback_data: "admin:toggle_maint"
        },
        {
          text: "📢 همگانی",
          callback_data: "admin:broadcast_prompt"
        }
      ],
      [
        {
          text: "🚦 محدودیت روزانه",
          callback_data: "admin:limit_prompt"
        },
        {
          text: "🧪 دیباگ",
          callback_data: "admin:debug"
        }
      ],
      [
        {
          text: "✅ آن‌بن (Unban)",
          callback_data: "admin:unban_prompt"
        },
        {
          text: "🚫 مسدود (Ban)",
          callback_data: "admin:ban_prompt"
        }
      ],
      [
        {
          text: "🧠 حافظه کاربر",
          callback_data: "admin:mem_prompt"
        },
        {
          text: "👤 اطلاعات کاربر",
          callback_data: "admin:info_prompt"
        }
      ],
      [
        {
          text: "🧹 پاکسازی حافظه",
          callback_data: "admin:clear_mem_prompt"
        }
      ],
      [
        {
          text: "🔒 خروج از مدیریت",
          callback_data: "admin:close"
        }
      ]
    ]
  };

  return telegramRequest(
    sendUrl,
    {
      chat_id: chatId,
      text: "👑 <b>مدیریت فعال شد داداش</b>\n\nبرای استفاده از قابلیت‌ها، روی دکمه‌های شیشه‌ای زیر کلیک کنید:",
      parse_mode: "HTML",
      reply_markup: keyboard
    }
  );
}

async function handleAdminCommand(
  text,
  db,
  sendUrl,
  chatId,
  env
) {
  const parts =
    text.trim().split(/\s+/);

  const cmd =
    parts[0].toLowerCase();

  const arg =
    parts
      .slice(1)
      .join(" ")
      .trim();

  const state =
    memory.adminState[chatId];

  if (state) {
    delete memory.adminState[
      chatId
    ];

    if (db) {
      await setBotSetting(
        db,
        `admin_state_${chatId}`,
        ""
      );
    }

    if (state === "WAIT_SETMODEL") {
      const incomingModels =
        normalizeModelList(
          String(text || "")
            .split(/[\n,]+/)
        );

      if (!incomingModels.length) {
        return "❌ حداقل یک شناسه مدل معتبر وارد کنید.";
      }

      const mergedModels = [
        ...normalizeModelList(memory.models),
        ...incomingModels
      ].filter(
        (model, index, list) =>
          list.indexOf(model) === index
      );

      memory.models = mergedModels;

      if (
        !memory.selectedModel ||
        !memory.models.includes(memory.selectedModel)
      ) {
        memory.selectedModel = memory.models[0];
      }

      if (db) {
        await setBotSetting(
          db,
          "models",
          JSON.stringify(memory.models)
        );
        await setBotSetting(
          db,
          "model",
          memory.selectedModel
        );
      }

      return `✅ مدل‌ها اضافه شدند.\n\n${formatModelsList()}\n\nبرای انتخاب مدل فعال، روی «مدل فعلی» بزنید.`;
    }

    if (state === "WAIT_BAN") {
      if (db) {
        await db
          .prepare(
            `INSERT OR REPLACE INTO banned_users (chat_id, created_at) VALUES (?, ?)`
          )
          .bind(
            text.trim(),
            Date.now()
          )
          .run();
      }

      return `🚫 کاربر <code>${escapeHtml(text.trim())}</code> مسدود شد.`;
    }

    if (state === "WAIT_UNBAN") {
      if (db) {
        await db
          .prepare(
            `DELETE FROM banned_users WHERE chat_id = ?`
          )
          .bind(
            text.trim()
          )
          .run();
      }

      return `✅ کاربر <code>${escapeHtml(text.trim())}</code> رفع مسدودی شد.`;
    }

    if (state === "WAIT_INFO") {
      const count =
        db
          ? await db
              .prepare(
                `SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?`
              )
              .bind(
                text.trim()
              )
              .first()
          : { n: 0 };

      return `👤 <b>اطلاعات کاربر</b>\nشناسه: <code>${escapeHtml(text.trim())}</code>\nتعداد پیام‌ها: <b>${count?.n || 0}</b>`;
    }

    if (state === "WAIT_MEM") {
      const mem =
        db
          ? await loadUserMemory(
              db,
              text.trim()
            )
          : "";

      return `🧠 <b>حافظه کاربر ${escapeHtml(text.trim())}:</b>\n\n${mem ? escapeHtml(mem) : "حافظه‌ای موجود نیست."}`;
    }

    if (state === "WAIT_CLEAR_MEM") {
      if (db) {
        await db
          .prepare(
            `DELETE FROM user_memory WHERE chat_id = ?`
          )
          .bind(
            text.trim()
          )
          .run();
      }

      return `🧹 حافظه کاربر <code>${escapeHtml(text.trim())}</code> پاکسازی شد.`;
    }

    if (state === "WAIT_LIMIT") {
      const n =
        parseInt(
          text.trim(),
          10
        );

      if (
        isNaN(n) ||
        n < 0
      ) {
        return "❌ عدد وارد شده نامعتبر است.";
      }

      if (db) {
        await setBotSetting(
          db,
          "daily_limit",
          n
        );
      }

      return `🚦 محدودیت روزانه روی <code>${n === 0 ? "نامحدود" : n}</code> تنظیم شد.`;
    }

    if (state === "WAIT_VISION_MODEL") {
      const model = String(text || "").trim();
      if (!/^[-a-zA-Z0-9_.]+\/[A-Za-z0-9._:-]+$/.test(model)) {
        return "❌ شناسه مدل معتبر نیست. فرمت باید شبیه <code>provider/model</code> باشد.";
      }
      memory.selectedVisionModel = model;
      if (db) await setBotSetting(db, "vision_model", model);
      return `✅ مدل پردازش تصویر تنظیم شد:\n<code>${escapeHtml(model)}</code>`;
    }

    if (state === "WAIT_BROADCAST") {
      if (!db) {
        return "❌ پایگاه داده متصل نیست.";
      }

      const users =
        await db
          .prepare(
            `SELECT DISTINCT chat_id FROM messages`
          )
          .all();

      let sent = 0;

      for (
        const row of
          users.results || []
      ) {
        try {
          await sendTelegram(
            sendUrl,
            row.chat_id,
            text
          );

          sent++;
        } catch (_) {}
      }

      return `📢 پیام همگانی ارسال شد.\nتعداد تحویل موفق: <b>${sent}</b>`;
    }
  }

  if (cmd === "/user" || cmd === "/users") {
    return arg
      ? await buildUserDetail(
          db,
          arg.split(/\s+/)[0]
        )
      : await buildUsersListMessage(
          db
        );
  }

  if (cmd === "/stats") {
    if (!db) {
      return "❌ D1 متصل نیست.";
    }

    const totalMsg =
      await db
        .prepare(
          `SELECT COUNT(*) AS count FROM messages`
        )
        .first();

    const totalUsers =
      await db
        .prepare(
          `SELECT COUNT(DISTINCT chat_id) AS count FROM messages`
        )
        .first();

    const startOfDay =
      new Date();

    startOfDay.setHours(
      0,
      0,
      0,
      0
    );

    const todayMsg =
      await db
        .prepare(
          `SELECT COUNT(*) AS count FROM messages WHERE created_at >= ?`
        )
        .bind(
          startOfDay.getTime()
        )
        .first();

    return `📊 <b>آمار و عملکرد ربات</b>\n───────────────────\n👥 <b>کل کاربران:</b> ${totalUsers?.count || 0}\n💬 <b>کل پیام‌ها:</b> ${totalMsg?.count || 0}\n⚡ <b>پیام‌های امروز:</b> ${todayMsg?.count || 0}\n⚙️ <b>مدل فعلی:</b> <code>${escapeHtml(memory.selectedModel || MODEL)}</code>\n🧠 <b>تعداد مدل‌ها:</b> ${memory.models.length}`;
  }

  if (cmd === "/debug") {
    return await runDiagnostics(
      env
    );
  }

  return null;
}

/* ───────────────────────── CALLBACK HANDLER ───────────────────────── */

async function handleCallback(
  query,
  env
) {
  const data =
    String(
      query?.data || ""
    );

  const chatId =
    String(
      query.message?.chat?.id || ""
    );

  const callbackUrl =
    `${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;

  const sendUrl =
    `${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  if (getDB(env)) {
    try {
      const settings =
        await loadBotSettings(
          getDB(env)
        );

      const storedModels =
        parseModelList(
          settings.models
        );

      if (storedModels.length) {
        memory.models =
          storedModels;
      } else if (settings.model) {
        memory.models =
          normalizeModelList(
            [settings.model]
          );
      }

      if (
        settings.model &&
        String(settings.model).trim()
      ) {
        memory.selectedModel =
          String(settings.model).trim();
      } else if (
        !memory.selectedModel ||
        !memory.models.includes(
          memory.selectedModel
        )
      ) {
        memory.selectedModel =
          memory.models[0] ||
          MODEL;
      }
    } catch (_) {}
  }

  if (
    chatId === ADMIN_ID &&
    data.startsWith("admin:")
  ) {
    await telegramRequest(
      callbackUrl,
      {
        callback_query_id:
          query.id
      }
    );

    if (data.startsWith("admin:model:")) {
      const index =
        Number.parseInt(
          data.slice("admin:model:".length),
          10
        );

      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= memory.models.length
      ) {
        await sendTelegram(
          sendUrl,
          chatId,
          "❌ مدل انتخاب‌شده معتبر نیست."
        );
        return;
      }

      memory.selectedModel =
        memory.models[index];

      if (getDB(env)) {
        await setBotSetting(
          getDB(env),
          "model",
          memory.selectedModel
        );
      }

      await sendTelegram(
        sendUrl,
        chatId,
        `✅ مدل فعال شد:\n<code>${escapeHtml(memory.selectedModel)}</code>`
      );

      return;
    }

    const action =
      data.split(":")[1];

    if (action === "user") {
      const userId =
        data.slice("admin:user:".length);

      await sendTelegram(
        sendUrl,
        chatId,
        await buildUserDetail(
          getDB(env),
          userId
        )
      );

      return;
    }

    if (action === "stats") {
      const res =
        await handleAdminCommand(
          "/stats",
          getDB(env),
          sendUrl,
          chatId,
          env
        );

      await sendTelegram(
        sendUrl,
        chatId,
        res
      );

      return;
    }

    if (action === "users") {
      const users =
        await loadUserProfiles(
          getDB(env)
        );

      await sendTelegram(
        sendUrl,
        chatId,
        await buildUsersListMessage(
          getDB(env)
        ),
        {
          reply_markup:
            buildUsersKeyboard(users)
        }
      );

      return;
    }

    if (data === "admin:delete_model") {
      const models = normalizeModelList(memory.models);

      if (models.length <= 1) {
        await sendTelegram(
          sendUrl,
          chatId,
          "❌ حداقل یک مدل باید باقی بماند."
        );
        return;
      }

      const keyboard = {
        inline_keyboard: models.map((model, index) => [
          {
            text: `🗑 ${model}`.slice(0, 60),
            callback_data: `admin:delete_model:${index}`
          }
        ])
      };

      await sendTelegram(
        sendUrl,
        chatId,
        "🗑 <b>مدلی که می‌خواهی حذف شود را انتخاب کن:</b>",
        { reply_markup: keyboard }
      );
      return;
    }

    if (data.startsWith("admin:delete_model:")) {
      const index = Number.parseInt(data.slice("admin:delete_model:".length), 10);
      const models = normalizeModelList(memory.models);

      if (!Number.isInteger(index) || index < 0 || index >= models.length) {
        await sendTelegram(sendUrl, chatId, "❌ مدل انتخاب‌شده معتبر نیست.");
        return;
      }

      if (models.length <= 1) {
        await sendTelegram(sendUrl, chatId, "❌ حداقل یک مدل باید باقی بماند.");
        return;
      }

      const removed = models[index];
      models.splice(index, 1);
      memory.models = models;

      if (!memory.models.includes(memory.selectedModel)) {
        memory.selectedModel = memory.models[0];
      }

      if (getDB(env)) {
        await setBotSetting(getDB(env), "models", JSON.stringify(memory.models));
        await setBotSetting(getDB(env), "model", memory.selectedModel);
      }

      await sendTelegram(
        sendUrl,
        chatId,
        `🗑 مدل <code>${escapeHtml(removed)}</code> حذف شد.\n\n${formatModelsList()}`
      );
      return;
    }

    if (action === "delete_vision_model") {
      memory.selectedVisionModel = VISION_MODEL;

      if (getDB(env)) {
        await setBotSetting(getDB(env), "vision_model", "");
      }

      await sendTelegram(
        sendUrl,
        chatId,
        `🗑 مدل عکس حذف شد و مدل پیش‌فرض فعال شد:\n<code>${escapeHtml(VISION_MODEL)}</code>`
      );
      return;
    }

    if (action === "current_model") {
      await sendTelegram(
        sendUrl,
        chatId,
        buildModelPickerMessage(),
        {
          reply_markup:
            buildModelKeyboard()
        }
      );

      return;
    }

    if (action === "toggle_maint") {
      memory.maintenance =
        !memory.maintenance;

      if (getDB(env)) {
        await setBotSetting(
          getDB(env),
          "maintenance",
          memory.maintenance
            ? "on"
            : "off"
        );
      }

      await sendTelegram(
        sendUrl,
        chatId,
        memory.maintenance
          ? "🛠 حالت تعمیرات فعال شد."
          : "✅ حالت تعمیرات غیرفعال شد."
      );

      return;
    }

    if (action === "debug") {
      const report =
        await runDiagnostics(
          env
        );

      await sendTelegram(
        sendUrl,
        chatId,
        report
      );

      return;
    }

    if (action === "close") {
      if (
        query.message?.message_id
      ) {
        await deleteTelegramMessage(
          sendUrl,
          chatId,
          query.message.message_id
        ).catch(
          () => null
        );
      }

      return;
    }

    const stateMap = {
      setmodel_prompt: [
        "WAIT_SETMODEL",
        "✏️ شناسه مدل را ارسال کنید. می‌توانید چند مدل را هر کدام در یک خط یا با کاما وارد کنید:"
      ],
      ban_prompt: [
        "WAIT_BAN",
        "🚫 شناسه (Chat ID) کاربر برای مسدودسازی را ارسال کنید:"
      ],
      unban_prompt: [
        "WAIT_UNBAN",
        "✅ شناسه (Chat ID) کاربر برای آن‌بن را ارسال کنید:"
      ],
      info_prompt: [
        "WAIT_INFO",
        "👤 شناسه (Chat ID) کاربر را برای دریافت اطلاعات ارسال کنید:"
      ],
      mem_prompt: [
        "WAIT_MEM",
        "🧠 شناسه (Chat ID) کاربر را برای مشاهده حافظه ارسال کنید:"
      ],
      clear_mem_prompt: [
        "WAIT_CLEAR_MEM",
        "🧹 شناسه (Chat ID) کاربر را برای پاکسازی حافظه ارسال کنید:"
      ],
      limit_prompt: [
        "WAIT_LIMIT",
        "🚦 عدد محدودیت روزانه را وارد کنید (0 یعنی نامحدود):"
      ],
      broadcast_prompt: [
        "WAIT_BROADCAST",
        "📢 متن پیام همگانی را ارسال کنید:"
      ],
      vision_model_prompt: [
        "WAIT_VISION_MODEL",
        `🖼️ شناسه مدل Vision را ارسال کنید. مثال: <code>${escapeHtml(VISION_MODEL)}</code>`
      ]
    };

    if (stateMap[action]) {
      const [
        st,
        msg
      ] =
        stateMap[action];

      memory.adminState[
        chatId
      ] = st;

      if (getDB(env)) {
        await setBotSetting(
          getDB(env),
          `admin_state_${chatId}`,
          st
        );
      }

      await sendTelegram(
        sendUrl,
        chatId,
        msg
      );

      return;
    }
  }

  if (
    data === "ai:translate" ||
    data === "ai:summarize"
  ) {
    await telegramRequest(
      callbackUrl,
      {
        callback_query_id:
          query.id,
        text: "در حال پردازش..."
      }
    );

    const result =
      await handleAiAction(
        data === "ai:translate"
          ? "translate"
          : "summarize",
        query.message?.message_id,
        query,
        env
      );

    await sendTelegram(
      sendUrl,
      chatId,
      result
    );

    return;
  }

  await telegramRequest(
    callbackUrl,
    {
      callback_query_id:
        query.id
    }
  );
}

/* ───────────────────────── DATABASE HELPERS ───────────────────────── */

async function ensureDatabase(db) {
  if (!db) return;

  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS processed_updates (update_id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL)`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS banned_users (chat_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS bot_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS user_memory (chat_id TEXT PRIMARY KEY, memory TEXT NOT NULL, updated_at INTEGER NOT NULL)`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS user_settings (chat_id TEXT PRIMARY KEY, personality TEXT NOT NULL, updated_at INTEGER NOT NULL)`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS user_profiles (user_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, first_name TEXT, last_name TEXT, username TEXT, updated_at INTEGER NOT NULL)`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS ai_replies (message_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS debug_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, message TEXT, area TEXT, error TEXT, created_at INTEGER NOT NULL)`
    )
  ]);
}

async function saveDebugLogSafe(
  db,
  area,
  error
) {
  if (!db) return;

  try {
    await db
      .prepare(
        `INSERT INTO debug_logs (area, error, created_at) VALUES (?, ?, ?)`
      )
      .bind(
        String(area || ""),
        String(error || ""),
        Date.now()
      )
      .run();
  } catch (_) {}
}

async function saveDebugLog(
  db,
  source,
  message
) {
  if (!db) return;

  try {
    await db
      .prepare(
        `INSERT INTO debug_logs (source, message, area, error, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        String(source || ""),
        String(message || ""),
        String(source || ""),
        String(message || ""),
        Date.now()
      )
      .run();
  } catch (_) {}
}

async function claimUpdate(
  db,
  id
) {
  if (!db) {
    if (
      memory.processedUpdates.has(
        id
      )
    ) {
      return false;
    }

    memory.processedUpdates.add(
      id
    );

    if (
      memory.processedUpdates.size >
      5000
    ) {
      const first =
        memory.processedUpdates
          .values()
          .next()
          .value;

      memory.processedUpdates.delete(
        first
      );
    }

    return true;
  }

  try {
    await db
      .prepare(
        `INSERT INTO processed_updates (update_id, created_at) VALUES (?, ?)`
      )
      .bind(
        id,
        Date.now()
      )
      .run();

    return true;
  } catch (error) {
    if (
      memory.processedUpdates.has(
        id
      )
    ) {
      return false;
    }

    memory.processedUpdates.add(
      id
    );

    return true;
  }
}

async function clearHistory(
  db,
  chatId
) {
  if (!db) return;

  try {
    await db
      .prepare(
        "DELETE FROM messages WHERE chat_id = ?"
      )
      .bind(
        String(chatId)
      )
      .run();
  } catch (_) {}
}

async function saveMessage(
  db,
  chatId,
  role,
  content
) {
  if (!db) return;

  try {
    let textContent =
      typeof content === "string"
        ? content
        : JSON.stringify(
            content
          );

    await db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)`
      )
      .bind(
        String(chatId),
        role,
        textContent,
        Date.now()
      )
      .run();

    await trimHistory(
      db,
      chatId
    );
  } catch (error) {
    await saveDebugLog(
      db,
      "saveMessage",
      formatError(error)
    );
  }
}

async function trimHistory(
  db,
  chatId
) {
  if (!db) return;

  try {
    const cutoff =
      await db
        .prepare(
          `SELECT id FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?`
        )
        .bind(
          String(chatId),
          MAX_HISTORY - 1
        )
        .first();

    if (cutoff?.id) {
      await db
        .prepare(
          `DELETE FROM messages WHERE chat_id = ? AND id < ?`
        )
        .bind(
          String(chatId),
          cutoff.id
        )
        .run();
    }
  } catch (error) {
    await saveDebugLog(
      db,
      "trimHistory",
      formatError(error)
    );
  }
}

async function loadHistory(
  db,
  chatId
) {
  if (!db) return [];

  try {
    const result =
      await db
        .prepare(
          `SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?`
        )
        .bind(
          String(chatId),
          MAX_HISTORY
        )
        .all();

    return (
      result?.results || []
    )
      .reverse()
      .map(row => ({
        role: row.role,
        content: row.content
      }));
  } catch (error) {
    await saveDebugLog(
      db,
      "loadHistory",
      formatError(error)
    );

    return [];
  }
}

async function isBanned(
  db,
  chatId
) {
  if (!db) return false;

  try {
    const result =
      await db
        .prepare(
          `SELECT chat_id FROM banned_users WHERE chat_id = ?`
        )
        .bind(
          String(chatId)
        )
        .first();

    return Boolean(
      result?.chat_id
    );
  } catch (_) {
    return false;
  }
}

/* ───────────────────────── AI & SEARCH CORE ───────────────────────── */

function getSearchPlan(
  text
) {
  const cleanText =
    String(text || "").trim();

  const url =
    extractUrl(cleanText);

  const domain =
    extractDomain(
      url || cleanText
    );

  const explicitSearch =
    /(search|جستجو|جست‌وجو|سرچ|بگرد|پیدا کن|پیداش کن|بررسی کن|چک کن|راستی.?آزمایی|استعلام|وب|اینترنت|internet|google|گوگل|news|خبر|اخبار|منبع|منابع|source|لینک|link|سایت|سایت.?نامه|وب.?سایت|website|web)/i
      .test(cleanText);

  // Requests that clearly point to an external site/source should always
  // trigger web research, even when the user does not literally say
  // "search". Examples: "برو همیار ...", "از ویکی ...", "تو سایت ...".
  const externalSourceRequest =
    /(برو|از|تو|در|روی|داخل|طبق|از روی|بر اساس).{0,80}(همیار|همیاردرس|ویکی.?پدیا|آپارات|یوتیوب|گوگل|سایت|وب.?سایت|صفحه|منبع|پایگاه|دانشنامه|hamyar|wikipedia|youtube|google|website|site)/i
      .test(cleanText) ||
    /(همیار|همیاردرس|ویکی.?پدیا|آپارات|یوتیوب|hamyar|wikipedia|youtube).{0,100}(سوال|درس|جواب|پاسخ|مطلب|اطلاعات|متن|تمرین|نمونه)/i
      .test(cleanText);

  // Educational lookup requests are usually source-dependent (for example,
  // textbook questions or a lesson's "سوالات متن"), so research them instead
  // of answering from model memory.
  const educationalLookup =
    /(سوالات? متن|جواب سوالات?|پاسخ سوالات?|نمونه سوال|تمرین(?:ات)?|درس(?:نامه)?|کتاب درسی|صفحه\s*\d+|فصل\s*\d+|درس\s*\d+|پایه\s*(?:هفتم|هشتم|نهم|دهم|یازدهم|دوازدهم|7|8|9|10|11|12)|آزمون|امتحان)/i
      .test(cleanText);

  const current =
    /(امروز|الان|همین الان|فعلی|کنونی|لحظه‌ای|لحظه اي|جدیدترین|آخرین|به‌روز|بروز|today|now|right now|current|latest|recent|live|real[\s-]?time)/i
      .test(cleanText);

  const priceSensitive =
    /(قیمت|نرخ|ارزش|مبلغ|هزینه|بازار|دلار|usd|یورو|eur|euro|پوند|gbp|درهم|aed|طلا|gold|سکه|تتر|usdt|بیت.?کوین|bitcoin|crypto|رمزارز|ارز|نفت|oil|بنزین|fuel|سهام|stock|بورس|price|rate|exchange|market value)/i
      .test(cleanText);

  const dateTime =
    /(تاریخ|ساعت|زمان|امروز چه روزی|امروز چندمه|چه ساعتی|date|time|timezone|clock)/i
      .test(cleanText);

  // A URL is always a search request. Explicit search requests and
  // time-sensitive/price/date-time questions are also always searched.
  const needsResearch =
    /(کیه|کیست|چیست|چیه|چطور|چگونه|چرا|کدام|کدوم|مقایسه|مقایسه کن|بررسی|لیست|اطلاعات|آیا|واقعاً|درسته|درست است|منبع|منابع|استناد|reference|compare|who is|what is|how to|why|which)/i
      .test(cleanText);

  const search =
    Boolean(
      url ||
      explicitSearch ||
      externalSourceRequest ||
      educationalLookup ||
      current ||
      priceSensitive ||
      dateTime ||
      needsResearch
    );

  let query =
    cleanText;

  if (url) {
    query =
      `Check and verify this exact URL and what the user asks about it: ${url}. ${cleanText}`;
  }

  if (priceSensitive) {
    if (/(دلار|usd|dollar)/i.test(cleanText)) {
      query =
        `${cleanText} قیمت دلار بازار آزاد ایران امروز current live USD IRR toman rial latest verified`;
    } else if (/(طلا|gold|سکه|coin)/i.test(cleanText)) {
      query =
        `${cleanText} قیمت طلا و سکه ایران امروز current live latest verified market price`;
    } else if (/(تتر|usdt|بیت.?کوین|bitcoin|crypto|رمزارز)/i.test(cleanText)) {
      query =
        `${cleanText} current live cryptocurrency price latest verified`;
    } else if (/(یورو|eur|euro|پوند|gbp|درهم|aed|ارز|exchange)/i.test(cleanText)) {
      query =
        `${cleanText} current live exchange rate today latest verified`;
    } else {
      query =
        `${cleanText} current latest verified market price rate today`;
    }
  }

  if (dateTime) {
    query =
      `${cleanText} current exact date and time today timezone latest verified`;
  }

  const queries = [];

  const addQuery = value => {
    const q =
      String(value || "").trim();

    if (
      q &&
      !queries.some(
        item => item.toLowerCase() === q.toLowerCase()
      )
    ) {
      queries.push(q);
    }
  };

  addQuery(query);

  if (!url) {
    if (priceSensitive && /(دلار|usd|dollar)/i.test(cleanText)) {
      addQuery(`USD Iran free market today latest verified ${cleanText}`);
      addQuery(`قیمت دلار آزاد امروز تومان TGJU Bonbast current ${cleanText}`);
      addQuery(`Iran USD toman exchange rate today current ${cleanText}`);
    } else if (priceSensitive && /(طلا|gold|سکه|coin)/i.test(cleanText)) {
      addQuery(`قیمت طلا سکه ایران امروز current live ${cleanText}`);
      addQuery(`Iran gold coin price today latest verified ${cleanText}`);
    } else if (externalSourceRequest || educationalLookup || current || explicitSearch || needsResearch) {
      addQuery(`${cleanText} latest current verified source`);
      addQuery(`${cleanText} official primary source`);
      addQuery(`${cleanText} reputable source latest`);

      if (externalSourceRequest || educationalLookup) {
        addQuery(`${cleanText} site:hamyar.in`);
        addQuery(`${cleanText} سوالات متن جواب درس منبع معتبر`);
      }
    }
  }

  // For fast-changing prices, a second independent wording improves
  // source diversity and reduces the chance of trusting one stale result.
  if (priceSensitive && !url) {
    if (/(دلار|usd|dollar)/i.test(cleanText)) {
      addQuery(
        "قیمت دلار آزاد ایران امروز نرخ USD به تومان بازار تهران current live"
      );
    } else if (/(طلا|gold|سکه|coin)/i.test(cleanText)) {
      addQuery(
        "قیمت لحظه ای طلا سکه ایران امروز بازار current live"
      );
    } else {
      addQuery(
        `${cleanText} latest current live price verify source`
      );
    }
  }

  return {
    url,
    domain,
    search,
    query: queries[0] || cleanText,
    queries,
    freshness:
      current ||
      priceSensitive ||
      dateTime
        ? "oneDay"
        : "noLimit",
    priceSensitive,
    dateTime,
    explicitSearch,
    externalSourceRequest,
    educationalLookup
  };
}

function extractUrl(
  text
) {
  const match =
    String(text).match(
      /https?:\/\/[^\s<>]+/i
    );

  return match
    ? match[0].replace(
        /[)\]}>.,؛،]+$/,
        ""
      )
    : null;
}

function extractDomain(
  text
) {
  const url =
    extractUrl(text);

  if (url) {
    try {
      return new URL(url)
        .hostname
        .replace(
          /^www\./,
          ""
        );
    } catch (_) {}
  }

  const match =
    String(text).match(
      /(?:site:)?(?:www\.)?([a-z0-9-]+\.(?:com|ir|net|org|io|co|me|shop|store|ai))(?:\b|\/)/i
    );

  return match
    ? match[1].toLowerCase()
    : null;
}

async function generateAnswer(
  env,
  chatId,
  userText,
  media,
  webResults,
  openedPage,
  personalityKey,
  onChunk,
  searchContext = {}
) {
  const history =
    getDB(env)
      ? await loadHistory(
          getDB(env),
          chatId
        )
      : [];

  const messages = [];

  messages.push({
    role: "system",
    content: SYSTEM_PROMPT
  });

  for (
    const item of
      history
  ) {
    messages.push({
      role: item.role,
      content: item.content
    });
  }

  const safePersonality = PERSONALITIES[personalityKey] || PERSONALITIES.friendly;
  messages.push({
    role: "system",
    content: `شخصیت فعال: ${safePersonality}. همیشه اول و دقیقاً به درخواست فعلی کاربر پاسخ بده. پاسخ قبلی را تکرار نکن و موضوع قبلی را به موضوع فعلی تحمیل نکن. از تاریخچه فقط برای فهم زمینه لازم استفاده کن. اگر شخصیت دوستانه فعال است، لحن را کاملاً خودمانی، رفیقانه، راحت، گنگ و خفن نگه دار؛ مثلاً برای «سلام» می‌توانی طبیعی و صمیمی جواب بدهی مثل «سلام مشتی 😎 چه خبر؟ چطوری؟ بگو ببینم چطور کمکت کنم». این فقط نمونهٔ لحن است و پاسخ را متناسب با پیام کاربر تغییر بده. از تکرار مصنوعی کلمات عامیانه خودداری کن.`
  });

  let currentUser =
    media &&
    media.type === "image"
      ? [
          {
            type: "text",
            text:
              userText ||
              "این عکس را با جزئیات کامل تحلیل کن."
          },
          {
            type: "image_url",
            image_url: {
              url: media.dataUrl
            }
          }
        ]
      : userText;

  messages.push({
    role: "user",
    content: currentUser
  });

  const searchStatusText =
    searchContext.searchAttempted
      ? (
          searchContext.searchSucceeded
            ? "موفق: LangSearch نتیجه وب برگردانده است."
            : `ناموفق: LangSearch نتیجه قابل اتکایی برنگردانده است. خطا: ${searchContext.searchError || "نتیجه‌ای پیدا نشد."}`
        )
      : "جستجوی وب برای این پیام لازم تشخیص داده نشد.";

  messages.push({
    role: "system",
    content:
      `وضعیت ابزار وب:\n${searchStatusText}\nزمان دریافت نتیجه در Worker (UTC): ${searchContext.retrievedAt || new Date().toISOString()}\n` +
      `اگر وضعیت ناموفق است، صادقانه بگو که نتوانستی اطلاعات معتبر را از وب دریافت کنی و هرگز عدد یا واقعیت فعلی را حدس نزن.`
  });

  if (openedPage) {
    messages.push({
      role: "system",
      content:
        `محتوای مستقیم صفحه‌ای که کاربر فرستاده است (اطلاعات تکمیلی، نه جایگزین LangSearch):\nURL: ${openedPage.url}\nمحتوا:\n${openedPage.content}`
    });
  } else if (searchContext.searchPlan?.url && searchContext.searchAttempted) {
    messages.push({
      role: "system",
      content:
        `کاربر یک URL فرستاده است اما محتوای مستقیم صفحه قابل دریافت نبود. فقط بر شواهد LangSearch تکیه کن و ادعا نکن که صفحه را مستقیم خوانده‌ای.`
    });
  }

  if (webResults.length) {
    let context =
      "نتایج جستجوی وب LangSearch — این منابع مبنای پاسخ فعلی هستند:\n";

    for (
      let i = 0;
      i < webResults.length;
      i++
    ) {
      const item =
        webResults[i];

      context +=
        `\nمنبع ${i + 1}: ${item.title}\nURL: ${item.url}\nتاریخ انتشار: ${item.publishedAt || "نامشخص"}\nزمان خزیدن: ${item.crawledAt || "نامشخص"}\nخلاصه: ${item.snippet}\nمتن صفحه: ${item.content || "در دسترس نیست"}\n`;
    }

    messages.push({
      role: "system",
      content: context
    });
  }

  const availableModels =
    normalizeModelList(
      memory.models
    );

  const selectedModel =
    memory.selectedModel &&
    availableModels.includes(
      memory.selectedModel
    )
      ? memory.selectedModel
      : (
          availableModels[0] ||
          MODEL
        );

  const isVisionRequest =
    media &&
    media.type === "image";

  const primaryModel =
    isVisionRequest
      ? (memory.selectedVisionModel || VISION_MODEL)
      : selectedModel;

  const fallbackModel =
    isVisionRequest
      ? VISION_FALLBACK_MODEL
      : FALLBACK_MODEL;

  // Vision requests must have an explicit small output budget.
  // Without max_tokens OpenRouter may reserve the model's full output window
  // (for example 131072 tokens), which can trigger a 402 on low credit balances.
  // Normal text requests remain uncapped unless a caller explicitly supplies a limit.
  // Keep vision output small enough for free/low-credit OpenRouter accounts.
  // Large max_tokens reservations can trigger HTTP 402 before generation starts.
  const visionMaxTokens = isVisionRequest ? 300 : undefined;

  const response =
    await askOpenRouter(
      env.OPENROUTER_API_KEY,
      messages,
      primaryModel,
      fallbackModel,
      onChunk,
      visionMaxTokens,
      searchContext.streamSignal || null
    );

  return cleanRichAnswer(response.content);
}

async function askOpenRouter(
  apiKey,
  messages,
  model = MODEL,
  fallbackModel = FALLBACK_MODEL,
  onChunk = null,
  maxTokens = null,
  signal = null
) {
  const models = [model];

  if (fallbackModel && fallbackModel !== model) {
    models.push(fallbackModel);
  }

  let lastError = "";
  let lastStatus = 0;

  for (const currentModel of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal?.aborted) {
        throw new DOMException("Generation stopped", "AbortError");
      }

      let reader = null;

      try {
        const bodyPayload = {
          model: currentModel,
          messages,
          temperature: 0.55,
          provider: { allow_fallbacks: true }
        };

        if (Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0) {
          bodyPayload.max_tokens = Math.floor(Number(maxTokens));
        }

        if (onChunk) {
          bodyPayload.stream = true;
        }

        const response = await fetchWithTimeout(
          OPENROUTER_URL,
          {
            method: "POST",
            signal,
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://dastyar.io",
              "X-Title": BOT_NAME
            },
            body: JSON.stringify(bodyPayload)
          },
          onChunk ? 300000 : 18000
        );

        lastStatus = response.status;

        if (onChunk && response.ok) {
          if (!response.body) {
            throw new Error("OpenRouter returned an empty streaming body.");
          }

          reader = response.body.getReader();
          const decoder = new TextDecoder("utf-8");
          let content = "";
          let buffer = "";
          let finishReason = null;

          const handleSseLine = async line => {
            const tLine = String(line || "").trim();
            if (!tLine.startsWith("data:") || tLine === "data: [DONE]") {
              return;
            }

            const payload = tLine.slice(5).trim();
            if (!payload || payload === "[DONE]") {
              return;
            }

            let data = null;
            try {
              data = JSON.parse(payload);
            } catch (_) {
              return;
            }

            if (signal?.aborted) {
              throw new DOMException("Generation stopped", "AbortError");
            }

            const choice = data?.choices?.[0];
            if (choice?.finish_reason) {
              finishReason = choice.finish_reason;
            }

            const delta =
              choice?.delta?.content ||
              choice?.message?.content ||
              "";

            if (delta) {
              content += delta;
              await onChunk(content);
            }
          };

          while (true) {
            if (signal?.aborted) {
              throw new DOMException("Generation stopped", "AbortError");
            }

            const { done, value } = await reader.read();

            if (done) {
              buffer += decoder.decode();
              if (buffer.trim()) {
                await handleSseLine(buffer);
              }
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || "";

            for (const line of lines) {
              await handleSseLine(line);
            }
          }

          if (!content.trim()) {
            throw new Error(
              `OpenRouter returned an empty streaming response${finishReason ? ` (${finishReason})` : ""}.`
            );
          }

          return { content };
        }

        const data = await response.json().catch(() => null);

        if (response.ok && data?.choices?.[0]?.message) {
          return {
            content: data.choices[0].message.content || ""
          };
        }

        lastError =
          data?.error?.message ||
          data?.message ||
          `HTTP ${response.status}`;
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") {
          try {
            await reader?.cancel();
          } catch (_) {}
          throw error;
        }

        lastError = formatError(error);
      } finally {
        reader = null;
      }

      if (attempt < 2) {
        await sleep(500);
      }
    }
  }

  throw new Error(`OpenRouterStatus:${lastStatus} ${lastError}`);
}

/* ───────────────────────── MEDIA & UTILS ───────────────────────── */

async function extractMedia(
  message,
  env
) {
  if (
    message?.photo &&
    Array.isArray(
      message.photo
    ) &&
    message.photo.length
  ) {
    const photo =
      message.photo[
        message.photo.length - 1
      ];

    try {
      const file =
        await getTelegramFilePath(
          env.TELEGRAM_BOT_TOKEN,
          photo.file_id
        );

      if (!file) {
        return null;
      }

      const dataUrl =
        await downloadTelegramFileAsDataUrl(
          env.TELEGRAM_BOT_TOKEN,
          file
        );

      if (!dataUrl) {
        return null;
      }

      return {
        type: "image",
        mime: "image/jpeg",
        dataUrl
      };
    } catch (error) {
      await saveDebugLog(
        getDB(env),
        "image",
        formatError(error)
      );

      return null;
    }
  }

  return null;
}

async function getTelegramFilePath(
  token,
  fileId
) {
  const meta =
    await fetchWithTimeout(
      `${TELEGRAM_API}${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
      {},
      7000
    )
      .then(r => r.json())
      .catch(
        () => null
      );

  if (
    !meta?.ok ||
    !meta.result?.file_path
  ) {
    return null;
  }

  return {
    filePath:
      meta.result.file_path,
    downloadUrl:
      `https://api.telegram.org/file/bot${token}/${meta.result.file_path}`
  };
}

async function downloadTelegramFileAsDataUrl(
  token,
  file
) {
  if (!file?.downloadUrl) {
    return null;
  }

  const response =
    await fetchWithTimeout(
      file.downloadUrl,
      {},
      15000
    );

  if (!response.ok) {
    throw new Error(
      `Telegram file download HTTP ${response.status}`
    );
  }

  const buffer =
    await response.arrayBuffer();

  const bytes =
    new Uint8Array(
      buffer
    );

  let binary = "";

  const chunkSize =
    0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += chunkSize
  ) {
    binary +=
      String.fromCharCode(
        ...bytes.subarray(
          i,
          i + chunkSize
        )
      );
  }

  return (
    "data:image/jpeg;base64," +
    btoa(binary)
  );
}

async function loadBotSettings(
  db
) {
  if (!db) return {};

  try {
    const rows =
      await db
        .prepare(
          "SELECT key, value FROM bot_settings"
        )
        .all();

    const out = {};

    for (
      const row of
        rows.results || []
    ) {
      out[row.key] =
        row.value;
    }

    return out;
  } catch (error) {
    return {};
  }
}

async function setBotSetting(
  db,
  key,
  value
) {
  if (!db) return;

  try {
    await db
      .prepare(
        `INSERT OR REPLACE INTO bot_settings (key, value, updated_at) VALUES (?, ?, ?)`
      )
      .bind(
        String(key),
        String(value),
        Date.now()
      )
      .run();
  } catch (error) {}
}

function normalizeModelList(
  models
) {
  const source =
    Array.isArray(models)
      ? models
      : String(models || "").split(/[\n,]+/);

  return source
    .map(model =>
      String(model || "").trim()
    )
    .filter(Boolean)
    .filter(
      (model, index, list) =>
        list.indexOf(model) === index
    );
}

function parseModelList(
  value
) {
  try {
    return normalizeModelList(
      JSON.parse(
        String(value || "")
      )
    );
  } catch (_) {
    return normalizeModelList(
      value
    );
  }
}

function formatModelsList() {
  return normalizeModelList(
    memory.models
  )
    .map(
      (model, index) =>
        `${index + 1}. ${model === memory.selectedModel ? "✅ " : ""}<code>${escapeHtml(model)}</code>`
    )
    .join("\n");
}

function buildModelKeyboard() {
  return {
    inline_keyboard:
      normalizeModelList(
        memory.models
      ).map(
        (model, index) => [
          {
            text:
              `${model === memory.selectedModel ? "✅ " : ""}${model}`.slice(0, 60),
            callback_data:
              `admin:model:${index}`
          }
        ]
      )
  };
}

function buildModelPickerMessage() {
  const selected =
    memory.selectedModel ||
    memory.models[0] ||
    MODEL;

  return `⚙️ <b>مدل‌های ربات</b>\n\n${formatModelsList()}\n\n<b>مدل فعال:</b> <code>${escapeHtml(selected)}</code>`;
}

function safeDisplayName(
  user
) {
  const first =
    String(user?.first_name || "")
      .trim();

  const last =
    String(user?.last_name || "")
      .trim();

  return (
    [first, last]
      .filter(Boolean)
      .join(" ") ||
    (user?.username
      ? `@${String(user.username)}`
      : "بدون نام")
  );
}

async function upsertUserProfile(
  db,
  message,
  chatId
) {
  const user =
    message?.from;

  if (!user?.id) {
    return;
  }

  const userId =
    String(user.id);

  memory.userProfiles[userId] = {
    user_id: userId,
    chat_id: String(chatId),
    first_name:
      String(user.first_name || ""),
    last_name:
      String(user.last_name || ""),
    username:
      String(user.username || ""),
    updated_at:
      Date.now()
  };

  if (!db) {
    return;
  }

  try {
    await db
      .prepare(
        `INSERT OR REPLACE INTO user_profiles (user_id, chat_id, first_name, last_name, username, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        userId,
        String(chatId),
        String(user.first_name || ""),
        String(user.last_name || ""),
        String(user.username || ""),
        Date.now()
      )
      .run();
  } catch (error) {
    await saveDebugLog(
      db,
      "upsertUserProfile",
      formatError(error)
    );
  }
}

async function loadUserProfiles(
  db
) {
  if (!db) {
    return Object.values(
      memory.userProfiles || {}
    ).sort(
      (a, b) =>
        Number(b.updated_at || 0) -
        Number(a.updated_at || 0)
    );
  }

  try {
    const result =
      await db
        .prepare(
          `SELECT user_id, chat_id, first_name, last_name, username, updated_at FROM user_profiles ORDER BY updated_at DESC LIMIT 100`
        )
        .all();

    return (
      result?.results ||
      []
    );
  } catch (error) {
    await saveDebugLog(
      db,
      "loadUserProfiles",
      formatError(error)
    );

    return Object.values(
      memory.userProfiles || {}
    );
  }
}

async function buildUsersListMessage(
  db
) {
  const users =
    await loadUserProfiles(
      db
    );

  if (!users.length) {
    return "👥 <b>کاربری ثبت نشده است.</b>";
  }

  const lines =
    users.slice(0, 40).map(
      (user, index) => {
        const username =
          user.username
            ? ` • @${escapeHtml(user.username)}`
            : "";

        return `${index + 1}. <b>${escapeHtml(safeDisplayName(user))}</b>${username}\n   🆔 <code>${escapeHtml(user.user_id)}</code>`;
      }
    );

  const extra =
    users.length > 40
      ? `\n\n... و ${users.length - 40} کاربر دیگر`
      : "";

  return `👥 <b>لیست کاربران</b>\nتعداد ثبت‌شده: <b>${users.length}</b>\n\n${lines.join("\n")}${extra}`;
}

function buildUsersKeyboard(
  users
) {
  return {
    inline_keyboard:
      (users || [])
        .slice(0, 40)
        .map(
          (user, index) => [
            {
              text:
                `${index + 1}. ${safeDisplayName(user)}`.slice(0, 60),
              callback_data:
                `admin:user:${String(user.user_id)}`.slice(0, 64)
            }
          ]
        )
  };
}

async function buildUserDetail(
  db,
  userId
) {
  const id =
    String(userId || "").trim();

  const user =
    (await loadUserProfiles(db))
      .find(
        row =>
          String(row.user_id) === id
      );

  if (!user) {
    return `❌ کاربری با شناسه <code>${escapeHtml(id)}</code> پیدا نشد.`;
  }

  const count =
    db
      ? await db
          .prepare(
            `SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?`
          )
          .bind(
            String(user.chat_id)
          )
          .first()
      : null;

  return `👤 <b>اطلاعات کاربر</b>\n\n<b>نام:</b> ${escapeHtml(safeDisplayName(user))}\n<b>آیدی عددی:</b> <code>${escapeHtml(user.user_id)}</code>\n<b>Username:</b> ${user.username ? `@${escapeHtml(user.username)}` : "ندارد"}\n<b>Chat ID:</b> <code>${escapeHtml(user.chat_id)}</code>\n<b>تعداد پیام:</b> <b>${count?.n || 0}</b>`;
}

async function maybeSaveLongTermMemory(
  db,
  chatId,
  text,
  answer
) {
  if (
    !db ||
    !text
  ) {
    return;
  }

  if (
    !/(یادت باشه|به خاطر بسپار|اسم من|remember)/i.test(
      text
    )
  ) {
    return;
  }

  try {
    const old =
      await db
        .prepare(
          "SELECT memory FROM user_memory WHERE chat_id = ?"
        )
        .bind(
          String(chatId)
        )
        .first();

    let memoryText =
      [
        old?.memory || "",
        text
      ]
        .filter(Boolean)
        .join("\n");

    await db
      .prepare(
        `INSERT OR REPLACE INTO user_memory (chat_id, memory, updated_at) VALUES (?, ?, ?)`
      )
      .bind(
        String(chatId),
        memoryText,
        Date.now()
      )
      .run();
  } catch (error) {}
}

async function loadUserMemory(
  db,
  chatId
) {
  if (!db) return "";

  try {
    const row =
      await db
        .prepare(
          "SELECT memory FROM user_memory WHERE chat_id = ?"
        )
        .bind(
          String(chatId)
        )
        .first();

    return (
      row?.memory || ""
    );
  } catch (error) {
    return "";
  }
}

async function checkRateLimit(
  db,
  chatId
) {
  const now =
    Date.now();

  const list =
    memory.rates[
      chatId
    ] || [];

  while (
    list.length &&
    now - list[0] >
      RATE_LIMIT_WINDOW
  ) {
    list.shift();
  }

  if (
    list.length >=
    RATE_LIMIT_COUNT
  ) {
    return false;
  }

  list.push(now);

  memory.rates[
    chatId
  ] = list;

  const dailyLimit =
    await getDailyRateLimit(
      db
    );

  if (
    dailyLimit > 0 &&
    db
  ) {
    try {
      const start =
        new Date();

      start.setHours(
        0,
        0,
        0,
        0
      );

      const row =
        await db
          .prepare(
            `SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND role = 'user' AND created_at >= ?`
          )
          .bind(
            String(chatId),
            start.getTime()
          )
          .first();

      if (
        Number(
          row?.n || 0
        ) >= dailyLimit
      ) {
        return false;
      }
    } catch (_) {}
  }

  return true;
}

async function getDailyRateLimit(
  db
) {
  if (!db) {
    return DEFAULT_DAILY_LIMIT;
  }

  try {
    const row =
      await db
        .prepare(
          `SELECT value FROM bot_settings WHERE key = 'daily_limit'`
        )
        .first();

    const value =
      Number(
        row?.value
      );

    return Number.isFinite(
      value
    )
      ? Math.max(
          0,
          value
        )
      : DEFAULT_DAILY_LIMIT;
  } catch (_) {
    return DEFAULT_DAILY_LIMIT;
  }
}

function resolvePersonalityKey(input) {
  const value = String(input || "").trim().toLowerCase();
  const aliases = {
    friendly: "friendly", "دوستانه": "friendly",
    professional: "professional", "حرفه‌ای": "professional", "حرفه اي": "professional",
    teacher: "teacher", "معلم": "teacher", "آموزشی": "teacher",
    concise: "concise", "کوتاه": "concise",
    creative: "creative", "خلاق": "creative",
    technical: "technical", "فنی": "technical"
  };
  return aliases[value] || null;
}

function formatPersonalityOptions() {
  return Object.keys(PERSONALITIES).map(key => `• <code>${key}</code> — ${PERSONALITY_LABELS[key]}`).join("\n");
}

async function setUserPersonality(db, chatId, personality) {
  const resolved = resolvePersonalityKey(personality) || "friendly";
  if (!db) return resolved;
  try {
    await db.prepare(`INSERT OR REPLACE INTO user_settings (chat_id, personality, updated_at) VALUES (?, ?, ?)`).bind(String(chatId), resolved, Date.now()).run();
  } catch (error) {
    await saveDebugLog(db, "setUserPersonality", formatError(error));
  }
  return resolved;
}

async function buildPersonalityMessage(db, chatId) {
  const current = await getUserPersonality(db, chatId);
  return `🎭 <b>شخصیت فعلی:</b> ${escapeHtml(PERSONALITY_LABELS[current] || PERSONALITY_LABELS.friendly)}\n\nبرای تغییر: <code>/personality teacher</code>\n\n${formatPersonalityOptions()}`;
}

function buildPublicModelsMessage() {
  const models = normalizeModelList(memory.models);
  const list = models.length ? models.map((model, index) => `${index + 1}. ${model === memory.selectedModel ? "✅ " : ""}<code>${escapeHtml(model)}</code>`).join("\n") : `<code>${escapeHtml(MODEL)}</code>`;
  return `🤖 <b>مدل‌های در دسترس</b>\n\n${list}\n\n🖼 <b>مدل Vision:</b> <code>${escapeHtml(memory.selectedVisionModel || VISION_MODEL)}</code>`;
}

function appendSourceFooter(answer) {
  return String(answer || "").trim();
}

async function getUserPersonality(
  db,
  chatId
) {
  if (!db) {
    return "friendly";
  }

  try {
    const row =
      await db
        .prepare(
          `SELECT personality FROM user_settings WHERE chat_id = ?`
        )
        .bind(
          String(chatId)
        )
        .first();

    return (
      row?.personality ||
      "friendly"
    );
  } catch (_) {
    return "friendly";
  }
}

/* ───────────────────────── TELEGRAM REQUEST HELPERS ───────────────────────── */

async function telegramRequest(
  url,
  body
) {
  const response =
    await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify(body)
      },
      15000
    );

  const raw =
    await response.text();

  let data = null;

  try {
    data =
      raw
        ? JSON.parse(raw)
        : null;
  } catch (_) {}

  if (
    !response.ok ||
    data?.ok === false
  ) {
    throw new Error(
      `Telegram HTTP ${response.status}: ${data?.description || raw.slice(0, 500)}`
    );
  }

  return data;
}

function hasPersian(
  text
) {
  return /[\u0600-\u06FF]/.test(
    String(text || "")
  );
}

function isRichHtml(
  text
) {
  return /<\/?(?:h[1-6]|p|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|details|summary|mark|del|s|u|ins|sub|sup|aside|footer|hr|tg-thinking|tg-spoiler|tg-reference|tg-emoji|tg-time|tg-math|tg-math-block|tg-map|tg-collage|tg-slideshow|figure|figcaption|video|audio|img)(?:\s[^>]*)?>/i.test(
    String(text || "")
  );
}

function richHtmlToMarkdown(
  text
) {
  let source =
    cleanRichAnswer(
      text
    );

  const protectedBlocks = [];
  source = source.replace(
    /```[\s\S]*?```/g,
    match => {
      const token = `\u0003${protectedBlocks.length}\u0004`;
      protectedBlocks.push(match);
      return token;
    }
  );

  // Convert common model-produced HTML into Rich Markdown so unsupported or
  // half-written HTML tags can never leak into the visible Telegram message.
  source = source.replace(/<br\s*\/?>(?:\r?\n)?/gi, "\n");
  source = source.replace(/<\/?(?:p|div|section|article)\s*[^>]*>/gi, "\n");
  source = source.replace(/<h[1-6]\s*[^>]*>([\s\S]*?)<\/h[1-6]>/gi, "\n**$1**\n");
  source = source.replace(/<strong\s*[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  source = source.replace(/<b\s*[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  source = source.replace(/<em\s*[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  source = source.replace(/<i\s*[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
  source = source.replace(/<u\s*[^>]*>([\s\S]*?)<\/u>/gi, "__$1__");
  source = source.replace(/<ins\s*[^>]*>([\s\S]*?)<\/ins>/gi, "__$1__");
  source = source.replace(/<del\s*[^>]*>([\s\S]*?)<\/del>/gi, "~~$1~~");
  source = source.replace(/<s(?:trike)?\s*[^>]*>([\s\S]*?)<\/s(?:trike)?>(?=\s|$)/gi, "~~$1~~");
  source = source.replace(/<span\s+class=["']tg-spoiler["']\s*[^>]*>([\s\S]*?)<\/span>/gi, "||$1||");
  source = source.replace(/<tg-spoiler\s*[^>]*>([\s\S]*?)<\/tg-spoiler>/gi, "||$1||");
  source = source.replace(/<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  source = source.replace(/<blockquote\s*[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, body) => {
    const lines = String(body).trim().split(/\r?\n/);
    return lines.map(line => `> ${line}`).join("\n");
  });
  source = source.replace(/<tg-emoji\s+[^>]*>([\s\S]*?)<\/tg-emoji>/gi, "$1");
  source = source.replace(/<tg-time\s+[^>]*>([\s\S]*?)<\/tg-time>/gi, "$1");

  source = source.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, tableBody) => {
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRe.exec(String(tableBody))) !== null) {
      const cells = [];
      const cellRe = /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
      let cellMatch;

      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        const cell = String(cellMatch[1])
          .replace(/<br\s*\/?>(?:\r?\n)?/gi, " ")
          .replace(/<[^>]+>/g, "")
          .replace(/\|/g, "\\|")
          .replace(/\r?\n/g, " ")
          .trim();
        cells.push(cell);
      }

      if (cells.length) {
        rows.push(cells);
      }
    }

    if (!rows.length) {
      return tableBody;
    }

    const width = Math.max(...rows.map(row => row.length));
    const normalized = rows.map(row => {
      while (row.length < width) row.push("");
      return row;
    });

    const header = `| ${normalized[0].join(" | ")} |`;
    const divider = `| ${normalized[0].map(() => "---").join(" | ")} |`;
    const body = normalized
      .slice(1)
      .map(row => `| ${row.join(" | ")} |`)
      .join("\n");

    return body
      ? `\n${header}\n${divider}\n${body}\n`
      : `\n${header}\n${divider}\n`;
  });

  // Convert pre/code HTML while keeping code content readable.
  source = source.replace(/<pre\s*[^>]*>\s*<code(?:\s+[^>]*)?>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_, code) => `\n\`\`\`\n${code}\n\`\`\`\n`);
  source = source.replace(/<pre\s*[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => `\n\`\`\`\n${code}\n\`\`\`\n`);
  source = source.replace(/<code\s*[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // Any remaining HTML-like markup is not safe to pass through as visible HTML.
  source = source.replace(/<\/?[A-Za-z][^>]*>/g, "");
  source = source.replace(/\n{3,}/g, "\n\n").trim();

  for (let i = 0; i < protectedBlocks.length; i++) {
    source = source.replace(`\u0003${i}\u0004`, protectedBlocks[i]);
  }

  return source;
}

function buildRichMessageInput(
  text
) {
  const source =
    cleanRichAnswer(
      text
    );

  // Native Telegram progress blocks (Thinking/Search/Vision) use Rich HTML
  // because they rely on Telegram-specific tags such as <tg-thinking> and
  // <tg-emoji>. Keep those intact. AI-generated answer content uses Rich
  // Markdown instead, which is safer for streamed/partial text and prevents
  // raw HTML tags from ever appearing in the chat.
  if (/\<tg-thinking\b/i.test(source)) {
    return {
      html: source,
      is_rtl:
        hasPersian(
          source
        )
    };
  }

  const markdown =
    richHtmlToMarkdown(
      source
    );

  return {
    markdown,
    is_rtl:
      hasPersian(
        markdown
      ),
    skip_entity_detection: false
  };
}

function getBotApiUrl(
  sendUrl,
  method
) {
  const match =
    String(sendUrl || "")
      .match(
        /^(https:\/\/api\.telegram\.org\/bot[^/]+)/
      );

  if (match) {
    return `${match[1]}/${method}`;
  }

  return String(
    sendUrl || ""
  ).replace(
    /\/[^/]+$/,
    `/${method}`
  );
}


function chooseUserReaction(text, message = null) {
  const value = String(
    text ||
    message?.caption ||
    message?.text ||
    ""
  ).trim().toLowerCase();

  if (message?.photo || message?.document) {
    if (!value) return "👀";
  }

  if (!value) return "👍";

  const groups = [
    { emoji: "👋", re: /(^|\s)(سلام|درود|های|hello|hi|hey|صبح بخیر|شب بخیر)(\s|$)/i },
    { emoji: "🙏", re: /(ممنون|مرسی|تشکر|سپاس|دمت گرم|thank|thanks|thx|appreciate)/i },
    { emoji: "❤", re: /(دوستت دارم|عاشق|عشق|love|lovely)/i },
    { emoji: "😢", re: /(غمگین|ناراحتم|ناراحت|بدبختم|متاسف|غم|sad|upset|sorry|cry)/i },
    { emoji: "😡", re: /(عصبانی|اعصابم|حرص|خشم|عصبانیتم|angry|mad|furious)/i },
    { emoji: "😱", re: /(وای|یا خدا|شوکه|ترسناک|ترسیدم|omg|scary|shocked)/i },
    { emoji: "🤯", re: /(عجب|باورنکردنی|باورم نمیشه|جدی؟|جدی|wow|unbelievable|mind.?blown)/i },
    { emoji: "🤣", re: /(خنده|خندیدم|باحال|باحاله|جوک|lol|lmao|funny|haha|😂|🤣)/i },
    { emoji: "🎉", re: /(تبریک|مبارک|موفق شدم|موفقیت|بردم|برنده|جشن|congrat|celebrate|won|winner)/i },
    { emoji: "🤔", re: /(\?|؟|چرا|چطور|چگونه|آیا|میشه|می‌شود|چی|چه|what|why|how|can you|could you)/i },
    { emoji: "👨‍💻", re: /(کد|کدنویسی|برنامه نویسی|برنامه‌نویسی|جاوااسکریپت|javascript|python|code|coding|api|worker|cloudflare|telegram bot)/i },
    { emoji: "👀", re: /(ببین|نگاه|بررسی|جستجو|سرچ|خبر|جدیدترین|لینک|منبع|search|look|check|news|latest)/i },
    { emoji: "🔥", re: /(عالی|خفن|فوق العاده|فوق‌العاده|ترکوند|دمت گرم|awesome|amazing|great|cool)/i },
  ];

  for (const item of groups) {
    if (item.re.test(value)) {
      return item.emoji;
    }
  }

  return "👍";
}

async function reactToUserMessage(
  sendUrl,
  chatId,
  message,
  text
) {
  const messageId = message?.message_id;
  if (!chatId || !messageId) return null;

  const emoji = chooseUserReaction(text, message);

  try {
    return await telegramRequest(
      getBotApiUrl(
        sendUrl,
        "setMessageReaction"
      ),
      {
        chat_id: chatId,
        message_id: messageId,
        reaction: [
          {
            type: "emoji",
            emoji
          }
        ],
        is_big: false
      }
    );
  } catch (_) {
    // Reactions are cosmetic; never interrupt the bot's real processing.
    return null;
  }
}

function splitRichText(
  text,
  limit = RICH_MESSAGE_LIMIT
) {
  const value = String(text || "");
  if (value.length <= limit) {
    return [value];
  }

  const parts = [];
  let rest = value;

  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < Math.floor(limit * 0.55)) {
      cut = rest.lastIndexOf("\n", limit);
    }
    if (cut < Math.floor(limit * 0.55)) {
      cut = limit;
    }

    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }

  if (rest) {
    parts.push(rest);
  }

  return parts.filter(Boolean);
}

async function sendRichTelegram(
  sendUrl,
  chatId,
  text,
  extra = {}
) {
  const parts = splitRichText(text);

  if (parts.length === 1) {
    return telegramRequest(
      getBotApiUrl(
        sendUrl,
        "sendRichMessage"
      ),
      {
        chat_id: chatId,
        rich_message:
          buildRichMessageInput(
            parts[0]
          ),
        ...extra
      }
    );
  }

  let lastResult = null;

  for (const part of parts) {
    lastResult = await telegramRequest(
      getBotApiUrl(
        sendUrl,
        "sendRichMessage"
      ),
      {
        chat_id: chatId,
        rich_message:
          buildRichMessageInput(
            part
          ),
        ...extra
      }
    );
  }

  return lastResult;
}

async function sendTelegram(
  sendUrl,
  chatId,
  text,
  extra = {}
) {
  try {
    return await sendRichTelegram(
      sendUrl,
      chatId,
      text,
      extra
    );
  } catch (_) {
    const htmlFormatted =
      markdownToHtml(
        richHtmlToMarkdown(
          text
        )
      );

    try {
      return await telegramRequest(
        sendUrl,
        {
          chat_id: chatId,
          text: htmlFormatted,
          parse_mode: "HTML",
          disable_web_page_preview:
            true,
          ...extra
        }
      );
    } catch (_) {
      return await telegramRequest(
        sendUrl,
        {
          chat_id: chatId,
          text:
            htmlToPlain(
              htmlFormatted
            ),
          ...extra
        }
      );
    }
  }
}

async function editTelegram(
  url,
  chatId,
  messageId,
  text
) {
  if (!messageId) {
    return null;
  }

  const editUrl =
    getBotApiUrl(
      url,
      "editMessageText"
    );

  try {
    return await telegramRequest(
      editUrl,
      {
        chat_id: chatId,
        message_id: messageId,
        rich_message:
          buildRichMessageInput(
            text
          )
      }
    );
  } catch (_) {
    const htmlFormatted =
      markdownToHtml(
        richHtmlToMarkdown(
          text
        )
      );

    return telegramRequest(
      editUrl,
      {
        chat_id: chatId,
        message_id: messageId,
        text: htmlFormatted,
        parse_mode: "HTML",
        disable_web_page_preview:
          true
      }
    ).catch(
      () =>
        telegramRequest(
          editUrl,
          {
            chat_id: chatId,
            message_id:
              messageId,
            text:
              htmlToPlain(
                htmlFormatted
              )
          }
        )
    );
  }
}

async function deleteTelegramMessage(
  sendUrl,
  chatId,
  messageId
) {
  if (!messageId) {
    return null;
  }

  return telegramRequest(
    getBotApiUrl(
      sendUrl,
      "deleteMessage"
    ),
    {
      chat_id: chatId,
      message_id: messageId
    }
  );
}

/* ───────────────────────── STREAMING & AI ACTIONS ───────────────────────── */

function createTelegramStreamState(
  sendUrl,
  chatId,
  getStatusMessageId,
  db,
  isPrivate = false,
  sharedDraftId = null,
  onFirstChunk = null,
  streamSignal = null
) {
  let fullText = "";
  let messageIds = [];

  let draftId =
    sharedDraftId ||
    createDraftId();

  let lastDraftAt = 0;
const MIN_DRAFT_INTERVAL = 350;
  let firstChunkSent = false;

  // Serialize Telegram updates and always send the newest accumulated text.
  // Without this queue, parallel edit/send requests can finish out of order
  // and make the visible answer jump backwards or remain stuck at a partial
  // chunk.
  let pendingDraftText = "";
  let draftPromise = Promise.resolve();
  let draftInFlight = false;
  let draftTimer = null;

  let pendingEditText = "";
  let editPromise = Promise.resolve();
  let editInFlight = false;

  async function runLatestDraft() {
    if (draftInFlight) {
      return draftPromise;
    }

    draftInFlight = true;

    draftPromise = (async () => {
      try {
        while (pendingDraftText) {
          if (streamSignal?.aborted) {
            pendingDraftText = "";
            break;
          }

          const textToSend = pendingDraftText;
          pendingDraftText = "";

          await queueTelegramDraft(
            sendUrl,
            chatId,
            draftId,
            async () => {
              if (streamSignal?.aborted) {
                return null;
              }

              // The answer itself is streamed through Telegram's native
              // Rich Message draft API. The same draft_id is used throughout
              // generation so Telegram animates the evolving rich content.
              return sendRichMessageDraft(
                sendUrl,
                chatId,
                draftId,
                textToSend
              ).catch(() => null);
            }
          );
        }
      } finally {
        draftInFlight = false;
      }
    })();

    return draftPromise;
  }

  async function runLatestEdit() {
    if (editInFlight) {
      return editPromise;
    }

    editInFlight = true;

    editPromise = (async () => {
      try {
        while (pendingEditText) {
          const statusId = getStatusMessageId?.();
          if (!statusId) {
            pendingEditText = "";
            break;
          }

          const textToEdit = pendingEditText;
          pendingEditText = "";

          await editTelegram(
            sendUrl,
            chatId,
            statusId,
            textToEdit
          ).catch(() => null);
        }
      } finally {
        editInFlight = false;
      }
    })();

    return editPromise;
  }

  function scheduleDraft() {
    if (draftTimer !== null) {
      return;
    }

    const wait = Math.max(0, 700 - (Date.now() - lastDraftAt));

    if (wait === 0) {
      lastDraftAt = Date.now();
      runLatestDraft().catch(() => null);
      return;
    }

    draftTimer = setTimeout(() => {
      draftTimer = null;
      lastDraftAt = Date.now();
      runLatestDraft().catch(() => null);
    }, wait);
  }

  async function push(
    accumulatedText
  ) {
    const nextText = String(accumulatedText || "");

    if (streamSignal?.aborted) {
      return;
    }

    if (!nextText || nextText === fullText) {
      return;
    }

    fullText = nextText;

    if (!firstChunkSent) {
      firstChunkSent = true;
      try {
        await onFirstChunk?.();
      } catch (_) {}
    }

    if (isPrivate) {
      // Never drop a throttled update. Keep the latest text and schedule a
      // send so a fast LLM stream cannot leave Telegram showing an old prefix.
      pendingDraftText = fullText;
      scheduleDraft();
      return;
    }

    const statusId = getStatusMessageId?.();
    if (statusId) {
      // Queue edits so Telegram cannot apply an older response after a newer
      // one due to network latency.
      pendingEditText = fullText;
      runLatestEdit().catch(() => null);
    }
  }

  async function finish(
    answer
  ) {
    // Always trust the complete response returned by OpenRouter as the final
    // source of truth. The streamed preview can legally lag behind the final
    // response, especially for vision requests, and must never become the
    // persisted/visible answer by accident.
    if (answer) {
      const finalText = String(answer);
      if (finalText) {
        fullText = finalText;
      }
    }

    if (draftTimer !== null) {
      clearTimeout(draftTimer);
      draftTimer = null;
    }

    if (streamSignal?.aborted) {
      pendingDraftText = "";
      pendingEditText = "";
      return {
        messageIds,
        text: fullText
      };
    }

    if (isPrivate) {
      // Force the exact final text through the draft queue before persisting the
      // final message. The Telegram Bot API documents drafts as ephemeral, so
      // the normal sendMessage/sendRichMessage below is still required.
      pendingDraftText = fullText;
      await runLatestDraft().catch(() => null);
    } else {
      pendingEditText = fullText;
      await runLatestEdit().catch(() => null);
    }

    const statusId = getStatusMessageId?.();

    if (!isPrivate && statusId) {
      // One final synchronous edit guarantees the latest complete answer is
      // what remains visible even if an earlier queued edit failed.
      const edited = await editTelegram(
        sendUrl,
        chatId,
        statusId,
        fullText
      ).catch(() => null);

      const id = edited?.result?.message_id || statusId;

      if (id) {
        messageIds.push(id);

        if (db) {
          await db
            .prepare(
              `INSERT OR REPLACE INTO ai_replies (message_id, chat_id, content, created_at) VALUES (?, ?, ?, ?)`
            )
            .bind(
              String(id),
              String(chatId),
              String(fullText),
              Date.now()
            )
            .run()
            .catch(() => null);
        }

        await addAiButtons(sendUrl, chatId, id);
      }

      return {
        messageIds,
        text: fullText
      };
    }

    const result = await sendTelegram(
      sendUrl,
      chatId,
      fullText
    );

    const id = result?.result?.message_id;

    if (id) {
      messageIds.push(id);

      if (db) {
        await db
          .prepare(
            `INSERT OR REPLACE INTO ai_replies (message_id, chat_id, content, created_at) VALUES (?, ?, ?, ?)`
          )
          .bind(
            String(id),
            String(chatId),
            String(fullText),
            Date.now()
          )
          .run()
          .catch(() => null);
      }

      await addAiButtons(sendUrl, chatId, id);
    }

    return {
      messageIds,
      text: fullText
    };
  }

  return {
    push,
    finish
  };
}

async function addAiButtons(
  sendUrl,
  chatId,
  messageId
) {
  try {
    await telegramRequest(
      getBotApiUrl(
        sendUrl,
        "editMessageReplyMarkup"
      ),
      {
        chat_id: chatId,
        message_id:
          messageId,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🇮🇷 ترجمه",
                callback_data:
                  "ai:translate"
              },
              {
                text: "📝 خلاصه",
                callback_data:
                  "ai:summarize"
              }
            ]
          ]
        }
      }
    );
  } catch (_) {}
}

async function handleAiAction(
  action,
  messageId,
  query,
  env
) {
  const chatId =
    String(
      query.message?.chat?.id ||
        ""
    );

  let content = "";

  if (getDB(env)) {
    try {
      const row =
        await getDB(env)
          .prepare(
            `SELECT content FROM ai_replies WHERE message_id = ? AND chat_id = ?`
          )
          .bind(
            String(messageId),
            chatId
          )
          .first();

      content =
        row?.content || "";
    } catch (_) {}
  }

  if (!content) {
    return "❌ متن پیام پیدا نشد.";
  }

  const instruction =
    action === "translate"
      ? "متن زیر را به فارسی روان ترجمه کن."
      : "متن زیر را خلاصه کن.";

  try {
    const result =
      await askOpenRouter(
        env.OPENROUTER_API_KEY,
        [
          {
            role: "system",
            content:
              instruction
          },
          {
            role: "user",
            content:
              content.replace(
                /<[^>]+>/g,
                " "
              )
          }
        ],
        MODEL
      );

    return markdownToHtml(
      cleanAnswer(
        result.content
      )
    ).slice(
      0,
      AI_BUTTON_LIMIT
    );
  } catch (error) {
    return `❌ خطا در انجام درخواست: ${formatError(error)}`;
  }
}

/* ───────────────────────── HTML CLEANER & PARSER ───────────────────────── */

function markdownToHtml(
  text
) {
  let source =
    cleanAnswer(text);

  source =
    source.replace(
      /\|(.+)\|/g,
      match => {
        if (
          match.includes(
            "---"
          )
        ) {
          return "";
        }

        const cells =
          match
            .split("|")
            .filter(
              c =>
                c.trim() !== ""
            )
            .map(
              c =>
                c.trim()
            );

        return cells.join(
          "  │  "
        );
      }
    );

  source =
    source.replace(
      /```([\s\S]*?)```/g,
      (_, code) =>
        `<pre>${escapeHtml(
          code.trim()
        )}</pre>`
    );

  source =
    source.replace(
      /^###\s+(.+)$/gm,
      "<b>$1</b>"
    );

  source =
    source.replace(
      /^##\s+(.+)$/gm,
      "<b>$1</b>"
    );

  source =
    source.replace(
      /^#\s+(.+)$/gm,
      "<b>$1</b>"
    );

  source =
    source.replace(
      /^\s*[-*]\s+(.+)$/gm,
      "• $1"
    );

  source =
    escapeHtmlPreservingTags(
      source
    );

  source =
    source.replace(
      /\*\*(.+?)\*\*/g,
      "<b>$1</b>"
    );

  source =
    source.replace(
      /`([^`\n]+)`/g,
      "<code>$1</code>"
    );

  return source;
}

function escapeHtmlPreservingTags(
  text
) {
  const tokens = [];

  const tokenized =
    String(text).replace(
      /<\/?(?:b|i|u|code|pre)(?:\s[^>]*)?>/gi,
      tag => {
        const token =
          `\u0001${tokens.length}\u0002`;

        tokens.push(tag);

        return token;
      }
    );

  const escaped =
    escapeHtml(
      tokenized
    );

  return escaped.replace(
    /\u0001(\d+)\u0002/g,
    (_, i) =>
      tokens[
        Number(i)
      ]
  );
}

function escapeHtml(
  text
) {
  return String(
    text || ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    );
}

function htmlToPlain(
  html
) {
  return String(
    html || ""
  )
    .replace(
      /<[^>]+>/g,
      ""
    )
    .replace(
      /&amp;/g,
      "&"
    )
    .replace(
      /&lt;/g,
      "<"
    )
    .replace(
      /&gt;/g,
      ">"
    )
    .trim();
}

function cleanRichAnswer(
  text
) {
  return String(
    text || ""
  )
    .replace(
      /<\/?(script|style)[^>]*>/gi,
      ""
    )
    .replace(
      /\0/g,
      ""
    )
    .trim();
}

function cleanAnswer(
  text
) {
  return cleanRichAnswer(
    text
  )
    .replace(
      /<\/?(div|p|span|section|article|header|footer|table|tr|td|th|ul|ol|li)[^>]*>/gi,
      ""
    )
    .trim();
}

/* ───────────────────────── DIAGNOSTICS (LIVE TEST) ───────────────────────── */

function classifyDebugArea(source, message, area, error) {
  const text = `${source || ""} ${message || ""} ${area || ""} ${error || ""}`.toLowerCase();
  if (/openrouter|open router|model|ai/.test(text)) return "OpenRouter";
  if (/langsearch|search/.test(text)) return "LangSearch";
  if (/telegram|draft|callback|guest/.test(text)) return "Telegram";
  if (/d1|database|sqlite|sql|bind/.test(text)) return "D1";
  if (/vision|image|photo|document/.test(text)) return "Vision";
  if (/timeout|timed out|abort/.test(text)) return "Timeout";
  return "Other";
}

async function buildAdvancedDebugSummary(db) {
  if (!db) return "🚨 <b>خطاهای اخیر:</b> D1 متصل نیست.";
  try {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const rows = await db.prepare(`SELECT source, message, area, error, created_at FROM debug_logs WHERE created_at >= ? ORDER BY created_at DESC LIMIT 200`).bind(since).all();
    const counts = { OpenRouter: 0, LangSearch: 0, Telegram: 0, D1: 0, Vision: 0, Timeout: 0, Other: 0 };
    const recent = [];
    for (const row of rows.results || []) {
      const key = classifyDebugArea(row.source, row.message, row.area, row.error);
      counts[key]++;
      if (recent.length < 5) {
        const detail = String(row.error || row.message || "خطای نامشخص").replace(/\s+/g, " ").trim();
        recent.push(`• <b>${key}</b> — ${escapeHtml(detail.slice(0, 180))}`);
      }
    }
    const summary = Object.entries(counts).map(([k,v]) => `${k}: <b>${v}</b>`).join(" | ");
    return `🚨 <b>سیستم خطای پیشرفته — ۲۴ ساعت اخیر</b>\n\n${summary}\n\n${recent.length ? recent.join("\n") : "✅ خطای ذخیره‌شده‌ای ثبت نشده است."}`;
  } catch (error) {
    return `🚨 <b>گزارش خطا</b>\n❌ <code>${escapeHtml(formatError(error).slice(0, 240))}</code>`;
  }
}

async function runDiagnostics(
  env
) {
  const checks = [];
  const started =
    Date.now();

  const check =
    async (
      name,
      fn
    ) => {
      const t =
        Date.now();

      try {
        const detail =
          await fn();

        checks.push(
          `✅ <b>${name}</b> — ${escapeHtml(String(detail || "OK"))} <code>${Date.now() - t}ms</code>`
        );
      } catch (error) {
        const msg =
          formatError(error);

        checks.push(
          `❌ <b>${name}</b> — <code>${escapeHtml(msg.slice(0, 300))}</code>`
        );
      }
    };

  await Promise.all([
    check(
      "Worker",
      async () =>
        "فعال - 0ms"
    ),

    check(
      "Telegram API",
      async () => {
        const r =
          await fetchWithTimeout(
            `${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/getMe`,
            {},
            5000
          );

        const d =
          await r.json();

        return `@${d.result?.username || "unknown"}`;
      }
    ),

    check(
      "OpenRouter API",
      async () => {
        const r =
          await fetchWithTimeout(
            "https://openrouter.ai/api/v1/models",
            {
              headers: {
                Authorization:
                  `Bearer ${env.OPENROUTER_API_KEY}`
              }
            },
            7000
          );

        return r.ok
          ? "متصل"
          : "خطا";
      }
    ),

    check(
      "LangSearch",
      async () => {
        if (!env.LANGSEARCH_API_KEY) {
          throw new Error("کلید LangSearch تنظیم نشده است");
        }

        const results =
          await searchWeb(
            env.LANGSEARCH_API_KEY,
            "current date today",
            "oneDay",
            null,
            {
              queries: ["current date today"]
            }
          );

        return results.length
          ? `متصل و فعال — ${results.length} نتیجه`
          : "متصل ولی بدون نتیجه";
      }
    ),

    check(
      "D1 Database",
      async () => {
        const db = getDB(env);

        // D1 is optional for deployment. When no binding exists, the bot
        // falls back to in-memory state instead of reporting a hard failure.
        if (!db) {
          return "اختیاری — D1 binding تنظیم نشده";
        }

        await db
          .prepare(
            "SELECT 1"
          )
          .first();

        return "متصل و آماده";
      }
    ),

    check(
      "مدل متن (تست زنده)",
      async () => {
        const model =
          memory.selectedModel ||
          MODEL;

        const result =
          await askOpenRouter(
            env.OPENROUTER_API_KEY,
            [
              {
                role: "user",
                content: "تست"
              }
            ],
            model
          );

        return `${model} — تست موفق`;
      }
    )
  ]);

  const advanced = await buildAdvancedDebugSummary(getDB(env));
  return `🧪 <b>گزارش دقیق دیباگ ربات</b>\n\n${checks.join("\n")}\n\n${advanced}\n\n⏱ زمان کل دیباگ: <code>${Date.now() - started}ms</code>`;
}

/* ───────────────────────── WEB SEARCH & FETCH ───────────────────────── */

async function searchWeb(
  apiKey,
  query,
  freshness,
  domain,
  searchPlan = {}
) {
  if (!apiKey) {
    throw new Error(
      "LangSearch API key is missing"
    );
  }

  const rawQueries =
    Array.isArray(query)
      ? query
      : (
          Array.isArray(searchPlan?.queries)
            ? searchPlan.queries
            : [query]
        );

  const cleanQueries =
    rawQueries
      .map(q => String(q || "").trim())
      .filter(Boolean)
      .filter(
        (q, index, list) =>
          list.findIndex(
            item =>
              item.toLowerCase() === q.toLowerCase()
          ) === index
      );

  if (!cleanQueries.length) {
    return [];
  }

  const includeDomains =
    domain
      ? [domain]
      : undefined;

  const allResults = [];
  let lastError = "LangSearch returned no web results.";

  // Search every planned query. This is intentionally not "first result wins":
  // price/current requests need more than one query so the model can compare sources.
  for (const cleanQuery of cleanQueries.slice(0, 5)) {
    const attempts = [
      {
        query: cleanQuery,
        freshness: freshness || "noLimit"
      },
      ...(freshness && freshness !== "noLimit"
        ? [{
            query: cleanQuery,
            freshness: "noLimit"
          }]
        : [])
    ];

    let querySucceeded = false;

    for (const attempt of attempts) {
      const payload = {
        query: attempt.query,
        freshness: attempt.freshness,
        summary: true,
        count: Math.min(
          10,
          Math.max(1, SEARCH_RESULT_COUNT)
        ),
        contents: {
          text: true,
          max_characters: 3500
        }
      };

      if (includeDomains?.length) {
        payload.includeDomains = includeDomains;
      }

      let queryLastError = "";

      for (let retry = 0; retry < 2; retry++) {
        try {
          const response =
            await fetchWithTimeout(
              LANGSEARCH_URL,
              {
                method: "POST",
                headers: {
                  Authorization:
                    `Bearer ${apiKey}`,
                  "Content-Type":
                    "application/json"
                },
                body:
                  JSON.stringify(payload)
              },
              15000
            );

          const raw =
            await response.text();

          let data = null;

          try {
            data =
              raw
                ? JSON.parse(raw)
                : null;
          } catch (_) {}

          if (!response.ok) {
            queryLastError =
              `LangSearch ${formatSearchErrorData(data, response.status)}`;

            if (
              (response.status === 429 ||
                response.status >= 500) &&
              retry === 0
            ) {
              await sleep(800);
              continue;
            }

            break;
          }

          if (
            data?.code != null &&
            Number(data.code) !== 200
          ) {
            queryLastError =
              `LangSearch code ${data.code}: ${formatSearchErrorData(data, response.status)}`;

            if (retry === 0) {
              await sleep(600);
              continue;
            }

            break;
          }

          const values =
            data?.data
              ?.webPages
              ?.value ||
            data?.webPages
              ?.value ||
            data?.results ||
            [];

          const normalized =
            Array.isArray(values)
              ? values
                  .map(
                    item => ({
                      title:
                        item.name ||
                        item.title ||
                        "",
                      url:
                        item.url ||
                        item.link ||
                        "",
                      snippet:
                        item.summary ||
                        item.snippet ||
                        item.description ||
                        "",
                      content:
                        item.contents?.text ||
                        item.content?.text ||
                        item.text ||
                        item.pageContent ||
                        "",
                      publishedAt:
                        item.datePublished ||
                        item.publishedAt ||
                        item.published_at ||
                        "",
                      crawledAt:
                        item.dateCrawled ||
                        item.crawledAt ||
                        item.crawled_at ||
                        ""
                    })
                  )
                  .filter(
                    item =>
                      item.title ||
                      item.url ||
                      item.snippet ||
                      item.content
                  )
              : [];

          if (normalized.length) {
            allResults.push(...normalized);
            querySucceeded = true;
            lastError = "";
            break;
          }

          queryLastError =
            "LangSearch returned no usable web results.";
          break;
        } catch (error) {
          queryLastError =
            formatError(error);

          if (retry === 0) {
            await sleep(800);
            continue;
          }
        }

        break;
      }

      // Do not stop after the first successful query. Multiple query variants
      // are intentionally collected so current/price/research answers can
      // compare independent sources.
      if (queryLastError) {
        lastError = queryLastError;
      }
    }
  }

  // Deduplicate by canonical URL, then title+snippet as a fallback.
  const unique = [];
  const seen = new Set();

  for (const item of allResults) {
    const key =
      item.url
        ? item.url.trim().toLowerCase()
        : `${item.title}|${item.snippet}`.trim().toLowerCase();

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(item);
  }

  if (!unique.length) {
    throw new Error(lastError);
  }

  unique.sort((a, b) => searchSourceScore(b, cleanQueries, searchPlan) - searchSourceScore(a, cleanQueries, searchPlan));
  return unique.slice(0, 20);
}

function searchSourceScore(item, queries, searchPlan = {}) {
  const text = `${item?.title || ""} ${item?.url || ""} ${item?.snippet || ""}`.toLowerCase();
  let score = 0;
  if (/gov\.|gov\/|edu\.|ac\.|official/.test(text)) score += 6;
  if (/(reuters\.|apnews\.|bbc\.|dw\.|aljazeera\.|nytimes\.|theguardian\.)/.test(text)) score += 5;
  if (/(tgju\.|bonbast\.|mesghal\.)/.test(text) && searchPlan?.priceSensitive) score += 7;
  if (item?.publishedAt) score += 2;
  if (item?.content) score += 1;
  if (searchPlan?.current || searchPlan?.priceSensitive || searchPlan?.dateTime) {
    const published = Date.parse(item?.publishedAt || "");
    if (Number.isFinite(published)) {
      const ageDays = Math.max(0, (Date.now() - published) / 86400000);
      score += Math.max(0, 5 - Math.min(5, ageDays));
    }
  }
  return score;
}

function formatSearchErrorData(
  data,
  status
) {
  return (
    data?.msg ||
    data?.message ||
    data?.error?.message ||
    `HTTP ${status}`
  );
}

async function openUrl(
  url
) {
  try {
    const response =
      await fetchWithTimeout(
        url,
        {
          method: "GET"
        },
        20000
      );

    if (!response.ok) {
      return null;
    }

    const raw =
      await response.text();

    const content =
      raw
        .replace(
          /<script[\s\S]*?<\/script>/gi,
          " "
        )
        .replace(
          /<style[\s\S]*?<\/style>/gi,
          " "
        )
        .replace(
          /<[^>]+>/g,
          " "
        )
        .replace(
          /&nbsp;/gi,
          " "
        )
        .replace(
          /&amp;/gi,
          "&"
        )
        .replace(
          /\\s+/g,
          " "
        )
        .trim()
        .slice(
          0,
          PAGE_TEXT_LIMIT
        );

    return {
      url,
      content
    };
  } catch (_) {
    return null;
  }
}

function fetchWithTimeout(
  url,
  options = {},
  timeout = 15000
) {
  const controller =
    new AbortController();

  const externalSignal =
    options?.signal || null;

  let onExternalAbort = null;

  if (externalSignal) {
    onExternalAbort = () => {
      try {
        controller.abort(externalSignal.reason);
      } catch (_) {
        controller.abort();
      }
    };

    if (externalSignal.aborted) {
      onExternalAbort();
    } else {
      externalSignal.addEventListener(
        "abort",
        onExternalAbort,
        { once: true }
      );
    }
  }

  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  return fetch(
    url,
    {
      ...options,
      signal: controller.signal
    }
  ).finally(
    () => {
      clearTimeout(timer);
      if (externalSignal && onExternalAbort) {
        externalSignal.removeEventListener(
          "abort",
          onExternalAbort
        );
      }
    }
  );
}

function formatError(
  error
) {
  if (
    error instanceof Error
  ) {
    return `${error.name}: ${error.message}`;
  }

  return typeof error ===
    "string"
    ? error
    : JSON.stringify(error);
}

function sleep(
  ms
) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}
