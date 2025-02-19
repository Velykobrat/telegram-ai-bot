import dotenv from 'dotenv';
dotenv.config();
import { Telegraf } from "telegraf";
import { createTransport } from "nodemailer";
import { connect, Schema, model } from "mongoose";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Підключення до MongoDB
const mongoURI = `mongodb+srv://${process.env.MONGODB_USER}:${process.env.MONGODB_PASSWORD}@${process.env.MONGODB_URL}/${process.env.MONGODB_DB}?retryWrites=true&w=majority`;

connect(mongoURI)
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => console.log("Failed to connect to MongoDB", err));

// Схема для зберігання даних клієнта в MongoDB
const leadSchema = new Schema({
  task: String,
  plan: String,
  budget: String,
  timeline: String,
  techPreferences: String,
  contact: String, 
  userContact: String 
});

const Lead = model("Lead", leadSchema);

// Воронка запитів
const questions = [
  {
    question: "Привіт! Я бот, який допоможе зібрати інформацію про ваш проєкт. Почнемо! Яка у вас задача?",
    options: ["Розробка сайту", "Розробка мобільного додатку", "Інше"],
    key: "task"
  },
  {
    question: "Чи маєте ви вже якийсь план або проект, або вам потрібна допомога з розробкою з нуля?",
    options: ["Є план", "Немає плану", "Не впевнений"],
    key: "plan"
  },
  {
    question: "Який бюджет ви плануєте для цього проєкту?",
    options: ["Менше 10 000 грн", "10 000 - 50 000 грн", "Більше 50 000 грн"],
    key: "budget"
  },
  {
    question: "Які терміни ви хочете встановити для виконання робіт?",
    options: ["1-3 місяці", "3-6 місяців", "Більше 6 місяців"],
    key: "timeline"
  },
  {
    question: "Чи є у вас які-небудь переваги щодо технологій або платформ, які потрібно використовувати?",
    options: ["Так", "Ні", "Не знаю"],
    key: "techPreferences"
  },
  {
    question: "Чи можемо ми зв'язатися для уточнення деталей?",
    options: ["Так", "Ні", "Можливо"],
    key: "contact"
  },
  {
    question: "Будь ласка, надайте свій контакт (номер телефону або email).", // Нове питання для контакту
    options: [], // Не використовуємо варіанти, чекаємо на ввід тексту
    key: "userContact"
  }
];

// Структура для збереження відповіді клієнта
let userData = {};

bot.start((ctx) => {
  console.log("Команда /start отримана");
  const chatId = ctx.chat.id;
  userData[chatId] = { stage: 0 }; // Починаємо з першого питання
  askQuestion(chatId);
});

// Функція для запитування питання
const askQuestion = (chatId) => {
  const stage = userData[chatId].stage;
  const currentQuestion = questions[stage];

  if (currentQuestion.options.length > 0) {
    const options = currentQuestion.options.map(option => ({
      text: option,
      callback_data: option
    }));

    const keyboard = {
      reply_markup: {
        inline_keyboard: [options]
      }
    };

    bot.telegram.sendMessage(chatId, currentQuestion.question, keyboard)
      .then(() => console.log(`Питання надіслано користувачу ${chatId}: ${currentQuestion.question}`))
      .catch((err) => console.error("Помилка відправки питання:", err));
  } else {
    bot.telegram.sendMessage(chatId, currentQuestion.question) // Для питання про контакт чекаємо на текстову відповідь
      .then(() => console.log(`Питання надіслано користувачу ${chatId}: ${currentQuestion.question}`))
      .catch((err) => console.error("Помилка відправки питання:", err));
  }
};

// Обробка відповіді користувача
bot.on('callback_query', async (ctx) => {
  const chatId = ctx.chat.id;
  const userResponse = ctx.callbackQuery.data;

  if (userData[chatId]) {
    const stage = userData[chatId].stage;
    const currentQuestion = questions[stage];

    // Зберігаємо відповідь користувача
    userData[chatId][currentQuestion.key] = userResponse;

    // Перехід до наступного питання або завершення
    if (stage < questions.length - 1) {
      userData[chatId].stage++;
      askQuestion(chatId);
    } else {
      // Завершення збору даних
      bot.telegram.sendMessage(chatId, "Дякую за надану інформацію! Ми зв'яжемося з вами найближчим часом.")
        .then(() => console.log(`Всі питання завершено для користувача ${chatId}`))
        .catch((err) => console.error("Помилка відправки повідомлення завершення:", err));

      // Зберігаємо дані в базі даних
      const lead = new Lead(userData[chatId]);

      try {
        await lead.save();
        console.log("Lead saved to database:", lead);
        
        // Відправляємо email із даними
        sendEmail(lead);

      } catch (error) {
        console.error("Error saving lead to database:", error);
        bot.telegram.sendMessage(chatId, "Вибачте, сталася помилка при збереженні даних. Спробуйте пізніше.");
      }

      // Очистка даних після завершення
      delete userData[chatId];
    }
  }
});

// Обробка текстової відповіді для контакту (email чи телефон)
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const userResponse = ctx.message.text;

  if (userData[chatId] && userData[chatId].stage === questions.length - 1) {
    userData[chatId].userContact = userResponse; // Збереження контакту

    // Завершуємо збір даних
    bot.telegram.sendMessage(chatId, "Дякую за надану інформацію! Ми зв'яжемося з вами найближчим часом.");

    // Зберігаємо дані в базі даних
    const lead = new Lead(userData[chatId]);

    try {
      await lead.save();
      console.log("Lead saved to database:", lead);
      
      // Відправляємо email із даними
      sendEmail(lead);

    } catch (error) {
      console.error("Error saving lead to database:", error);
      bot.telegram.sendMessage(chatId, "Вибачте, сталася помилка при збереженні даних. Спробуйте пізніше.");
    }

    // Очистка даних після завершення
    delete userData[chatId];
  }
});

// Функція для відправки email
const sendEmail = (lead) => {
  const transporter = createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    }
  });

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: process.env.NOTIFY_EMAIL, // Адреса, на яку відправляти
    subject: 'Нове лід-заявка!',
    text: `Є нова заявка:

Задача: ${lead.task}
План: ${lead.plan}
Бюджет: ${lead.budget}
Термін: ${lead.timeline}
Переваги: ${lead.techPreferences}
Контакт: ${lead.contact}
Контакт користувача: ${lead.userContact}` 
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log("Error sending email:", error);
    } else {
      console.log("Email sent: " + info.response);
    }
  });
};

bot.launch();
console.log("🤖 Бот запущений...");
