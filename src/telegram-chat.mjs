import { chatsQueEscribieron } from './notificar/telegram.mjs';

// Averigua el chat del usuario: lista los chats privados que le escribieron al bot (hay que mandarle un mensaje antes).
//   node src/telegram-chat.mjs
try { process.loadEnvFile('.env'); } catch { /* sin .env */ }
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('Falta TELEGRAM_BOT_TOKEN en .env');
  process.exit(2);
}
const chats = await chatsQueEscribieron(process.env.TELEGRAM_BOT_TOKEN);
if (chats.length === 0) console.log('Nadie le escribió al bot todavía (o pasaron más de 24 h): mandale un mensaje y volvé a correr esto.');
for (const c of chats) console.log(`${c.id}\t${c.nombre}`);
