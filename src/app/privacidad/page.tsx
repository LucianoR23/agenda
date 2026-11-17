import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Privacidad · Agenda",
  description: "Qué datos usa Agenda y qué hace con ellos.",
};

/**
 * Public privacy policy (outside the (app) auth gate). Google requires its URL to publish the OAuth app in production
 * (docs/v2/runbooks/google-oauth.md). Keep it in sync with what the app actually does with Google data.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 bg-bg px-4 py-10 text-body text-text md:py-16">
      <header className="flex flex-col gap-2">
        <span className="font-mono text-mono text-muted">AGENDA · POLÍTICA DE PRIVACIDAD</span>
        <h1 className="text-title">Privacidad</h1>
        <p className="text-muted">Última actualización: 17 de noviembre de 2026.</p>
      </header>

      <Section title="Qué es Agenda">
        <p>
          Agenda (agenda.lemydev.com) es una aplicación personal de un solo usuario: su dueño la usa para organizar tareas, recordatorios y
          eventos. No está abierta al público, no tiene cuentas de terceros y no muestra publicidad.
        </p>
      </Section>

      <Section title="Datos de Google Calendar">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            Si el usuario conecta su cuenta de Google, Agenda pide solo el permiso de <strong>lectura</strong> de calendarios (
            <code className="font-mono text-mono">calendar.readonly</code>). Nunca crea, modifica ni borra eventos en Google.
          </li>
          <li>
            Lee la lista de calendarios y sus eventos (título, fecha y hora, lugar, descripción) para mostrárselos al usuario en su agenda
            y, si lo activa, avisarle antes de cada evento.
          </li>
          <li>Guarda una copia de esos eventos y el token de acceso en su propio servidor. El token se guarda cifrado.</li>
          <li>
            Sunday, el asistente personal del mismo usuario, puede consultar esos eventos a través de la API de Agenda para responderle
            sobre su agenda.
          </li>
        </ul>
      </Section>

      <Section title="Qué no hace">
        <p>
          Agenda no vende, no comparte ni transfiere estos datos a terceros, no los usa para publicidad y no los usa para entrenar modelos
          de inteligencia artificial. El uso de la información recibida de las APIs de Google cumple con la{" "}
          <a
            className="text-accent underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            rel="noreferrer"
            target="_blank"
          >
            Política de datos de usuario de los servicios de API de Google
          </a>
          , incluidos los requisitos de uso limitado.
        </p>
      </Section>

      <Section title="Cómo borrar los datos">
        <p>
          En Agenda, <strong>Ajustes → Google Calendar → Desconectar</strong> revoca el acceso en Google y borra el token, los calendarios y
          los eventos copiados. El acceso también se puede revocar desde{" "}
          <a className="text-accent underline" href="https://myaccount.google.com/permissions" rel="noreferrer" target="_blank">
            la configuración de la cuenta de Google
          </a>
          .
        </p>
      </Section>

      <Section title="Contacto">
        <p>Por cualquier consulta, escribí al correo de asistencia que figura en la pantalla de consentimiento de Google.</p>
      </Section>

      <Link className="text-accent underline" href="/">
        Volver a Agenda
      </Link>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-headline">{title}</h2>
      {children}
    </section>
  );
}
