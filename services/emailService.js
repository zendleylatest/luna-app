const nodemailer = require("nodemailer");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildOtpEmailHtml({ title, preheader, otp, message }) {
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader);
  const safeOtp = escapeHtml(otp);
  const safeMessage = escapeHtml(message);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:#fbf6f1;font-family:Arial,Helvetica,sans-serif;color:#2e1930;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fbf6f1;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #ece1e0;box-shadow:0 18px 45px rgba(46,25,48,0.12);">
            <tr>
              <td style="background:#5b2a4d;padding:26px 28px;text-align:center;">
                <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#f3e3cc;font-weight:700;">Luna App</div>
                <h1 style="margin:8px 0 0;font-size:24px;line-height:1.25;color:#ffffff;">${safeTitle}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px 10px;text-align:center;">
                <p style="margin:0 auto 22px;max-width:390px;font-size:15px;line-height:1.6;color:#526173;">${safeMessage}</p>
                <div style="display:inline-block;background:#fbf6f1;border:1px solid #ece1e0;border-radius:18px;padding:18px 28px;margin-bottom:20px;">
                  <div style="font-size:12px;text-transform:uppercase;letter-spacing:1.8px;color:#7a6b7c;font-weight:700;margin-bottom:8px;">Your code</div>
                  <div style="font-size:34px;letter-spacing:8px;color:#5b2a4d;font-weight:800;line-height:1;">${safeOtp}</div>
                </div>
                <p style="margin:0 auto 22px;max-width:390px;font-size:13px;line-height:1.55;color:#718096;">Enter this code in the app to continue. If you did not request this, you can safely ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 28px;text-align:center;">
                <div style="height:1px;background:#e6eef7;margin-bottom:18px;"></div>
                <p style="margin:0;font-size:12px;line-height:1.5;color:#7a6b7c;">This is an automated message from Luna App.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function logOtp(email, otp, label = "OTP") {
  console.log(`[luna-app][otp] ${label} for ${email}: ${otp}`);
}

async function sendOTPEmail(email, otp) {
  logOtp(email, otp, "email verification");

  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) {
    console.warn(
      `[luna-app] OTP not emailed (set EMAIL_USER + EMAIL_PASS in .env). OTP for ${email}: ${otp}`
    );
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user,
      pass,
    },
  });

  await transporter.sendMail({
    from: `"Luna App" <${user}>`,
    to: email,
    subject: "Verify your Luna App email",
    text: `Your Luna App verification code is: ${otp}`,
    html: buildOtpEmailHtml({
      title: "Verify your email",
      preheader: `Your Luna App verification code is ${otp}.`,
      otp,
      message:
        "Use this one-time code to verify your email address and finish setting up your Luna App account.",
    }),
  });
}

async function sendEmail(email, subject, text, options = {}) {
  if (!email || !subject || !text) {
    console.error("sendEmail: missing email, subject, or text");
    return;
  }

  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) {
    console.warn(
      `[luna-app] Email skipped (set EMAIL_USER + EMAIL_PASS). To: ${email} | ${subject} | ${text}`
    );
    return;
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `"Luna App" <${user}>`,
    to: email,
    subject,
    text,
    html: options.html,
  });
}

module.exports = { sendOTPEmail, sendEmail, buildOtpEmailHtml, logOtp };
