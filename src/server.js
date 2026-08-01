require('dotenv').config();
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const db = require('./db');
const { startScheduler } = require('./scheduler');
const { hashPassword, comparePassword, generateToken, requireAuth, isValidEmail } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, JWT_SECRET } = process.env;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('❌ محتاج تحط مفاتيح VAPID في Environment Variables');
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error('❌ محتاج تحط JWT_SECRET في Environment Variables');
  process.exit(1);
}

webpush.setVapidDetails(
  VAPID_SUBJECT || 'mailto:admin@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'الإيميل وكلمة السر مطلوبين' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'الإيميل مش صحيح' });
  if (password.length < 6) return res.status(400).json({ error: 'كلمة السر لازم تكون 6 حروف على الأقل' });

  if (db.getUserByEmail(email)) {
    return res.status(409).json({ error: 'الإيميل ده مستخدم قبل كده' });
  }

  const user = db.createUser(email, hashPassword(password));
  const token = generateToken(user.id);
  res.json({ ok: true, token, user: { id: user.id, email: user.email } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'الإيميل وكلمة السر مطلوبين' });

  const user = db.getUserByEmail(email);
  if (!user || !comparePassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'الإيميل أو كلمة السر غلط' });
  }

  const token = generateToken(user.id);
  res.json({ ok: true, token, user: { id: user.id, email: user.email } });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = db.getUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'المستخدم مش موجود' });
  res.json({ id: user.id, email: user.email });
});

app.get('/api/sync', requireAuth, (req, res) => {
  const result = db.getAppData(req.userId);
  res.json(result);
});

app.put('/api/sync', requireAuth, (req, res) => {
  const { data } = req.body;
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'data مطلوبة وتكون object' });
  }
  const result = db.setAppData(req.userId, data);
  res.json({ ok: true, updatedAt: result.updatedAt });
});

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post('/api/subscribe', requireAuth, (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'بيانات الاشتراك ناقصة' });
    }
    const saved = db.saveSubscription(req.userId, {
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    });
    res.json({ ok: true, subscriptionId: saved.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'حصل خطأ في حفظ الاشتراك' });
  }
});

app.delete('/api/subscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint مطلوب' });
  db.deleteSubscription(endpoint);
  res.json({ ok: true });
});

app.post('/api/reminders', requireAuth, (req, res) => {
  try {
    const { title, body, sendAt, repeat, category } = req.body;
    if (!title || !sendAt) return res.status(400).json({ error: 'title و sendAt مطلوبين' });
    const reminder = db.addReminder(req.userId, { title, body, sendAt, repeat, category });
    res.json({ ok: true, reminder });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'حصل خطأ في إضافة التذكير' });
  }
});

app.get('/api/reminders', requireAuth, (req, res) => {
  res.json({ reminders: db.listRemindersByUser(req.userId) });
});

app.delete('/api/reminders/:id', requireAuth, (req, res) => {
  db.deleteReminder(req.params.id, req.userId);
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`🚀 السيرفر شغال على بورت ${PORT}`);
  startScheduler();
});
