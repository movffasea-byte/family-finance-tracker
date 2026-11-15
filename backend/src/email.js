// Sends mail through Resend's HTTP API (no extra package needed).
export async function sendResetEmail(to, link) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') throw new Error('RESEND_API_KEY is not set');
    console.log(`[dev] password reset link for ${to}: ${link}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Family Finance <onboarding@resend.dev>',
      to: [to],
      subject: 'Reset your Family Finance password',
      text: `Use this link to choose a new password. It works once and expires in 30 minutes:\n\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
      html: `<p>Use this link to choose a new password. It works once and expires in 30 minutes.</p><p><a href="${link}">Choose a new password</a></p><p>If you didn't ask for this, you can ignore this email.</p>`,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend responded with status ${res.status}: ${detail.slice(0, 300)}`);
  }
}
