require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const db = require('./db');
const { startScheduler } = require('./scheduler');
const { hashPassword, comparePassword, generateToken, requireAuth, isValidEmail } = require('./auth');
const { sendPasswordResetEmail } = require('./email');

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

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'الإيميل مطلوب' });

  const user = db.getUserByEmail(email);
  if (!user) return res.json({ ok: true });

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  db.createPasswordReset(user.id, tokenHash, expiresAt);

  const frontendUrl = process.env.FRONTEND_URL || 'https://your-frontend-url.netlify.app';
  const resetLink = `${frontendUrl}?resetToken=${rawToken}`;

  try {
    await sendPasswordResetEmail(user.email, resetLink);
  } catch (err) {
    console.error('فشل إرسال إيميل الاسترجاع:', err.message);
  }

  res.json({ ok: true });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'التوكن وكلمة السر الجديدة مطلوبين' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'كلمة السر لازم تكون 6 حروف على الأقل' });

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const resetRecord = db.getValidPasswordReset(tokenHash);
  if (!resetRecord) return res.status(400).json({ error: 'الرابط منتهي أو مستخدم قبل كده، اطلب رابط جديد' });

  db.updateUserPassword(resetRecord.user_id, hashPassword(newPassword));
  db.markPasswordResetUsed(resetRecord.id);

  const user = db.getUserById(resetRecord.user_id);
  const authToken = generateToken(user.id);
  res.json({ ok: true, token: authToken, user: { id: user.id, email: user.email } });
});

app.get('/api/sync', requireAuth, (req, res) => {
  const result = db.getAppData(req.userId);
  res.json(result);
});

app.put('/api/sync', requireAuth, (req, res) => {
  const { data, version } = req.body;
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'data مطلوبة وتكون object' });
  }
  const result = db.setAppData(req.userId, data, version);
  if (result.conflict) {
    return res.status(409).json({ error: 'فيه تعديل أحدث من جهاز تاني', ...result.server });
  }
  res.json({ ok: true, ...result.server });
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
