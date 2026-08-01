const cron = require('node-cron');
const webpush = require('web-push');
const db = require('./db');

function addTime(iso, repeat) {
  const d = new Date(iso);
  if (repeat === 'daily') d.setDate(d.getDate() + 1);
  else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  return d.toISOString();
}

async function processDueReminders() {
  const nowIso = new Date().toISOString();
  const due = db.getDueReminders(nowIso);

  for (const reminder of due) {
    const payload = JSON.stringify({
      title: reminder.title,
      body: reminder.body,
      category: reminder.category,
      reminderId: reminder.id,
    });

    for (const sub of reminder.subscriptions) {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(subscription, payload);
        console.log(`🔔 إشعار اتبعت: "${reminder.title}"`);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          db.deleteSubscriptionById(sub.id);
          continue;
        }
        console.error(`❌ فشل إرسال إشعار id ${reminder.id}:`, err.message);
      }
    }

    if (reminder.repeat === 'once') {
      db.markSent(reminder.id);
    } else {
      db.rescheduleRecurring(reminder.id, addTime(reminder.send_at, reminder.repeat));
    }
  }
}

function startScheduler() {
  cron.schedule('* * * * *', () => {
    processDueReminders().catch((e) => console.error('scheduler error:', e));
  });
  console.log('⏰ الـ scheduler شغال، بيفحص كل دقيقة');
}

module.exports = { startScheduler, processDueReminders };
