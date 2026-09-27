import nodemailer from "nodemailer";
import { Resend } from "resend";

export type EmailResult = {
  ok: boolean;
  id?: string;
  mocked?: boolean;
  error?: string;
  preview: { to: string; subject: string; body: string };
};

export async function sendEmail(input: {
  to: string;
  subject: string;
  body: string;
  fromName?: string;
}): Promise<EmailResult> {
  const preview = { to: input.to, subject: input.subject, body: input.body };
  const fromName = input.fromName || "Tony's Pizzeria (OYI Agent)";

  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const from = process.env.EMAIL_FROM || "onboarding@resend.dev";
      const { data, error } = await resend.emails.send({
        from: `${fromName} <${from}>`,
        to: input.to,
        subject: input.subject,
        text: input.body,
      });
      if (error) return { ok: false, error: error.message, preview };
      return { ok: true, id: data?.id, preview };
    } catch (err) {
      return { ok: false, error: String(err), preview };
    }
  }

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      const info = await transporter.sendMail({
        from: `"${fromName}" <${process.env.SMTP_USER}>`,
        to: input.to,
        subject: input.subject,
        text: input.body,
      });
      return { ok: true, id: info.messageId, preview };
    } catch (err) {
      return { ok: false, error: String(err), preview };
    }
  }

  // Demo fallback: log + write it success so the flow completes
  console.log("[email:mock]", preview);
  return { ok: true, id: `mock_email_${Date.now()}`, mocked: true, preview };
}
