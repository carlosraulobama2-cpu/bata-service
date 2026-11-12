import type { AgentTerms } from '../api/types';
import { money } from '../utils/format';

/**
 * The agent rules document the applicant reads and accepts after sending the application.
 * The figures come from the server (today's settings), so the document never promises other numbers.
 * Changing the text means bumping AGENT_RULES_VERSION on the server.
 */
export type RulesSection = { title: string; paragraphs?: string[]; bullets?: string[]; table?: [string, string][] };

const pct = (bps: number) => `${(bps / 100).toLocaleString('es-ES', { maximumFractionDigits: 2 })} %`;
const share = (amount: number, bps: number) => Math.floor((amount * bps) / 10_000);

export const DEFAULT_TERMS: AgentTerms = { cash_in_commission_bps: 50, cash_out_commission_bps: 50, cash_out_fee_bps: 100, referral_commission_minor: 500, rules_accepted: false };

export function rulesDocument(terms: AgentTerms = DEFAULT_TERMS): { title: string; subtitle: string; sections: RulesSection[] } {
  const example = 100_000;
  const fee = share(example, terms.cash_out_fee_bps);
  const agentOut = share(example, terms.cash_out_commission_bps);
  const agentIn = share(example, terms.cash_in_commission_bps);
  const velyntOut = Math.max(fee - agentOut, 0);
  return {
    title: 'Contrato y guía del agente Velynt',
    subtitle: 'Lee todo antes de aceptar. Es lo que se espera de ti como agente, lo que ganas tú y lo que gana Velynt.',
    sections: [
      {
        title: '1. Qué hace un agente Velynt',
        paragraphs: [
          'Un agente es un comercio de confianza donde los clientes de Velynt meten efectivo en su cuenta (depósito) y sacan efectivo de su cuenta (retiro). También puedes abrir cuentas nuevas a clientes.',
          'Trabajas con dos cajas: tu saldo operativo (dinero electrónico en la app de agentes) y el efectivo de tu local.'
        ]
      },
      {
        title: '2. Lo que necesitas para darte de alta',
        bullets: [
          'Ser mayor de edad.',
          'Teléfono verificado y PIN de pagos creado.',
          'Fotos de tu documento de identidad por delante y por detrás, y una selfie tuya: así verificamos tu identidad.',
          'Un comercio o local donde atender a los clientes.',
          'Dinero propio para tu saldo operativo y efectivo suficiente en caja.'
        ]
      },
      {
        title: '3. Cómo se mueve el dinero',
        bullets: [
          'Depósito: el cliente te da efectivo y tú le pasas el mismo importe desde tu saldo operativo.',
          'Retiro: el cliente te enseña su QR o código, recibes el importe en tu saldo operativo y le das el efectivo.',
          'Cuando necesites más saldo operativo, lo pides a Velynt desde «Solicitar saldo» y lo pagas por banco o en efectivo.'
        ]
      },
      {
        title: '4. Tus ganancias',
        paragraphs: ['Velynt te abona la ganancia en tu saldo operativo: la de cada operación al momento, y la de un cliente nuevo cuando hace su primer depósito.'],
        table: [
          ['Depósito de efectivo', `${pct(terms.cash_in_commission_bps)} del importe`],
          ['Retiro de efectivo', `${pct(terms.cash_out_commission_bps)} del importe`],
          ['Cliente nuevo que abres tú (tras su primer depósito)', money(terms.referral_commission_minor)],
          [`Ejemplo: depósito de ${money(example)}`, `ganas ${money(agentIn)}`],
          [`Ejemplo: retiro de ${money(example)}`, `ganas ${money(agentOut)}`]
        ]
      },
      {
        title: '5. Lo que gana Velynt',
        paragraphs: [
          `El cliente no paga nada por depositar: tu ganancia del depósito la paga Velynt.`,
          `En los retiros el cliente paga una comisión del ${pct(terms.cash_out_fee_bps)}. De esa comisión, ${pct(terms.cash_out_commission_bps)} es para ti y el resto (${pct(Math.max(terms.cash_out_fee_bps - terms.cash_out_commission_bps, 0))}) para Velynt, que cubre la plataforma, la seguridad y el soporte.`,
          `Ejemplo: en un retiro de ${money(example)} el cliente paga ${money(fee)}; tú ganas ${money(agentOut)} y Velynt ${money(velyntOut)}.`
        ]
      },
      {
        title: '6. Tus obligaciones',
        bullets: [
          'Identifico a cada cliente: compruebo su nombre en la app antes de entregar o recibir efectivo.',
          'Nunca opero para otra persona ni con la cuenta de otro, ni divido operaciones para saltar límites.',
          'Nunca pido el PIN ni el código de retiro por teléfono, y no los apunto.',
          'Guardo el efectivo en un sitio seguro y solo entrego dinero cuando la app dice «completado».',
          'No cobro al cliente nada aparte de lo que marca la app.',
          'Aviso a Velynt de cualquier operación sospechosa, amenaza o intento de fraude.',
          'Acepto visitas de Velynt a mi local y la revisión anual de mi verificación.'
        ]
      },
      {
        title: '7. Alta, revisión y baja',
        paragraphs: [
          'Después de aceptar, Velynt revisa tus documentos y puede visitar tu local. Te avisamos en la app cuando te demos de alta; hasta entonces no puedes operar.',
          'Velynt puede suspender o dar de baja a un agente que incumpla estas normas o tenga operaciones sospechosas.',
          'Los porcentajes pueden cambiar: te avisaremos en la app antes de aplicarlos y tendrás que aceptar las normas nuevas.'
        ]
      }
    ]
  };
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Printable page of the document (web: opened in a new tab and printed or saved as PDF). */
export function rulesHtml(terms: AgentTerms | undefined, version: string): string {
  const doc = rulesDocument(terms);
  const body = doc.sections
    .map((s) => {
      const p = (s.paragraphs ?? []).map((x) => `<p>${escape(x)}</p>`).join('');
      const ul = s.bullets ? `<ul>${s.bullets.map((x) => `<li>${escape(x)}</li>`).join('')}</ul>` : '';
      const table = s.table ? `<table>${s.table.map(([a, b]) => `<tr><td>${escape(a)}</td><td>${escape(b)}</td></tr>`).join('')}</table>` : '';
      return `<h2>${escape(s.title)}</h2>${p}${ul}${table}`;
    })
    .join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escape(doc.title)}</title>
<style>body{font-family:Helvetica,Arial,sans-serif;color:#2a1626;max-width:720px;margin:32px auto;padding:0 24px;line-height:1.5}
header{border-bottom:3px solid #4A2040;padding-bottom:12px;margin-bottom:8px}h1{color:#4A2040;margin:0 0 4px}h2{color:#4A2040;font-size:17px;margin-top:24px}
small{color:#7a6873}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #eadfe6;padding:8px 4px}td:last-child{text-align:right;font-weight:600}</style></head>
<body><header><h1>${escape(doc.title)}</h1><small>Velynt · Versión ${escape(version)}</small></header><p>${escape(doc.subtitle)}</p>${body}</body></html>`;
}
