const nodemailer = require('nodemailer');

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

let transporter = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendPasswordResetEmail(toEmail, resetLink) {
  if (!transporter) {
    console.log(`📧 [بدون إعدادات إيميل] رابط استرجاع كلمة السر لـ ${toEmail}:`);
    console.log(resetLink);
    return { sent: false, viaLogs: true };
  }

  await transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to: toEmail,
    subject: 'استرجاع كلمة السر - يلا نذاكر',
    html: `
      <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background:#0F1117; color:#EDEFF7; border-radius: 16px;">
        <h2 style="color:#5B6EF5;">يلا نذاكر 📚</h2>
        <p>وصلنا طلب لاسترجاع كلمة السر بتاعة حسابك.</p>
        <p>دوس على الزرار ده عشان تختار كلمة سر جديدة (الرابط صالح لمدة ساعة واحدة بس):</p>
        <a href="${resetLink}" style="display:inline-block; background:#5B6EF5; color:#fff; padding:12px 24px; border-radius:10px; text-decoration:none; font-weight:bold; margin:16px 0;">
          إعادة تعيين كلمة السر
        </a>
        <p style="color:#8B90A3; font-size:13px;">لو انت مطلبتش الحاجة دي، تجاهل الإيميل ده وحسابك هيفضل آمن.</p>
      </div>
    `,
  });
  return { sent: true, viaLogs: false };
}

module.exports = { sendPasswordResetEmail };
