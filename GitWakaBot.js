require("dotenv").config();
const cron = require("node-cron");
const axios = require("axios");

const MIN_HOURS = 2;
const TELEGRAM_POLL_INTERVAL_MS = 1500;

//  GitHub
async function checkGithub() {
  const GithubToken = process.env.GITHUB_TOKEN;
  const UserName = process.env.GITHUB_USERNAME;
  const today = new Date().toISOString().slice(0, 10);

  const url = `https://api.github.com/search/commits?q=author:${UserName}+committer-date:${today}`;

  const resp = await axios.get(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GithubToken}`,
      "User-Agent": "gitwaka-bot",
    },
  });

  return resp.data.total_count;
}

//  WakaTime
async function checkWakatime() {
  const WakatimeKey = process.env.WAKATIME_API_KEY;

  const resp = await axios.get(
    "https://wakatime.com/api/v1/users/current/summaries?range=today",
    {
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${WakatimeKey}:`).toString("base64"),
      },
    }
  );

  const seconds = resp.data.data[0].grand_total.total_seconds;
  return seconds;
}

//  Telegram
async function sendMessage(text) {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await axios.post(url, {
    chat_id: chatId,
    text,
  });
}

function formatTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  let parts = [];

  if (hours > 0) {
    parts.push(
      `${hours} ${hours === 1 ? "час" : hours < 5 ? "часа" : "часов"}`
    );
  }

  if (minutes > 0) {
    parts.push(
      `${minutes} ${
        minutes === 1 ? "минута" : minutes < 5 ? "минуты" : "минут"
      }`
    );
  }

  if (seconds > 0) {
    parts.push(
      `${seconds} ${
        seconds === 1 ? "секунда" : seconds < 5 ? "секунды" : "секунд"
      }`
    );
  }

  return parts.length ? parts.join(" ") : "0 секунд";
}

async function checkToday() {
  try {
    const commits = await checkGithub();
    const totalSeconds = await checkWakatime();
    const hours = totalSeconds / 3600;
    const prettyTime = formatTime(totalSeconds);

    let message = "Отчёт за сегодня:\n\n";

    if (commits === 0 && hours < MIN_HOURS) {
      message += `❗ Нет коммитов и мало часов! (${prettyTime})`;
    } else if (commits === 0) {
      message += "⚠️ Сегодня не было коммитов!";
    } else if (hours < MIN_HOURS) {
      message += `⚠️ Сегодня мало кода: ${prettyTime}`;
    } else {
      message += `🔥 Отлично! Коммитов: ${commits}, время: ${prettyTime}`;
    }

    await sendMessage(message);
  } catch (err) {
    console.log(
      "Ошибка checkToday:",
      err.response?.data || err.message || err.toString()
    );
    await sendMessage("⚠️ Не удалось проверить статус, попробуй позже.");
  }
}
async function sendStatusButton() {
  const token = process.env.TELEGRAM_TOKEN;
  const chat_id = process.env.TELEGRAM_CHAT_ID;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await axios.post(url, {
    chat_id: chat_id,
    text: "Нажми кнопку, чтобы проверить статус:",
    reply_markup: {
      inline_keyboard: [
        [{ text: "Проверить статус", callback_data: "check_status" }],
      ],
    },
  });
}
async function deleteWebhook() {
  const token = process.env.TELEGRAM_TOKEN;
  const url = `https://api.telegram.org/bot${token}/deleteWebhook`;

  try {
    await axios.post(url);
    console.log("Webhook очищен, используем getUpdates.");
  } catch (err) {
    console.log(
      "Не удалось сбросить webhook:",
      err.response?.data || err.message
    );
  }
}

async function listenUpdates() {
  const token = process.env.TELEGRAM_TOKEN;
  const url = `https://api.telegram.org/bot${token}/getUpdates`;

  let lastUpdateId = 0;
  let isPolling = false;

  setInterval(async () => {
    if (isPolling) return;
    isPolling = true;

    try {
      const resp = await axios.get(url, {
        params: {
          offset: lastUpdateId + 1,
          timeout: 25,
        },
      });

      const updates = resp.data.result;

      for (const update of updates) {
        lastUpdateId = update.update_id;

        // 📌 Команда /status
        if (update.message && update.message.text === "/status") {
          await sendStatusButton();
        }

        // 📌 Callback-кнопка
        if (update.callback_query) {
          const data = update.callback_query.data;

          if (data === "check_status") {
            await sendMessage("⏳ Проверяю статус...");
            await checkToday();
          }
        }
      }
    } catch (err) {
      const payload = err.response?.data || err.message;
      console.log("Ошибка getUpdates:", payload);

      if (err.response?.status === 409) {
        await deleteWebhook();
      }
    }
    isPolling = false;
  }, TELEGRAM_POLL_INTERVAL_MS);
}

function scheduleChecks() {
  const schedule = [
    { cronTime: "0 9 * * *", label: "09:00" },
    { cronTime: "0 14 * * *", label: "14:00" },
    { cronTime: "0 18 * * *", label: "18:00" },
    { cronTime: "0 21 * * *", label: "21:00" },
    { cronTime: "0 23 * * *", label: "23:00" },
  ];

  schedule.forEach(({ cronTime, label }) => {
    cron.schedule(cronTime, () => {
      console.log(`▶️  Чек в ${label}`);
      checkToday().catch((err) =>
        console.log(
          "Ошибка в checkToday при запуске по cron:",
          err.response?.data || err.message || err.toString()
        )
      );
    });
  });
}

async function bootstrap() {
  await deleteWebhook();
  await sendStatusButton();
  listenUpdates();
  scheduleChecks();

  console.log("✅ Бот запущен, ждёт времени…");
}

bootstrap().catch((err) => {
  console.error(
    "Бот не смог запуститься:",
    err.response?.data || err.message || err.toString()
  );
});
