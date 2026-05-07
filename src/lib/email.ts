import { Resend } from 'resend';

let _resend: Resend | null = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}
const FROM = process.env.FROM_EMAIL ?? 'onboarding@resend.dev';

export async function sendOtpEmail(toEmail: string, code: string): Promise<void> {
  await getResend().emails.send({
    from: FROM,
    to: toEmail,
    subject: `${code} — Your Kicksonar verification code`,
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:32px">
        <h2 style="color:#05CE78;margin-bottom:8px">Kicksonar</h2>
        <p style="color:#374151;margin-bottom:24px">Your verification code:</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:24px;text-align:center">
          <span style="font-size:40px;font-weight:900;letter-spacing:8px;color:#111827">${code}</span>
        </div>
        <p style="color:#6b7280;font-size:13px;margin-top:16px">Valid for 10 minutes. Do not share this code.</p>
      </div>
    `,
  });
}
